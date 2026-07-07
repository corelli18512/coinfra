/**
 * Weibo (新浪微博) sign-in.
 *
 * Standard OAuth2: the login `code` is exchanged (as a form POST) for an
 * `access_token` plus the user's `uid`, then `users/show.json` returns the
 * profile. Weibo never returns an email. {@link weibo} plugs this into Better
 * Auth's `genericOAuth` plugin through its `getToken` / `getUserInfo` hooks.
 */
import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';
import { type FetchLike, getJson, postForm, queryString } from './internal/http.js';
import type { OAuth2Tokens, OAuth2UserInfo } from './internal/oauth.js';

const AUTHORIZE_ENDPOINT = 'https://api.weibo.com/oauth2/authorize';
const TOKEN_ENDPOINT = 'https://api.weibo.com/oauth2/access_token';
const USERINFO_ENDPOINT = 'https://api.weibo.com/2/users/show.json';

/** Options for the {@link weibo} connector. */
export interface WeiboOptions {
  /** Provider id used in callback routes. @default "weibo" */
  providerId?: string;
  /** App Key (client id). */
  appKey: string;
  /** App Secret (client secret). */
  appSecret: string;
  /** Fixed redirect URI, if not using Better Auth's default callback. */
  redirectURI?: string;
  /** Forwarded to `genericOAuth`. */
  overrideUserInfo?: boolean;
  /** Injected `fetch`, for tests. @default globalThis.fetch */
  fetch?: FetchLike;
}

interface WeiboTokenResponse {
  access_token?: string;
  expires_in?: number;
  uid?: string;
  error?: string;
  error_code?: number;
  error_description?: string;
}

interface WeiboUserResponse {
  id?: number;
  idstr?: string;
  screen_name?: string;
  name?: string;
  profile_image_url?: string;
  avatar_large?: string;
  avatar_hd?: string;
  error?: string;
  error_code?: number;
}

/**
 * Exchange a Weibo login `code` for tokens. The `uid` is stashed in
 * {@link OAuth2Tokens.raw} for {@link getWeiboUserInfo}.
 */
export async function exchangeWeiboCode(params: {
  appKey: string;
  appSecret: string;
  code: string;
  redirectURI: string;
  fetch?: FetchLike;
}): Promise<OAuth2Tokens> {
  const fetchImpl = params.fetch ?? globalThis.fetch;
  const token = await postForm<WeiboTokenResponse>(
    TOKEN_ENDPOINT,
    {
      client_id: params.appKey,
      client_secret: params.appSecret,
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectURI,
    },
    fetchImpl,
  );
  if (token.error || !token.access_token || !token.uid) {
    throw new Error(
      `Weibo token exchange failed (${token.error_code ?? token.error ?? 'no token'}): ${token.error_description ?? ''}`.trim(),
    );
  }
  return { accessToken: token.access_token, raw: { uid: token.uid } };
}

/**
 * Resolve a Weibo identity and profile from tokens produced by
 * {@link exchangeWeiboCode}. Falls back to a uid-only identity if the profile
 * call fails.
 */
export async function getWeiboUserInfo(
  tokens: OAuth2Tokens,
  options: { fetch?: FetchLike } = {},
): Promise<OAuth2UserInfo | null> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const uid = tokens.raw?.uid as string | undefined;
  if (!uid || !tokens.accessToken) return uid ? { id: uid, emailVerified: false } : null;

  try {
    const url = `${USERINFO_ENDPOINT}?${queryString({ access_token: tokens.accessToken, uid })}`;
    const user = await getJson<WeiboUserResponse>(url, fetchImpl);
    if (!user.error) {
      return {
        id: uid,
        name: user.screen_name ?? user.name,
        image: user.avatar_hd ?? user.avatar_large ?? user.profile_image_url,
        emailVerified: false,
      };
    }
  } catch {
    // Profile read failed; fall through to a uid-only identity.
  }
  return { id: uid, emailVerified: false };
}

/** Build the Weibo authorize URL. */
export function weiboAuthorizeUrl(
  options: Pick<WeiboOptions, 'appKey'>,
  params: { redirectURI: string; state: string },
): string {
  const qs = queryString({
    client_id: options.appKey,
    redirect_uri: params.redirectURI,
    response_type: 'code',
    state: params.state,
  });
  return `${AUTHORIZE_ENDPOINT}?${qs}`;
}

/**
 * Create a Weibo provider entry for Better Auth's `genericOAuth` plugin. Drop it
 * into `createCoinfraAuth({ oauthProviders: [weibo(...)] })`.
 */
export function weibo(options: WeiboOptions): GenericOAuthConfig {
  return {
    providerId: options.providerId ?? 'weibo',
    clientId: options.appKey,
    clientSecret: options.appSecret,
    authorizationUrl: AUTHORIZE_ENDPOINT,
    redirectURI: options.redirectURI,
    pkce: false,
    overrideUserInfo: options.overrideUserInfo,
    getToken: ({ code, redirectURI }) =>
      exchangeWeiboCode({
        appKey: options.appKey,
        appSecret: options.appSecret,
        code,
        redirectURI: options.redirectURI ?? redirectURI,
        fetch: options.fetch,
      }),
    getUserInfo: (tokens) => getWeiboUserInfo(tokens, { fetch: options.fetch }),
  };
}
