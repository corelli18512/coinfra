/**
 * Alipay (支付宝) sign-in.
 *
 * Unlike the other connectors, Alipay's OpenAPI gateway authenticates every
 * request with an **RSA2** signature (SHA256withRSA) over the sorted request
 * params rather than a shared client secret. {@link alipay} implements that
 * signing once (via cross-platform Web Crypto) and folds the two gateway calls —
 * `alipay.system.oauth.token` to exchange the `auth_code`, then the optional
 * `alipay.user.info.share` for the profile — into Better Auth's `genericOAuth`
 * `getToken` / `getUserInfo` hooks.
 *
 * `appPrivateKey` must be an unencrypted **PKCS#8** RSA key
 * (`-----BEGIN PRIVATE KEY-----`). Web Crypto cannot import the PKCS#1 form the
 * Alipay key generator sometimes emits; convert it once with
 * `openssl pkcs8 -topk8 -nocrypt -in app_private_key.pem`.
 */
import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';
import { rsaSha256SignBase64 } from './internal/crypto.js';
import { type FetchLike, postForm } from './internal/http.js';
import type { OAuth2Tokens, OAuth2UserInfo } from './internal/oauth.js';

const GATEWAY = 'https://openapi.alipay.com/gateway.do';
const AUTHORIZE_PAGE = 'https://openauth.alipay.com/oauth2/publicAppAuthorize.htm';

/** Options for the {@link alipay} connector. */
export interface AlipayOptions {
  /** Provider id used in callback routes. @default "alipay" */
  providerId?: string;
  /** App ID (APPID). */
  appId: string;
  /** Application private key, PKCS#8 PEM (`-----BEGIN PRIVATE KEY-----`). */
  appPrivateKey: string;
  /**
   * `auth_user` requests profile access (name/avatar); `auth_base` is silent and
   * yields only the `user_id`. @default "auth_user"
   */
  scope?: 'auth_user' | 'auth_base';
  /**
   * Read the member profile via `alipay.user.info.share` after the token
   * exchange. Requires the member-info permission on the app; on failure the
   * sign-in still succeeds with a user_id-only identity. @default true
   */
  fetchProfile?: boolean;
  /** Gateway endpoint override. @default "https://openapi.alipay.com/gateway.do" */
  gateway?: string;
  /** Fixed redirect URI, if not using Better Auth's default callback. */
  redirectURI?: string;
  /** Forwarded to `genericOAuth`. */
  overrideUserInfo?: boolean;
  /** Injected `fetch`, for tests. @default globalThis.fetch */
  fetch?: FetchLike;
  /** Clock, for deterministic tests. @default Date.now */
  now?: () => number;
}

interface AlipayTokenResponse {
  alipay_system_oauth_token_response?: {
    access_token?: string;
    user_id?: string;
    alipay_user_id?: string;
    expires_in?: number;
    refresh_token?: string;
  };
  error_response?: { code?: string; msg?: string; sub_code?: string; sub_msg?: string };
}

interface AlipayUserInfoResponse {
  alipay_user_info_share_response?: {
    code?: string;
    msg?: string;
    sub_msg?: string;
    user_id?: string;
    avatar?: string;
    nick_name?: string;
    province?: string;
    city?: string;
    gender?: string;
  };
  error_response?: { code?: string; msg?: string; sub_code?: string; sub_msg?: string };
}

