# @coinfra/auth

## 0.3.0

### Minor Changes

- 220132a: Extend the sign-in wheel with the rest of the domestic-China surface, all as native Better
  Auth shapes (a `genericOAuth` config or an `SmsProvider`) so they compose with `betterAuth()`
  directly — no lock-in.

  - **More OAuth connectors**, each a subpath export with the provider's quirks folded in:
    **Alipay / 支付宝** (`@coinfra/auth/alipay`, RSA2 `SHA256withRSA` gateway request signing),
    **QQ** (`@coinfra/auth/qq`, `openid`/`unionid` lookup), **Weibo / 微博**
    (`@coinfra/auth/weibo`), **Douyin / 抖音** (`@coinfra/auth/douyin`, `client_key` flow),
    **DingTalk / 钉钉** (`@coinfra/auth/dingtalk`, header-token profile call), and
    **Feishu / 飞书** (`@coinfra/auth/feishu`, v2 JSON token with a Lark domain switch).
  - **More SMS gateways** (`@coinfra/auth/sms`): `tencentSms()` (Tencent Cloud
    TC3-HMAC-SHA256) and `twilioSms()` (overseas default) alongside the existing `aliyunSms()`.
  - **WeChat Mini Program phone number** (`@coinfra/auth/wechat`):
    `getWeChatMiniProgramPhoneNumber()` (AES-128-CBC decrypt of `encryptedData` + `iv` with
    watermark verification) and `getWeChatMiniProgramPhoneNumberByCode()` (the modern
    code-exchange route, no client-side crypto).

  A shared internal Web Crypto module (HMAC-SHA256, SHA-256, AES-CBC, RSA-SHA256 signing)
  underpins the new signing/decryption paths, keeping everything cross-platform (Node, Deno,
  Bun, edge, browsers). Connectors are unit-tested through an injected `fetch` (106 tests
  total); live provider behaviour still requires real credentials.

## 0.2.0

### Minor Changes

- 4c25b39: Add `@coinfra/auth`, the sign-in wheel. It extends Better Auth (rather than wrapping it):
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
