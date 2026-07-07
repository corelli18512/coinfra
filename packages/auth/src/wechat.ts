/**
 * WeChat (微信) sign-in for the open web.
 *
 * Two flows are covered by one helper, selected with `mode`:
 *  - `qrconnect` (default) — 开放平台 website QR login, scope `snsapi_login`.
 *    A desktop user scans a QR with their WeChat app.
 *  - `official-account` — 公众号 web OAuth (`connect/oauth2/authorize`), used
 *    inside the WeChat in-app browser, scope `snsapi_userinfo` / `snsapi_base`.
 *
 * WeChat is not a standard OAuth2 provider: the token and user-info endpoints
 * are GET requests keyed by `appid`/`secret` and return an `openid` instead of
 * a bearer identity. {@link wechat} plugs the non-standard token/user-info
 * exchange into Better Auth's `genericOAuth` plugin via its `getToken` /
 * `getUserInfo` hooks, so from the app's point of view it is just another
 * provider in `oauthProviders` / `genericOAuth({ config })`.
 *
 * The authorize **redirect** is the one part `genericOAuth` cannot render
 * perfectly (WeChat needs the `appid` param and a trailing `#wechat_redirect`
 * fragment). For `qrconnect` on desktop the generated URL works in practice;
 * for the in-app `official-account` flow, drive the redirect yourself with
 * {@link wechatAuthorizeUrl} and let `genericOAuth` handle only the callback.
 */
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { parseUserOutput } from 'better-auth/db';
import { handleOAuthUserInfo } from 'better-auth/oauth2';
import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';
import * as z from 'zod';
import { aesCbcDecrypt, fromBase64 } from './internal/crypto.js';
import { type FetchLike, getJson, postJson, queryString } from './internal/http.js';
import type { OAuth2Tokens, OAuth2UserInfo } from './internal/oauth.js';
import type { BetterAuthPlugin } from './types.js';

const TOKEN_ENDPOINT = 'https://api.weixin.qq.com/sns/oauth2/access_token';
const USERINFO_ENDPOINT = 'https://api.weixin.qq.com/sns/userinfo';
const JSCODE2SESSION_ENDPOINT = 'https://api.weixin.qq.com/sns/jscode2session';
const QRCONNECT_ENDPOINT = 'https://open.weixin.qq.com/connect/qrconnect';
const OAUTH2_AUTHORIZE_ENDPOINT = 'https://open.weixin.qq.com/connect/oauth2/authorize';

/** Options for the {@link wechat} connector. */
export interface WeChatOptions {
  /** Provider id used in callback routes. @default "wechat" */
  providerId?: string;
  /** WeChat `appid` (公众号 AppID or 开放平台 AppID). */
  appId: string;
  /** WeChat `secret` (AppSecret). */
  appSecret: string;
  /**
   * Which authorize endpoint / scope to use.
   * @default "qrconnect"
   */
  mode?: 'qrconnect' | 'official-account';
  /**
   * OAuth scope. Defaults to `snsapi_login` for `qrconnect` and
   * `snsapi_userinfo` for `official-account`. WeChat accepts a single scope.
   */
  scope?: string;
  /** Fixed redirect URI, if you are not using Better Auth's default callback. */
  redirectURI?: string;
  /** Profile language for the user-info call. @default "zh_CN" */
  lang?: 'zh_CN' | 'zh_TW' | 'en';
  /**
   * When `true`, always refresh the local user from WeChat on every sign-in.
   * Forwarded to `genericOAuth`.
   */
  overrideUserInfo?: boolean;
  /** Injected `fetch`, for tests. @default globalThis.fetch */
  fetch?: FetchLike;
}

interface WeChatTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  openid?: string;
  scope?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

