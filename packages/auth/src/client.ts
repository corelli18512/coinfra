/**
 * Client plugins for coinfra's custom auth flows.
 *
 * Pair these with `createAuthClient` (from `better-auth/react`, `/vue`,
 * `/svelte`, `/solid`, or the vanilla `better-auth/client`) so the browser /
 * native SDK gains a typed method for each coinfra endpoint. Mainstream flows
 * (email, social OAuth, passkeys, …) are already covered by Better Auth's own
 * client plugins — import those from `better-auth/client/plugins` as usual.
 *
 * @example
 * ```ts
 * import { createAuthClient } from 'better-auth/react';
 * import { wechatMiniProgramClient, smsOTPClient } from '@coinfra/auth/client';
 *
 * export const authClient = createAuthClient({
 *   plugins: [wechatMiniProgramClient(), smsOTPClient()],
 * });
 *
 * await authClient.signInWeChatMiniProgram({ code });
 * await authClient.phoneNumber.sendOtp({ phoneNumber });
 * ```
 */
import type { BetterAuthClientPlugin } from 'better-auth/client';

/**
 * The SMS-OTP client. `smsOTP()` on the server is Better Auth's `phoneNumber`
 * plugin, so its client pair is Better Auth's `phoneNumberClient` — re-exported
 * here so both halves live under `@coinfra/auth`. Exposes
 * `authClient.phoneNumber.*` and `authClient.signIn.phoneNumber(...)`.
 */
export { phoneNumberClient as smsOTPClient } from 'better-auth/client/plugins';

/** Extra per-call fetch options, forwarded verbatim to the underlying request. */
type FetchOptions = Record<string, unknown>;

/**
 * Client plugin for the {@link wechatMiniProgram} server plugin. Adds
 * `authClient.signInWeChatMiniProgram({ code })`, which POSTs a `wx.login()`
 * code to `/sign-in/wechat-miniprogram` and, on success, establishes the
 * session (the `$sessionSignal` listener refreshes `useSession` for you).
 */
export function wechatMiniProgramClient() {
  return {
    id: 'wechat-miniprogram',
    $InferServerPlugin: {},
    pathMethods: { '/sign-in/wechat-miniprogram': 'POST' },
    atomListeners: [
      {
        matcher: (path: string) => path === '/sign-in/wechat-miniprogram',
        signal: '$sessionSignal',
      },
    ],
    getActions: ($fetch) => ({
      signInWeChatMiniProgram: (params: { code: string }, fetchOptions?: FetchOptions) =>
        $fetch('/sign-in/wechat-miniprogram', {
          method: 'POST',
          body: { code: params.code },
          ...fetchOptions,
        }),
    }),
  } satisfies BetterAuthClientPlugin;
}
