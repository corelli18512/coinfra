import type { betterAuth } from 'better-auth';
import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';

/**
 * Better Auth's own options object, derived from `betterAuth()` itself so the
 * type can never drift from the installed version. Anything Better Auth
 * accepts, coinfra accepts.
 */
export type BetterAuthOptions = NonNullable<Parameters<typeof betterAuth>[0]>;

/** A single Better Auth plugin, as accepted by `betterAuth({ plugins })`. */
export type BetterAuthPlugin = NonNullable<BetterAuthOptions['plugins']>[number];

/**
 * One provider entry for Better Auth's built-in `genericOAuth` plugin. This is
 * exactly what `wechat()` and `wecom()` return, so they compose with the native
 * `genericOAuth({ config: [...] })` API as well as with {@link CoinfraAuthConfig}.
 */
export type { GenericOAuthConfig };

/**
 * Configuration for `createCoinfraAuth`: everything `betterAuth()` accepts, plus
 * an optional `oauthProviders` array of coinfra OAuth connectors.
 */
export type CoinfraAuthConfig = BetterAuthOptions & {
  /**
   * coinfra OAuth providers (e.g. `wechat()`, `wecom()`). They are bundled into
   * a single Better Auth `genericOAuth` plugin for you — equivalent to adding
   * `genericOAuth({ config: [...] })` to `plugins` yourself, just less wiring.
   */
  readonly oauthProviders?: readonly GenericOAuthConfig[];
};