interface WeChatUserInfoResponse {
  openid?: string;
  nickname?: string;
  headimgurl?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

function defaultScope(mode: WeChatOptions['mode']): string {
  return mode === 'official-account' ? 'snsapi_userinfo' : 'snsapi_login';
}

/**
 * Exchange an authorization `code` for WeChat tokens. Pure and fetch-injectable
 * — exported so apps that drive the flow themselves can reuse the exact,
 * tested exchange. The returned `openid`/`unionid` are stashed in
 * {@link OAuth2Tokens.raw} for {@link getWeChatUserInfo}.
 */
export async function exchangeWeChatCode(params: {
  appId: string;
  appSecret: string;
  code: string;
  fetch?: FetchLike;
}): Promise<OAuth2Tokens> {
  const fetchImpl = params.fetch ?? globalThis.fetch;
  const url = `${TOKEN_ENDPOINT}?${queryString({
    appid: params.appId,
    secret: params.appSecret,
    code: params.code,
    grant_type: 'authorization_code',
  })}`;

  const data = await getJson<WeChatTokenResponse>(url, fetchImpl);
  if (data.errcode) {
    throw new Error(`WeChat token exchange failed (${data.errcode}): ${data.errmsg ?? ''}`.trim());
  }
  if (!data.access_token || !data.openid) {
    throw new Error('WeChat token exchange returned no access_token/openid');
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accessTokenExpiresAt:
      data.expires_in !== undefined ? new Date(Date.now() + data.expires_in * 1000) : undefined,
    scopes: data.scope ? data.scope.split(/[ ,]/).filter(Boolean) : undefined,
    raw: { openid: data.openid, unionid: data.unionid },
  };
}

/**
 * Fetch a WeChat user profile from tokens produced by {@link exchangeWeChatCode}.
 * Falls back to an id-only identity when the granted scope (`snsapi_base`) does
 * not allow the profile call. Returns `null` if the tokens carry no openid.
 */
export async function getWeChatUserInfo(
  tokens: OAuth2Tokens,
  options: { lang?: WeChatOptions['lang']; fetch?: FetchLike } = {},
): Promise<OAuth2UserInfo | null> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const openid = tokens.raw?.openid as string | undefined;
  const unionid = tokens.raw?.unionid as string | undefined;
  if (!tokens.accessToken || !openid) return null;

  const url = `${USERINFO_ENDPOINT}?${queryString({
    access_token: tokens.accessToken,
    openid,
    lang: options.lang ?? 'zh_CN',
  })}`;

  const data = await getJson<WeChatUserInfoResponse>(url, fetchImpl);
  if (data.errcode) {
    // Base-scope sign-ins can authenticate but cannot read the profile — still
    // a valid identity, keyed by unionid (cross-app) when available, else openid.
    return { id: unionid ?? openid, emailVerified: false };
  }

  return {
    id: data.unionid ?? unionid ?? data.openid ?? openid,
    name: data.nickname,
    image: data.headimgurl,
    emailVerified: false,
  };
}

/**
 * Build the WeChat authorize URL by hand, including the `appid` param and the
 * required trailing `#wechat_redirect` fragment. Use this when you drive the
 * sign-in redirect yourself (in particular the in-app `official-account` flow).
 */
export function wechatAuthorizeUrl(
  options: Pick<WeChatOptions, 'appId' | 'mode' | 'scope'>,
  params: { redirectURI: string; state: string },
): string {
  const base = options.mode === 'official-account' ? OAUTH2_AUTHORIZE_ENDPOINT : QRCONNECT_ENDPOINT;
  const qs = queryString({
    appid: options.appId,
    redirect_uri: params.redirectURI,
    response_type: 'code',
    scope: options.scope ?? defaultScope(options.mode),
    state: params.state,
  });
  return `${base}?${qs}#wechat_redirect`;
}

/**
 * Create a WeChat provider entry for Better Auth's `genericOAuth` plugin. Drop
 * it into `createCoinfraAuth({ oauthProviders: [wechat(...)] })` or the native
 * `genericOAuth({ config: [wechat(...)] })`.
 */
export function wechat(options: WeChatOptions): GenericOAuthConfig {
  const scope = options.scope ?? defaultScope(options.mode);
  const base = options.mode === 'official-account' ? OAUTH2_AUTHORIZE_ENDPOINT : QRCONNECT_ENDPOINT;

  return {
    providerId: options.providerId ?? 'wechat',
    clientId: options.appId,
    clientSecret: options.appSecret,
    scopes: [scope],
    authorizationUrl: base,
    // WeChat keys the authorize request by `appid`, not the standard `client_id`.
    authorizationUrlParams: { appid: options.appId },
    tokenUrl: TOKEN_ENDPOINT,
    redirectURI: options.redirectURI,
    pkce: false,
    overrideUserInfo: options.overrideUserInfo,
    getToken: ({ code }) =>
      exchangeWeChatCode({
        appId: options.appId,
        appSecret: options.appSecret,
        code,
        fetch: options.fetch,
      }),
    getUserInfo: (tokens) =>
      getWeChatUserInfo(tokens, { lang: options.lang, fetch: options.fetch }),
  };
}

// --- WeChat Mini Program (小程序) --------------------------------------------

/**
 * The result of a Mini Program `code2Session` exchange. `sessionKey` is
 * sensitive — it decrypts `getPhoneNumber`/`getUserInfo` payloads — so keep it
 * server-side and never return it to the client.
 */
export interface WeChatMiniProgramSession {
  openid: string;
  sessionKey: string;
  unionid?: string;
}

