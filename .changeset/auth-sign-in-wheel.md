---
"@coinfra/auth": minor
---

Add `@coinfra/auth`, the sign-in wheel. It extends Better Auth (rather than wrapping it):
`createCoinfraAuth()` returns the real Better Auth instance, and coinfra contributes the
domestic-China connectors Better Auth lacks plus a house preset.

- **WeChat** (`@coinfra/auth/wechat`): `wechat()` for 开放平台 web QR and 公众号 in-app
  OAuth via `genericOAuth` custom hooks, and `wechatMiniProgram()` — a `jscode2session`
  plugin that signs Mini Program users in with Better Auth's own account linking.
- **WeCom / 企业微信** (`@coinfra/auth/wecom`): `wecom()`, handling the two-step
  `gettoken` → `getuserinfo` flow with best-effort profile enrichment.
- **SMS OTP** (`@coinfra/auth/sms`): `smsOTP()` over Better Auth's `phoneNumber` plugin,
  with a pluggable `SmsProvider` and `aliyunSms()` (Aliyun RPC request signing via Web
  Crypto) as the first gateway.
- **Client** (`@coinfra/auth/client`): `wechatMiniProgramClient()` and `smsOTPClient` for a
  typed browser / native SDK.

Every helper returns a native Better Auth shape, so the connectors compose with
`betterAuth()` / `genericOAuth()` directly — no lock-in. Built with the tsgo (TypeScript 7
native) toolchain; 46 tests covering wiring, parsing, request signing, and the real
send → verify / code → session flows through an injected `fetch`.
