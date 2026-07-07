/**
 * `@coinfra/auth` — the sign-in wheel.
 *
 * coinfra **extends** Better Auth, it does not wrap it. {@link createCoinfraAuth}
 * returns the real Better Auth instance; the connectors (`@coinfra/auth/wechat`,
 * `/wecom`, `/alipay`, `/qq`, `/weibo`, `/douyin`, `/dingtalk`, `/feishu`, `/sms`)
 * return native Better Auth shapes you can also use directly.
 */
export { createCoinfraAuth } from './factory.js';
export type {
  BetterAuthOptions,
  BetterAuthPlugin,
  CoinfraAuthConfig,
  GenericOAuthConfig,
} from './types.js';
