/**
 * Feishu / Lark (飞书) sign-in.
 *
 * Uses Feishu's v2 OAuth: a JSON `POST` exchanges the `code` for an
 * `access_token` (the response is wrapped with a `code: 0` status), then
 * `authen/v1/user_info` returns the profile behind a bearer token. Set
 * `domain: 'lark'` to target the international Lark endpoints
 * (`*.larksuite.com`). The identity is `union_id`, and Feishu returns an email.
 */
import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';
import { type FetchLike, getJson, postJson } from './internal/http.js';
import type { OAuth2Tokens, OAuth2UserInfo } from './internal/oauth.js';

type FeishuDomain = 'feishu' | 'lark';

function bases(domain: FeishuDomain): { open: string; accounts: string } {
  return domain === 'lark'
    ? { open: 'https://open.larksuite.com', accounts: 'https://accounts.larksuite.com' }
    : { open: 'https://open.feishu.cn', accounts: 'https://accounts.feishu.cn' };
}

/** Options for the {@link feishu} connector. */
export interface FeishuOptions {
  /** Provider id used in callback routes. @default "feishu" */
  providerId?: string;
  /** App ID (client id). */
  appId: string;
  /** App Secret (client secret). */
  appSecret: string;
  /** `feishu` (China, *.feishu.cn) or `lark` (international, *.larksuite.com). @default "feishu" */
  domain?: FeishuDomain;
  /** Fixed redirect URI, if not using Better Auth's default callback. */
  redirectURI?: string;
  /** OAuth scope(s). @default undefined (Feishu applies the app's default scopes) */
  scope?: string;
  /** Forwarded to `genericOAuth`. */
  overrideUserInfo?: boolean;
  /** Injected `fetch`, for tests. @default globalThis.fetch */
  fetch?: FetchLike;
}

interface FeishuTokenResponse {
  code?: number;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface FeishuUserResponse {
  code?: number;
  msg?: string;
  data?: {
    name?: string;
    en_name?: string;
    avatar_url?: string;
    avatar_thumb?: string;
    open_id?: string;
    union_id?: string;
    email?: string;
    enterprise_email?: string;
  };
}

/** Exchange a Feishu login `code` for a user access token. */
export async function exchangeFeishuCode(params: {
  appId: string;
  appSecret: string;
  code: string;
  redirectURI?: string;
  domain?: FeishuDomain;
  fetch?: FetchLike;
}): Promise<OAuth2Tokens> {
  const fetchImpl = params.fetch ?? globalThis.fetch;
  const { open } = bases(params.domain ?? 'feishu');
  const token = await postJson<FeishuTokenResponse>(
    `${open}/open-apis/authen/v2/oauth/token`,
    {
      grant_type: 'authorization_code',
      client_id: params.appId,
      client_secret: params.appSecret,
      code: params.code,
      redirect_uri: params.redirectURI,
    },
    fetchImpl,
  );
  if ((token.code !== undefined && token.code !== 0) || !token.access_token) {
    throw new Error(
      `Feishu token exchange failed (${token.error ?? token.code ?? 'no token'}): ${token.error_description ?? ''}`.trim(),
    );
  }
  return { accessToken: token.access_token, refreshToken: token.refresh_token };
}

/** Resolve a Feishu identity and profile. `union_id` is preferred as the id. */
export async function getFeishuUserInfo(
  tokens: OAuth2Tokens,
  options: { domain?: FeishuDomain; fetch?: FetchLike } = {},
): Promise<OAuth2UserInfo | null> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!tokens.accessToken) return null;
  const { open } = bases(options.domain ?? 'feishu');

  const res = await getJson<FeishuUserResponse>(
    `${open}/open-apis/authen/v1/user_info`,
    fetchImpl,
    { authorization: `Bearer ${tokens.accessToken}` },
  );
  const data = res.data;
  const id = data?.union_id ?? data?.open_id;
  if (!data || !id) return null;
  const email = data.email ?? data.enterprise_email;
  return {
    id,
    name: data.name ?? data.en_name,
    email,
    image: data.avatar_url ?? data.avatar_thumb,
    emailVerified: false,
  };
}

/** Build the Feishu/Lark authorize URL. */
export function feishuAuthorizeUrl(
  options: Pick<FeishuOptions, 'appId' | 'domain' | 'scope'>,
  params: { redirectURI: string; state: string },
): string {
  const { accounts } = bases(options.domain ?? 'feishu');
  const search = new URLSearchParams({
    client_id: options.appId,
    redirect_uri: params.redirectURI,
    response_type: 'code',
    state: params.state,
  });
  if (options.scope) search.set('scope', options.scope);
  return `${accounts}/open-apis/authen/v1/authorize?${search.toString()}`;
}

/**
 * Create a Feishu/Lark provider entry for Better Auth's `genericOAuth` plugin.
 * Drop it into `createCoinfraAuth({ oauthProviders: [feishu(...)] })`.
 */
export function feishu(options: FeishuOptions): GenericOAuthConfig {
  const { accounts } = bases(options.domain ?? 'feishu');
  return {
    providerId: options.providerId ?? 'feishu',
    clientId: options.appId,
    clientSecret: options.appSecret,
    scopes: options.scope ? [options.scope] : undefined,
    authorizationUrl: `${accounts}/open-apis/authen/v1/authorize`,
    redirectURI: options.redirectURI,
    pkce: false,
    overrideUserInfo: options.overrideUserInfo,
    getToken: ({ code, redirectURI }) =>
      exchangeFeishuCode({
        appId: options.appId,
        appSecret: options.appSecret,
        code,
        redirectURI: options.redirectURI ?? redirectURI,
        domain: options.domain,
        fetch: options.fetch,
      }),
    getUserInfo: (tokens) =>
      getFeishuUserInfo(tokens, { domain: options.domain, fetch: options.fetch }),
  };
}
