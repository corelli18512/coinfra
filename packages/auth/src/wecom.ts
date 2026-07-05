/**
 * WeCom (企业微信 / Work WeChat) sign-in.
 *
 * WeCom's OAuth is a two-step dance that does not fit standard OAuth2:
 *  1. Fetch an **app** access token from `corpid` + `corpsecret`
 *     (`/cgi-bin/gettoken`). This token authenticates the app, not the user.
 *  2. Exchange the login `code` for a `userid` with that app token
 *     (`/cgi-bin/auth/getuserinfo`).
 *  3. Optionally read the member's profile (`/cgi-bin/user/get`).
 *
 * {@link wecom} plugs this into Better Auth's `genericOAuth` plugin through its
 * `getToken` / `getUserInfo` hooks, so it composes exactly like {@link wechat}.
 * As with WeChat, the authorize redirect is the one part `genericOAuth` cannot
 * render perfectly; use {@link wecomAuthorizeUrl} when you drive it yourself.
 */
import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';
import { type FetchLike, getJson, queryString } from './internal/http.js';
import type { OAuth2Tokens, OAuth2UserInfo } from './internal/oauth.js';

const GETTOKEN_ENDPOINT = 'https://qyapi.weixin.qq.com/cgi-bin/gettoken';
const GETUSERINFO_ENDPOINT = 'https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo';
const USERGET_ENDPOINT = 'https://qyapi.weixin.qq.com/cgi-bin/user/get';
const QR_LOGIN_ENDPOINT = 'https://login.work.weixin.qq.com/wwlogin/sso/login';
const OAUTH2_AUTHORIZE_ENDPOINT = 'https://open.weixin.qq.com/connect/oauth2/authorize';

/** Options for the {@link wecom} connector. */
export interface WeComOptions {
  /** Provider id used in callback routes. @default "wecom" */
  providerId?: string;
  /** Enterprise id (企业ID / CorpID). */
  corpId: string;
  /** Application secret (应用 Secret / CorpSecret). */
  corpSecret: string;
  /** Application agent id (AgentId) — required to build the authorize URL. */
  agentId?: string | number;
  /** Fixed redirect URI, if not using Better Auth's default callback. */
  redirectURI?: string;
  /**
   * Read the member's full profile (name/email/avatar) after resolving the
   * userid. Requires the app to have directory read permission; on failure the
   * sign-in still succeeds with a userid-only identity. @default true
   */
  fetchDetail?: boolean;
  /** Forwarded to `genericOAuth`. */
  overrideUserInfo?: boolean;
  /** Injected `fetch`, for tests. @default globalThis.fetch */
  fetch?: FetchLike;
}

interface WeComTokenResponse {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
}

interface WeComAuthResponse {
  errcode?: number;
  errmsg?: string;
  userid?: string;
  user_ticket?: string;
  openid?: string;
  external_userid?: string;
}

interface WeComUserDetail {
  errcode?: number;
  errmsg?: string;
  userid?: string;
  name?: string;
  email?: string;
  biz_mail?: string;
  avatar?: string;
}

/**
 * Fetch a WeCom **app** access token from `corpid` + `corpsecret`. Pure and
 * fetch-injectable. This token is app-scoped and cacheable (~2h) by the caller;
 * the connector fetches it fresh per sign-in for simplicity.
 */
export async function getWeComAccessToken(params: {
  corpId: string;
  corpSecret: string;
  fetch?: FetchLike;
}): Promise<string> {
  const fetchImpl = params.fetch ?? globalThis.fetch;
  const url = `${GETTOKEN_ENDPOINT}?${queryString({
    corpid: params.corpId,
    corpsecret: params.corpSecret,
  })}`;

  const data = await getJson<WeComTokenResponse>(url, fetchImpl);
  if (data.errcode || !data.access_token) {
    throw new Error(
      `WeCom gettoken failed (${data.errcode ?? 'no token'}): ${data.errmsg ?? ''}`.trim(),
    );
  }
  return data.access_token;
}

/**
 * Exchange a WeCom login `code` for tokens: fetches the app token, then resolves
 * the `code` to a `userid`. The `userid`/`openid`/`user_ticket` are stashed in
 * {@link OAuth2Tokens.raw} for {@link getWeComUserInfo}.
 */
