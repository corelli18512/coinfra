/**
 * DingTalk (钉钉) sign-in.
 *
 * DingTalk's current (v2) OAuth is clean JSON but non-standard in two ways
 * {@link dingtalk} handles: the token exchange is a JSON `POST` to
 * `userAccessToken` (returning `accessToken`, camelCase), and the profile call
 * authenticates with an `x-acs-dingtalk-access-token` header rather than a
 * bearer token. The identity is `unionId` (stable across the org), and DingTalk
 * does return an email.
 */
import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';
import { type FetchLike, getJson, postJson, queryString } from './internal/http.js';
import type { OAuth2Tokens, OAuth2UserInfo } from './internal/oauth.js';

const AUTHORIZE_ENDPOINT = 'https://login.dingtalk.com/oauth2/auth';
const TOKEN_ENDPOINT = 'https://api.dingtalk.com/v1.0/oauth2/userAccessToken';
const USERINFO_ENDPOINT = 'https://api.dingtalk.com/v1.0/contact/users/me';

/** Options for the {@link dingtalk} connector. */
export interface DingTalkOptions {
  /** Provider id used in callback routes. @default "dingtalk" */
  providerId?: string;
  /** App key / client id. */
  clientId: string;
  /** App secret / client secret. */
  clientSecret: string;
  /** Fixed redirect URI, if not using Better Auth's default callback. */
  redirectURI?: string;
  /** Forwarded to `genericOAuth`. */
  overrideUserInfo?: boolean;
  /** Injected `fetch`, for tests. @default globalThis.fetch */
  fetch?: FetchLike;
}

interface DingTalkTokenResponse {
  accessToken?: string;
  refreshToken?: string;
  expireIn?: number;
  corpId?: string;
}

interface DingTalkUserResponse {
  nick?: string;
  avatarUrl?: string;
  email?: string;
  openId?: string;
  unionId?: string;
  mobile?: string;
  stateCode?: string;
}

/**
 * Exchange a DingTalk login `code` for a user access token. `corpId` is stashed
 * in {@link OAuth2Tokens.raw}.
 */
export async function exchangeDingTalkCode(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  fetch?: FetchLike;
}): Promise<OAuth2Tokens> {
  const fetchImpl = params.fetch ?? globalThis.fetch;
  const token = await postJson<DingTalkTokenResponse>(
    TOKEN_ENDPOINT,
    {
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      code: params.code,
      grantType: 'authorization_code',
    },
    fetchImpl,
  );
  if (!token.accessToken) {
    throw new Error('DingTalk token exchange returned no accessToken');
  }
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    raw: { corpId: token.corpId },
  };
}

/**
 * Resolve a DingTalk identity and profile. `unionId` is preferred as the id.
 */
export async function getDingTalkUserInfo(
  tokens: OAuth2Tokens,
  options: { fetch?: FetchLike } = {},
): Promise<OAuth2UserInfo | null> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!tokens.accessToken) return null;

  const user = await getJson<DingTalkUserResponse>(USERINFO_ENDPOINT, fetchImpl, {
    'x-acs-dingtalk-access-token': tokens.accessToken,
  });
  const id = user.unionId ?? user.openId;
  if (!id) return null;
  return {
    id,
    name: user.nick,
    email: user.email,
    image: user.avatarUrl,
    emailVerified: false,
  };
}

/** Build the DingTalk authorize URL. `scope` defaults to `openid`. */
export function dingtalkAuthorizeUrl(
  options: Pick<DingTalkOptions, 'clientId'> & { scope?: string },
  params: { redirectURI: string; state: string },
): string {
  const qs = queryString({
    client_id: options.clientId,
    response_type: 'code',
    scope: options.scope ?? 'openid',
    redirect_uri: params.redirectURI,
    prompt: 'consent',
    state: params.state,
  });
  return `${AUTHORIZE_ENDPOINT}?${qs}`;
}

/**
 * Create a DingTalk provider entry for Better Auth's `genericOAuth` plugin. Drop
 * it into `createCoinfraAuth({ oauthProviders: [dingtalk(...)] })`.
 */
export function dingtalk(options: DingTalkOptions): GenericOAuthConfig {
  return {
    providerId: options.providerId ?? 'dingtalk',
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    scopes: ['openid'],
    authorizationUrl: AUTHORIZE_ENDPOINT,
    redirectURI: options.redirectURI,
    pkce: false,
    prompt: 'consent',
    overrideUserInfo: options.overrideUserInfo,
    getToken: ({ code }) =>
      exchangeDingTalkCode({
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        code,
        fetch: options.fetch,
      }),
    getUserInfo: (tokens) => getDingTalkUserInfo(tokens, { fetch: options.fetch }),
  };
}
