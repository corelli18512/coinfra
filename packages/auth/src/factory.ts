import { betterAuth } from 'better-auth';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import type {
  BetterAuthOptions,
  BetterAuthPlugin,
  CoinfraAuthConfig,
  GenericOAuthConfig,
} from './types.js';

const DAY_SECONDS = 60 * 60 * 24;

/**
 * coinfra house defaults, applied *underneath* the caller's options — the
 * caller always wins. Intentionally light in v0.1: it exists as the single,
 * documented place to evolve shared defaults as the products converge, without
 * every app re-deciding them.
 */
function applyHousePreset(options: BetterAuthOptions): BetterAuthOptions {
  return {
    ...options,
    session: {
      // Long-lived sessions suit the app mix (mobile + desktop); rolled forward
      // at most once a day. Override per app by passing your own `session`.
      expiresIn: 30 * DAY_SECONDS,
      updateAge: DAY_SECONDS,
      ...options.session,
    },
  };
}

/**
 * Create a coinfra-flavoured Better Auth instance.
 *
 * Returns the **real** Better Auth instance (`.api`, `.handler`, `.$context`
 * are all genuine) — coinfra only layers on a house preset and folds any
 * `oauthProviders` into a single `genericOAuth` plugin. Treat the result
 * exactly as you would the value from `betterAuth(...)`.
 */
export function createCoinfraAuth(config: CoinfraAuthConfig) {
  const { oauthProviders, plugins, ...rest } = config;

  const mergedPlugins: BetterAuthPlugin[] = plugins ? [...plugins] : [];
  const providers: GenericOAuthConfig[] = oauthProviders ? [...oauthProviders] : [];
  if (providers.length > 0) {
    mergedPlugins.push(genericOAuth({ config: providers }));
  }

  return betterAuth(applyHousePreset({ ...rest, plugins: mergedPlugins }));
}