export async function exchangeWeComCode(params: {
  corpId: string;
  corpSecret: string;
  code: string;
  fetch?: FetchLike;
}): Promise<OAuth2Tokens> {
  const fetchImpl = params.fetch ?? globalThis.fetch;
  const accessToken = await getWeComAccessToken(params);

  const url = `${GETUSERINFO_ENDPOINT}?${queryString({ access_token: accessToken, code: params.code })}`;
  const data = await getJson<WeComAuthResponse>(url, fetchImpl);
  if (data.errcode) {
    throw new Error(`WeCom getuserinfo failed (${data.errcode}): ${data.errmsg ?? ''}`.trim());
  }
  if (!data.userid && !data.openid) {
    throw new Error('WeCom getuserinfo returned neither userid nor openid');
  }

  return {
    accessToken,
    raw: { userid: data.userid, openid: data.openid, user_ticket: data.user_ticket },
  };
}

/**
 * Resolve a WeCom identity (and, best-effort, profile) from tokens produced by
 * {@link exchangeWeComCode}. Returns `null` if there is no identifier.
 */
export async function getWeComUserInfo(
  tokens: OAuth2Tokens,
  options: { fetchDetail?: boolean; fetch?: FetchLike } = {},
): Promise<OAuth2UserInfo | null> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const userid = tokens.raw?.userid as string | undefined;
  const openid = tokens.raw?.openid as string | undefined;
  const id = userid ?? openid;
  if (!id) return null;

  const wantsDetail = options.fetchDetail ?? true;
  if (wantsDetail && userid && tokens.accessToken) {
    try {
      const url = `${USERGET_ENDPOINT}?${queryString({ access_token: tokens.accessToken, userid })}`;
      const detail = await getJson<WeComUserDetail>(url, fetchImpl);
      if (!detail.errcode) {
        return {
          id: userid,
          name: detail.name,
          email: detail.email ?? detail.biz_mail,
          image: detail.avatar,
          emailVerified: false,
        };
      }
    } catch {
      // Directory read not permitted or transient failure — fall through to the
      // userid-only identity below. Sign-in must not fail on missing profile.
    }
  }

  return { id, emailVerified: false };
}

/**
 * Build the WeCom authorize URL by hand.
 *  - `qr` (default): the 扫码登录 endpoint on `login.work.weixin.qq.com`.
 *  - `in-app`: the `connect/oauth2/authorize` endpoint (inside WeCom), including
 *    the required trailing `#wechat_redirect` fragment.
 */
export function wecomAuthorizeUrl(
  options: Pick<WeComOptions, 'corpId' | 'agentId'> & { mode?: 'qr' | 'in-app' },
  params: { redirectURI: string; state: string },
): string {
  const agentId = options.agentId === undefined ? undefined : String(options.agentId);

  if (options.mode === 'in-app') {
    const qs = queryString({
      appid: options.corpId,
      redirect_uri: params.redirectURI,
      response_type: 'code',
      scope: 'snsapi_base',
      agentid: agentId,
      state: params.state,
    });
    return `${OAUTH2_AUTHORIZE_ENDPOINT}?${qs}#wechat_redirect`;
  }

  const qs = queryString({
    login_type: 'CorpApp',
    appid: options.corpId,
    agentid: agentId,
    redirect_uri: params.redirectURI,
    state: params.state,
  });
  return `${QR_LOGIN_ENDPOINT}?${qs}`;
}

/**
 * Create a WeCom provider entry for Better Auth's `genericOAuth` plugin. Drop it
 * into `createCoinfraAuth({ oauthProviders: [wecom(...)] })` or the native
 * `genericOAuth({ config: [wecom(...)] })`.
 */
export function wecom(options: WeComOptions): GenericOAuthConfig {
  const agentId = options.agentId === undefined ? undefined : String(options.agentId);

  return {
    providerId: options.providerId ?? 'wecom',
    clientId: options.corpId,
    clientSecret: options.corpSecret,
    scopes: ['snsapi_base'],
    authorizationUrl: OAUTH2_AUTHORIZE_ENDPOINT,
    // WeCom keys the authorize request by `appid` (=corpid) plus `agentid`.
    authorizationUrlParams: agentId
      ? { appid: options.corpId, agentid: agentId }
      : { appid: options.corpId },
    redirectURI: options.redirectURI,
    pkce: false,
    overrideUserInfo: options.overrideUserInfo,
    getToken: ({ code }) =>
      exchangeWeComCode({
        corpId: options.corpId,
        corpSecret: options.corpSecret,
        code,
        fetch: options.fetch,
      }),
    getUserInfo: (tokens) =>
      getWeComUserInfo(tokens, { fetchDetail: options.fetchDetail, fetch: options.fetch }),
  };
}
