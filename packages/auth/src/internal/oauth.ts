import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';

/**
 * Better Auth's OAuth token and user-info shapes, derived straight from the
 * `genericOAuth` config hooks so they track the installed version exactly.
 *
 * `OAuth2Tokens.raw` is the important one for China providers: it carries
 * provider-specific fields (WeChat's `openid`, WeCom's `userid`) from
 * `getToken` through to `getUserInfo`.
 */
export type OAuth2Tokens = Awaited<ReturnType<NonNullable<GenericOAuthConfig['getToken']>>>;

export type OAuth2UserInfo = NonNullable<
  Awaited<ReturnType<NonNullable<GenericOAuthConfig['getUserInfo']>>>
>;
