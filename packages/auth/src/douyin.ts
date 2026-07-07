/**
 * Douyin (抖音 / TikTok China open platform) sign-in.
 *
 * Douyin's OAuth2 has its own dialect: the client credential is `client_key`
 * (not `client_id`), every response nests its payload under a `data` envelope
 * with an `error_code`, and the user id comes back as `open_id` (plus a
 * cross-app `union_id`). {@link douyin} folds those quirks into Better Auth's
 * `genericOAuth` `getToken` / `getUserInfo` hooks.
 */
import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';
import { type FetchLike, postForm, queryString } from './internal/http.js';
import type { OAuth2Tokens, OAuth2UserInfo } from './internal/oauth.js';

const AUTHORIZE_ENDPOINT = 'https://open.douyin.com/platform/oauth/connect/';
const TOKEN_ENDPOINT = 'https://open.douyin.com/oauth/access_token/';
const USERINFO_ENDPOINT = 'https://open.douyin.com/oauth/userinfo/';

/** Options for the {@link douyin} connector. */
export interface DouyinOptions {
  /** Provider id used in callback routes. @default "douyin" */
  providerId?: string;
  /** Client key (client_key). */
  clientKey: string;
  /** Client secret. */
  clientSecret: string;
  /** Fixed redirect URI, if not using Better Auth's default callback. */
  redirectURI?: string;
  /** OAuth scope. @default "user_info" */
  scope?: string;
  /** Forwarded to `genericOAuth`. */
  overrideUserInfo?: boolean;
  /** Injected `fetch`, for tests. @default globalThis.fetch */
  fetch?: FetchLike;
}

interface DouyinEnvelope<T> {
  message?: string;
  data?: T & { error_code?: number; description?: string };
}

interface DouyinTokenData {
  access_token?: string;
  open_id?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

interface DouyinUserData {
  open_id?: string;
  union_id?: string;
  nickname?: string;
  avatar?: string;
  gender?: number;
}

/**
 * Exchange a Douyin login `code` for tokens. `open_id`/`union_id` are stashed in
 * {@link OAuth2Tokens.raw} for {@link getDouyinUserInfo}.
 */
export async function exchangeDouyinCode(params: {
  clientKey: string;
  clientSecret: string;
  code: string;
  fetch?: FetchLike;
}): Promise<OAuth2Tokens> {
  const fetchImpl = params.fetch ?? globalThis.fetch;
  const { data } = await postForm<DouyinEnvelope<DouyinTokenData>>(
    TOKEN_ENDPOINT,
    {
      client_key: params.clientKey,
      client_secret: params.clientSecret,
      code: params.code,
      grant_type: 'authorization_code',
    },
    fetchImpl,
  );
  if (!data || data.error_code || !data.access_token || !data.open_id) {
    throw new Error(
      `Douyin token exchange failed (${data?.error_code ?? 'no token'}): ${data?.description ?? ''}`.trim(),
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    raw: { open_id: data.open_id },
  };
}

/**
 * Resolve a Douyin identity and profile from tokens produced by
 * {@link exchangeDouyinCode}. `union_id` is preferred as the id when present.
 */
export async function getDouyinUserInfo(
  tokens: OAuth2Tokens,
  options: { fetch?: FetchLike } = {},
): Promise<OAuth2UserInfo | null> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const openId = tokens.raw?.open_id as string | undefined;
  if (!openId || !tokens.accessToken) return null;

  try {
    const { data } = await postForm<DouyinEnvelope<DouyinUserData>>(
      USERINFO_ENDPOINT,
      { access_token: tokens.accessToken, open_id: openId },
      fetchImpl,
    );
    if (data && !data.error_code) {
      return {
        id: data.union_id ?? data.open_id ?? openId,
        name: data.nickname,
        image: data.avatar,
        emailVerified: false,
      };
    }
  } catch {
    // Profile read failed; fall through to an open_id-only identity.
  }
  return { id: openId, emailVerified: false };
}

/** Build the Douyin authorize URL. */
export function douyinAuthorizeUrl(
  options: Pick<DouyinOptions, 'clientKey' | 'scope'>,
  params: { redirectURI: string; state: string },
): string {
  const qs = queryString({
    client_key: options.clientKey,
    response_type: 'code',
    scope: options.scope ?? 'user_info',
    redirect_uri: params.redirectURI,
    state: params.state,
  });
  return `${AUTHORIZE_ENDPOINT}?${qs}`;
}

/**
 * Create a Douyin provider entry for Better Auth's `genericOAuth` plugin. Drop
 * it into `createCoinfraAuth({ oauthProviders: [douyin(...)] })`.
 */
export function douyin(options: DouyinOptions): GenericOAuthConfig {
  return {
    providerId: options.providerId ?? 'douyin',
    clientId: options.clientKey,
    clientSecret: options.clientSecret,
    scopes: [options.scope ?? 'user_info'],
    authorizationUrl: AUTHORIZE_ENDPOINT,
    // Douyin keys the authorize request by `client_key`, not `client_id`.
    authorizationUrlParams: { client_key: options.clientKey },
    redirectURI: options.redirectURI,
    pkce: false,
    overrideUserInfo: options.overrideUserInfo,
    getToken: ({ code }) =>
      exchangeDouyinCode({
        clientKey: options.clientKey,
        clientSecret: options.clientSecret,
        code,
        fetch: options.fetch,
      }),
    getUserInfo: (tokens) => getDouyinUserInfo(tokens, { fetch: options.fetch }),
  };
}