/** Format a timestamp as Alipay's `yyyy-MM-dd HH:mm:ss` in Beijing time (GMT+8). */
function alipayTimestamp(now: () => number): string {
  const d = new Date(now() + 8 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/**
 * Compute Alipay's RSA2 `sign` for a set of gateway params: the params (minus
 * `sign` and empties) are sorted by key, joined as `k=v&k=v` with **raw** values,
 * and signed SHA256withRSA. Exported for testing.
 */
export async function signAlipayRequest(
  params: Record<string, string | undefined>,
  appPrivateKey: string,
): Promise<string> {
  const signString = Object.keys(params)
    .filter((key) => key !== 'sign' && params[key] !== undefined && params[key] !== '')
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return rsaSha256SignBase64(appPrivateKey, signString);
}

/** Assemble, sign, and POST a gateway request, returning the parsed JSON. */
async function callGateway<T>(
  gateway: string,
  system: Record<string, string | undefined>,
  appPrivateKey: string,
  fetchImpl: FetchLike,
): Promise<T> {
  const params: Record<string, string | undefined> = {
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    version: '1.0',
    ...system,
  };
  params.sign = await signAlipayRequest(params, appPrivateKey);
  return postForm<T>(gateway, params, fetchImpl);
}

/**
 * Exchange an Alipay `auth_code` for tokens. The `user_id` (the 2088… member id)
 * is stashed in {@link OAuth2Tokens.raw} for {@link getAlipayUserInfo}.
 */
export async function exchangeAlipayCode(params: {
  appId: string;
  appPrivateKey: string;
  code: string;
  gateway?: string;
  now?: () => number;
  fetch?: FetchLike;
}): Promise<OAuth2Tokens> {
  const fetchImpl = params.fetch ?? globalThis.fetch;
  const data = await callGateway<AlipayTokenResponse>(
    params.gateway ?? GATEWAY,
    {
      app_id: params.appId,
      method: 'alipay.system.oauth.token',
      timestamp: alipayTimestamp(params.now ?? Date.now),
      grant_type: 'authorization_code',
      code: params.code,
    },
    params.appPrivateKey,
    fetchImpl,
  );

  const ok = data.alipay_system_oauth_token_response;
  if (data.error_response || !ok?.access_token) {
    const err = data.error_response;
    throw new Error(
      `Alipay token exchange failed (${err?.sub_code ?? err?.code ?? 'no token'}): ${err?.sub_msg ?? err?.msg ?? ''}`.trim(),
    );
  }
  return {
    accessToken: ok.access_token,
    refreshToken: ok.refresh_token,
    raw: { user_id: ok.user_id ?? ok.alipay_user_id },
  };
}

/**
 * Resolve an Alipay identity (and, best-effort, profile) from tokens produced by
 * {@link exchangeAlipayCode}. Falls back to a user_id-only identity when the
 * profile call is disabled or the app lacks member-info permission.
 */
export async function getAlipayUserInfo(
  tokens: OAuth2Tokens,
  options: {
    appId: string;
    appPrivateKey: string;
    fetchProfile?: boolean;
    gateway?: string;
    now?: () => number;
    fetch?: FetchLike;
  },
): Promise<OAuth2UserInfo | null> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const userId = tokens.raw?.user_id as string | undefined;

  if (options.fetchProfile !== false && tokens.accessToken) {
    try {
      const data = await callGateway<AlipayUserInfoResponse>(
        options.gateway ?? GATEWAY,
        {
          app_id: options.appId,
          method: 'alipay.user.info.share',
          timestamp: alipayTimestamp(options.now ?? Date.now),
          auth_token: tokens.accessToken,
        },
        options.appPrivateKey,
        fetchImpl,
      );
      const profile = data.alipay_user_info_share_response;
      if (profile?.code === '10000' && (profile.user_id ?? userId)) {
        return {
          id: (profile.user_id ?? userId) as string,
          name: profile.nick_name,
          image: profile.avatar,
          emailVerified: false,
        };
      }
    } catch {
      // Member-info permission not granted or transient failure — fall through
      // to the user_id-only identity below.
    }
  }

  return userId ? { id: userId, emailVerified: false } : null;
}

/** Build the Alipay authorize URL. */
export function alipayAuthorizeUrl(
  options: Pick<AlipayOptions, 'appId' | 'scope'>,
  params: { redirectURI: string; state: string },
): string {
  const search = new URLSearchParams({
    app_id: options.appId,
    scope: options.scope ?? 'auth_user',
    redirect_uri: params.redirectURI,
    state: params.state,
  });
  return `${AUTHORIZE_PAGE}?${search.toString()}`;
}

/**
 * Create an Alipay provider entry for Better Auth's `genericOAuth` plugin. Drop
 * it into `createCoinfraAuth({ oauthProviders: [alipay(...)] })`.
 */
export function alipay(options: AlipayOptions): GenericOAuthConfig {
  return {
    providerId: options.providerId ?? 'alipay',
    clientId: options.appId,
    // Alipay authenticates with an RSA key, not a client secret.
    scopes: [options.scope ?? 'auth_user'],
    authorizationUrl: AUTHORIZE_PAGE,
    // Alipay keys the authorize request by `app_id`, not `client_id`.
    authorizationUrlParams: { app_id: options.appId },
    redirectURI: options.redirectURI,
    pkce: false,
    overrideUserInfo: options.overrideUserInfo,
    getToken: ({ code }) =>
      exchangeAlipayCode({
        appId: options.appId,
        appPrivateKey: options.appPrivateKey,
        code,
        gateway: options.gateway,
        now: options.now,
        fetch: options.fetch,
      }),
    getUserInfo: (tokens) =>
      getAlipayUserInfo(tokens, {
        appId: options.appId,
        appPrivateKey: options.appPrivateKey,
        fetchProfile: options.fetchProfile,
        gateway: options.gateway,
        now: options.now,
        fetch: options.fetch,
      }),
  };
}
