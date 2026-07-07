/**
 * QQ (QQ 互联 / QQ Connect) sign-in.
 *
 * QQ's OAuth2 is standard except for two quirks {@link qq} folds away:
 *  1. The classic endpoints answer with a URL-encoded body or a JSONP
 *     `callback(...)` wrapper. Passing `fmt=json` switches both to clean JSON,
 *     which is what this connector does.
 *  2. Before you can read a profile you must resolve the user's `openid` from a
 *     separate `/oauth2.0/me` call, then pass it (plus the app id as
 *     `oauth_consumer_key`) to `/user/get_user_info`.
 *
 * {@link qq} plugs this into Better Auth's `genericOAuth` plugin through its
 * `getToken` / `getUserInfo` hooks, exactly like {@link wechat}.
 */
import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';
import { type FetchLike, getJson, queryString } from './internal/http.js';
import type { OAuth2Tokens, OAuth2UserInfo } from './internal/oauth.js';

const AUTHORIZE_ENDPOINT = 'https://graph.qq.com/oauth2.0/authorize';
const TOKEN_ENDPOINT = 'https://graph.qq.com/oauth2.0/token';
const ME_ENDPOINT = 'https://graph.qq.com/oauth2.0/me';
const USERINFO_ENDPOINT = 'https://graph.qq.com/user/get_user_info';

/** Options for the {@link qq} connector. */
export interface QQOptions {
  /** Provider id used in callback routes. @default "qq" */
  providerId?: string;
  /** Application id (APP ID). */
  appId: string;
  /** Application key (APP Key). */
  appKey: string;
  /** Fixed redirect URI, if not using Better Auth's default callback. */
  redirectURI?: string;
  /**
   * Request the cross-app `unionid` and prefer it as the stable user id. Needs
   * the UnionID capability enabled on your QQ Connect app. @default true
   */
  useUnionId?: boolean;
  /** Forwarded to `genericOAuth`. */
  overrideUserInfo?: boolean;
  /** Injected `fetch`, for tests. @default globalThis.fetch */
  fetch?: FetchLike;
}

interface QQTokenResponse {
  access_token?: string;
  expires_in?: string | number;
  refresh_token?: string;
  error?: string | number;
  error_description?: string;
}

interface QQMeResponse {
  client_id?: string;
  openid?: string;
  unionid?: string;
  error?: string | number;
  error_description?: string;
}

interface QQUserInfoResponse {
  ret?: number;
  msg?: string;
  nickname?: string;
  figureurl_qq_1?: string;
  figureurl_qq_2?: string;
  figureurl_qq?: string;
  gender?: string;
}

/**
 * Exchange a QQ login `code` for tokens, then resolve the `openid`/`unionid`.
 * The identifiers are stashed in {@link OAuth2Tokens.raw} for
 * {@link getQQUserInfo}.
 */
export async function exchangeQQCode(params: {
  appId: string;
  appKey: string;
  code: string;
  redirectURI: string;
  useUnionId?: boolean;
  fetch?: FetchLike;
}): Promise<OAuth2Tokens> {
  const fetchImpl = params.fetch ?? globalThis.fetch;

  const tokenUrl = `${TOKEN_ENDPOINT}?${queryString({
    grant_type: 'authorization_code',
    client_id: params.appId,
    client_secret: params.appKey,
    code: params.code,
    redirect_uri: params.redirectURI,
    fmt: 'json',
  })}`;
  const token = await getJson<QQTokenResponse>(tokenUrl, fetchImpl);
  if (token.error || !token.access_token) {
    throw new Error(
      `QQ token exchange failed (${token.error ?? 'no token'}): ${token.error_description ?? ''}`.trim(),
    );
  }

  const meUrl = `${ME_ENDPOINT}?${queryString({
    access_token: token.access_token,
    unionid: params.useUnionId === false ? undefined : '1',
    fmt: 'json',
  })}`;
  const me = await getJson<QQMeResponse>(meUrl, fetchImpl);
  if (me.error || !me.openid) {
    throw new Error(
      `QQ openid lookup failed (${me.error ?? 'no openid'}): ${me.error_description ?? ''}`.trim(),
    );
  }

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    raw: { openid: me.openid, unionid: me.unionid },
  };
}

/**
 * Resolve a QQ identity (and, best-effort, profile) from tokens produced by
 * {@link exchangeQQCode}. `unionid` is preferred as the id when available.
 */
export async function getQQUserInfo(
  tokens: OAuth2Tokens,
  options: { appId: string; fetch?: FetchLike },
): Promise<OAuth2UserInfo | null> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const openid = tokens.raw?.openid as string | undefined;
  const unionid = tokens.raw?.unionid as string | undefined;
  const id = unionid ?? openid;
  if (!id || !openid || !tokens.accessToken) return id ? { id, emailVerified: false } : null;

  try {
    const url = `${USERINFO_ENDPOINT}?${queryString({
      access_token: tokens.accessToken,
      oauth_consumer_key: options.appId,
      openid,
    })}`;
    const info = await getJson<QQUserInfoResponse>(url, fetchImpl);
    if (info.ret === 0) {
      return {
        id,
        name: info.nickname,
        image: info.figureurl_qq_2 ?? info.figureurl_qq_1 ?? info.figureurl_qq,
        emailVerified: false,
      };
    }
  } catch {
    // Profile read failed; fall through to an id-only identity. QQ never
    // returns an email, so sign-in must not depend on the profile call.
  }
  return { id, emailVerified: false };
}

/** Build the QQ authorize URL. `scope` defaults to `get_user_info`. */
export function qqAuthorizeUrl(
  options: Pick<QQOptions, 'appId'> & { scope?: string },
  params: { redirectURI: string; state: string },
): string {
  const qs = queryString({
    response_type: 'code',
    client_id: options.appId,
    redirect_uri: params.redirectURI,
    scope: options.scope ?? 'get_user_info',
    state: params.state,
  });
  return `${AUTHORIZE_ENDPOINT}?${qs}`;
}

/**
 * Create a QQ provider entry for Better Auth's `genericOAuth` plugin. Drop it
 * into `createCoinfraAuth({ oauthProviders: [qq(...)] })`.
 */
export function qq(options: QQOptions): GenericOAuthConfig {
  return {
    providerId: options.providerId ?? 'qq',
    clientId: options.appId,
    clientSecret: options.appKey,
    scopes: ['get_user_info'],
    authorizationUrl: AUTHORIZE_ENDPOINT,
    redirectURI: options.redirectURI,
    pkce: false,
    overrideUserInfo: options.overrideUserInfo,
    getToken: ({ code, redirectURI }) =>
      exchangeQQCode({
        appId: options.appId,
        appKey: options.appKey,
        code,
        redirectURI: options.redirectURI ?? redirectURI,
        useUnionId: options.useUnionId,
        fetch: options.fetch,
      }),
    getUserInfo: (tokens) => getQQUserInfo(tokens, { appId: options.appId, fetch: options.fetch }),
  };
}