interface WeChatCode2SessionResponse {
  openid?: string;
  session_key?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

/**
 * Exchange a Mini Program login `code` (from `wx.login()`) for the user's
 * `openid` via WeChat's `jscode2session`. Pure and fetch-injectable, so the
 * exact exchange stays unit-tested and reusable outside the Better Auth plugin.
 */
export async function exchangeMiniProgramCode(params: {
  appId: string;
  appSecret: string;
  code: string;
  fetch?: FetchLike;
}): Promise<WeChatMiniProgramSession> {
  const fetchImpl = params.fetch ?? globalThis.fetch;
  const url = `${JSCODE2SESSION_ENDPOINT}?${queryString({
    appid: params.appId,
    secret: params.appSecret,
    js_code: params.code,
    grant_type: 'authorization_code',
  })}`;

  const data = await getJson<WeChatCode2SessionResponse>(url, fetchImpl);
  if (data.errcode) {
    throw new Error(`WeChat jscode2session failed (${data.errcode}): ${data.errmsg ?? ''}`.trim());
  }
  if (!data.openid || !data.session_key) {
    throw new Error('WeChat jscode2session returned no openid/session_key');
  }
  return { openid: data.openid, sessionKey: data.session_key, unionid: data.unionid };
}

/** Options for the {@link wechatMiniProgram} plugin. */
export interface WeChatMiniProgramOptions {
  /** Mini Program AppID. */
  appId: string;
  /** Mini Program AppSecret. */
  appSecret: string;
  /**
   * Provider id under which the WeChat identity is linked to a coinfra user.
   * @default "wechat-miniprogram"
   */
  providerId?: string;
  /**
   * Domain for the synthetic email assigned to a Mini Program user on first
   * sign-in (Better Auth requires an email; Mini Program users have none).
   * @default "wechat.local"
   */
  tempEmailDomain?: string;
  /** Reject unknown users instead of signing them up on first login. */
  disableSignUp?: boolean;
  /** Injected `fetch`, for tests. @default globalThis.fetch */
  fetch?: FetchLike;
}

/**
 * WeChat **Mini Program** sign-in, as a Better Auth plugin. Unlike the web
 * flows there is no redirect: the Mini Program calls `wx.login()` for a `code`
 * and POSTs it to `/sign-in/wechat-miniprogram`; this plugin exchanges it for an
 * `openid` and finds-or-creates the matching coinfra user + session, reusing
 * Better Auth's own account-linking so it composes with every other provider.
 *
 * Returns a real Better Auth plugin — drop it into `plugins`
 * (`createCoinfraAuth({ plugins: [wechatMiniProgram({ appId, appSecret })] })`).
 * The exposed API method is `signInWeChatMiniProgram({ body: { code } })`.
 */
export function wechatMiniProgram(options: WeChatMiniProgramOptions): BetterAuthPlugin {
  const providerId = options.providerId ?? 'wechat-miniprogram';
  const domain = options.tempEmailDomain ?? 'wechat.local';

  return {
    id: 'wechat-miniprogram',
    endpoints: {
      signInWeChatMiniProgram: createAuthEndpoint(
        '/sign-in/wechat-miniprogram',
        { method: 'POST', body: z.object({ code: z.string().min(1) }) },
        async (ctx) => {
          const { openid, unionid } = await exchangeMiniProgramCode({
            appId: options.appId,
            appSecret: options.appSecret,
            code: ctx.body.code,
            fetch: options.fetch,
          });

          const result = await handleOAuthUserInfo(ctx, {
            userInfo: {
              id: openid,
              email: `${openid.toLowerCase()}@${domain}`,
              emailVerified: false,
              name: unionid ?? openid,
            },
            account: { providerId, accountId: openid },
            disableSignUp: options.disableSignUp,
          });
          if (result.error || !result.data) {
            throw new APIError('UNAUTHORIZED', {
              message: result.error ?? 'WeChat Mini Program sign-in failed',
            });
          }

          await setSessionCookie(ctx, result.data);
          return ctx.json({
            token: result.data.session.token,
            user: parseUserOutput(ctx.context.options, result.data.user),
          });
        },
      ),
    },
  } as unknown as BetterAuthPlugin;
}

// --- WeChat Mini Program phone number ---------------------------------------

const CGI_TOKEN_ENDPOINT = 'https://api.weixin.qq.com/cgi-bin/token';
const GETUSERPHONENUMBER_ENDPOINT = 'https://api.weixin.qq.com/wxa/business/getuserphonenumber';

/** A WeChat Mini Program encrypted payload, as produced by `wx.getPhoneNumber`
 * (the classic `encryptedData` + `iv` route). */
export interface WeChatEncryptedPayload {
  /** Session key from {@link exchangeMiniProgramCode} — keep it server-side. */
  sessionKey: string;
  /** Base64 `encryptedData` from the mini program. */
  encryptedData: string;
  /** Base64 `iv` from the mini program. */
  iv: string;
}

/** A decrypted WeChat phone number. */
export interface WeChatPhoneNumber {
  phoneNumber: string;
  purePhoneNumber: string;
  countryCode: string;
  watermark?: { appid?: string; timestamp?: number };
}

/**
 * Decrypt a WeChat Mini Program encrypted payload (AES-128-CBC, PKCS#7) with the
 * `sessionKey` from {@link exchangeMiniProgramCode}, returning the parsed JSON.
 * Works for any `wx.*` encrypted payload (phone number, `getUserInfo`, …).
 * Throws if the sessionKey is wrong/expired or the plaintext is not JSON.
 */
export async function decryptWeChatData<T = Record<string, unknown>>(
  payload: WeChatEncryptedPayload,
): Promise<T> {
  let plaintext: Uint8Array;
  try {
    plaintext = await aesCbcDecrypt(
      fromBase64(payload.sessionKey),
      fromBase64(payload.iv),
      fromBase64(payload.encryptedData),
    );
  } catch {
    throw new Error('WeChat data decryption failed (invalid or expired sessionKey)');
  }
  try {
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    throw new Error('WeChat data decryption produced invalid JSON');
  }
}

/**
 * Decrypt the `wx.getPhoneNumber` payload (the classic `encryptedData` route).
 * When `appId` is given, the decrypted `watermark.appid` is verified against it —
 * WeChat stamps every payload with the owning app id, so a mismatch means the
 * data was not minted for your app and must be rejected.
 */
export async function getWeChatMiniProgramPhoneNumber(
  payload: WeChatEncryptedPayload & { appId?: string },
): Promise<WeChatPhoneNumber> {
  const data = await decryptWeChatData<WeChatPhoneNumber>(payload);
  if (payload.appId && data.watermark?.appid && data.watermark.appid !== payload.appId) {
    throw new Error('WeChat phone number watermark appid mismatch');
  }
  if (!data.phoneNumber) {
    throw new Error('WeChat phone number payload missing phoneNumber');
  }
  return data;
}

interface CgiTokenResponse {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
}

/**
 * Fetch a Mini Program **app** access token (`grant_type=client_credential`).
 * This token is app-scoped and cacheable (~2h) by the caller; the phone-number
 * helper fetches it fresh unless you pass one in.
 */
export async function getMiniProgramAccessToken(params: {
  appId: string;
  appSecret: string;
  fetch?: FetchLike;
}): Promise<string> {
  const fetchImpl = params.fetch ?? globalThis.fetch;
  const url = `${CGI_TOKEN_ENDPOINT}?${queryString({
    grant_type: 'client_credential',
    appid: params.appId,
    secret: params.appSecret,
  })}`;
  const data = await getJson<CgiTokenResponse>(url, fetchImpl);
  if (data.errcode || !data.access_token) {
    throw new Error(
      `WeChat cgi-bin/token failed (${data.errcode ?? 'no token'}): ${data.errmsg ?? ''}`.trim(),
    );
  }
  return data.access_token;
}

interface GetPhoneNumberResponse {
  errcode?: number;
  errmsg?: string;
  phone_info?: {
    phoneNumber?: string;
    purePhoneNumber?: string;
    countryCode?: string;
    watermark?: { appid?: string; timestamp?: number };
  };
}

/**
 * Resolve a WeChat phone number via the **modern** code route
 * (`wx.getPhoneNumber` with a `code`, no client-side decryption). Exchanges the
 * `code` at `getuserphonenumber` using an app access token, which is fetched for
 * you from `appId`/`appSecret` unless you supply a cached `accessToken`.
 */
export async function getWeChatMiniProgramPhoneNumberByCode(params: {
  appId?: string;
  appSecret?: string;
  accessToken?: string;
  code: string;
  fetch?: FetchLike;
}): Promise<WeChatPhoneNumber> {
  const fetchImpl = params.fetch ?? globalThis.fetch;
  let token = params.accessToken;
  if (!token) {
    if (!params.appId || !params.appSecret) {
      throw new Error('getWeChatMiniProgramPhoneNumberByCode needs accessToken or appId+appSecret');
    }
    token = await getMiniProgramAccessToken({
      appId: params.appId,
      appSecret: params.appSecret,
      fetch: fetchImpl,
    });
  }

  const url = `${GETUSERPHONENUMBER_ENDPOINT}?${queryString({ access_token: token })}`;
  const data = await postJson<GetPhoneNumberResponse>(url, { code: params.code }, fetchImpl);
  if (data.errcode || !data.phone_info?.phoneNumber) {
    throw new Error(
      `WeChat getuserphonenumber failed (${data.errcode ?? 'no phone'}): ${data.errmsg ?? ''}`.trim(),
    );
  }
  const info = data.phone_info;
  return {
    phoneNumber: info.phoneNumber as string,
    purePhoneNumber: info.purePhoneNumber ?? '',
    countryCode: info.countryCode ?? '',
    watermark: info.watermark,
  };
}
