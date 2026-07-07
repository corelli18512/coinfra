# @coinfra/auth

**The sign-in wheel. [Better Auth](https://better-auth.com) as the engine, extended — not
wrapped — with the domestic-China connectors it lacks (WeChat, WeCom, Alipay, QQ, Weibo,
Douyin, DingTalk, Feishu, and SMS OTP) and a coinfra house preset. An embedded library:
each app runs it in-process, no standalone identity server.**

`createCoinfraAuth()` returns the **real** Better Auth instance — its `.api`, its
`authClient`, its plugins are all native. coinfra adds the pieces Better Auth doesn't ship
and gets out of the way. Mainstream providers (Apple, Google, GitHub, email, passkeys) are
already Better Auth built-ins; use them directly.

## Install

```bash
pnpm add @coinfra/auth better-auth
```

`better-auth` is a peer dependency, so your app pins the engine version. Requires a runtime
with the Web Crypto API (Node 20+, Deno, Bun, edge, browsers).

## Quick start

```ts
import { createCoinfraAuth } from '@coinfra/auth';
import { wechat } from '@coinfra/auth/wechat';
import { wecom } from '@coinfra/auth/wecom';
import { smsOTP, aliyunSms } from '@coinfra/auth/sms';

export const auth = createCoinfraAuth({
  database: myAdapter,                 // any Better Auth database adapter
  emailAndPassword: { enabled: true }, // Better Auth built-ins, untouched

  // coinfra OAuth connectors are folded into one genericOAuth plugin:
  oauthProviders: [
    wechat({ appId: WECHAT_APP_ID, appSecret: WECHAT_SECRET }),
    wecom({ corpId: CORP_ID, corpSecret: CORP_SECRET, agentId: AGENT_ID }),
  ],

  // non-OAuth flows are Better Auth plugins:
  plugins: [
    smsOTP({ provider: aliyunSms({ accessKeyId, accessKeySecret, signName, templateCode }) }),
  ],
});

// `auth` IS a Better Auth instance — nothing is proxied.
auth.api.getSession(/* … */);
```

## What coinfra adds

| Subpath | Exports | Returns |
|---|---|---|
| `@coinfra/auth` | `createCoinfraAuth`, types | the real Better Auth instance |
| `@coinfra/auth/wechat` | `wechat()`, `wechatMiniProgram()`, `getWeChatMiniProgramPhoneNumber()` | a `genericOAuth` config / a plugin / helpers |
| `@coinfra/auth/wecom` | `wecom()` | a `genericOAuth` config |
| `@coinfra/auth/alipay` | `alipay()` | a `genericOAuth` config |
| `@coinfra/auth/qq` | `qq()` | a `genericOAuth` config |
| `@coinfra/auth/weibo` | `weibo()` | a `genericOAuth` config |
| `@coinfra/auth/douyin` | `douyin()` | a `genericOAuth` config |
| `@coinfra/auth/dingtalk` | `dingtalk()` | a `genericOAuth` config |
| `@coinfra/auth/feishu` | `feishu()` | a `genericOAuth` config |
| `@coinfra/auth/sms` | `smsOTP()`, `aliyunSms()`, `tencentSms()`, `twilioSms()` | a plugin / `SmsProvider`s |
| `@coinfra/auth/client` | `wechatMiniProgramClient()`, `smsOTPClient` | client plugins |

Every helper returns a **native Better Auth shape**, so you can also drop them straight into
`betterAuth({ plugins: [...] })` / `genericOAuth({ config: [...] })` and skip the factory
entirely. Zero lock-in.

### WeChat (微信)

```ts
import { wechat, wechatAuthorizeUrl } from '@coinfra/auth/wechat';

wechat({ appId, appSecret });                        // 开放平台 web QR (snsapi_login)
wechat({ appId, appSecret, mode: 'official-account' }); // 公众号 in-app (snsapi_userinfo)
```

WeChat is not standard OAuth2 — the token/user-info endpoints are keyed by `appid`/`secret`
and return an `openid` — so `wechat()` plugs custom `getToken`/`getUserInfo` hooks into
`genericOAuth`. The one part `genericOAuth` can't render is the authorize **redirect**
(WeChat needs the `appid` param and a trailing `#wechat_redirect`); for the in-app flow,
drive it yourself with `wechatAuthorizeUrl()` and let `genericOAuth` handle only the callback.

### WeChat Mini Program (小程序)

No redirect: the Mini Program calls `wx.login()` for a `code` and POSTs it; the plugin
exchanges it via `jscode2session`, then finds-or-creates the user with Better Auth's own
account linking.

```ts
import { wechatMiniProgram } from '@coinfra/auth/wechat';

createCoinfraAuth({ /* … */, plugins: [wechatMiniProgram({ appId, appSecret })] });
// exposes  auth.api.signInWeChatMiniProgram({ body: { code } })
```

To read the user's phone number, use either route:

```ts
import {
  getWeChatMiniProgramPhoneNumber,       // classic: decrypt encryptedData + iv (AES-128-CBC)
  getWeChatMiniProgramPhoneNumberByCode, // modern: exchange the getPhoneNumber code, no crypto
} from '@coinfra/auth/wechat';

await getWeChatMiniProgramPhoneNumber({ sessionKey, encryptedData, iv, appId }); // verifies watermark
await getWeChatMiniProgramPhoneNumberByCode({ appId, appSecret, code });
```

### WeCom (企业微信)

```ts
import { wecom } from '@coinfra/auth/wecom';

wecom({ corpId, corpSecret, agentId });
```

Handles the two-step `gettoken` → `getuserinfo` dance and, when the app has directory
permission, enriches the profile via `user/get` (best-effort, falls back to the userid).

### More OAuth connectors (支付宝 / QQ / 微博 / 抖音 / 钉钉 / 飞书)

Each returns a `genericOAuth` config — drop it into `oauthProviders` exactly like `wechat()`.
Every quirk (Alipay's RSA2 request signing, QQ's `openid` lookup, Douyin's `client_key`,
DingTalk's header-token profile call, Feishu's v2 JSON token) is folded into the connector.

```ts
import { alipay } from '@coinfra/auth/alipay';
import { qq } from '@coinfra/auth/qq';
import { weibo } from '@coinfra/auth/weibo';
import { douyin } from '@coinfra/auth/douyin';
import { dingtalk } from '@coinfra/auth/dingtalk';
import { feishu } from '@coinfra/auth/feishu';

oauthProviders: [
  alipay({ appId, appPrivateKey }),        // RSA2-signed; appPrivateKey is a PKCS#8 PEM
  qq({ appId, appKey }),                    // prefers unionid when enabled
  weibo({ appKey, appSecret }),
  douyin({ clientKey, clientSecret }),
  dingtalk({ clientId, clientSecret }),
  feishu({ appId, appSecret }),             // domain: 'lark' for international Lark
];
```

### SMS OTP (国内短信)

`smsOTP()` is Better Auth's `phoneNumber` plugin with the "send this code" step delegated to
a pluggable `SmsProvider`. The first provider is `aliyunSms()` — the fiddly Aliyun RPC
request signing, implemented once with cross-platform Web Crypto. Verifying a new number
signs the user up on the spot (synthetic `<digits>@phone.local` email; override with
`signUpOnVerification` / `tempEmailDomain`).

```ts
import { smsOTP, aliyunSms, tencentSms, twilioSms, createRecordingSmsProvider } from '@coinfra/auth/sms';

smsOTP({ provider: aliyunSms({ accessKeyId, accessKeySecret, signName, templateCode }) });
smsOTP({ provider: tencentSms({ secretId, secretKey, smsSdkAppId, signName, templateId }) });
smsOTP({ provider: twilioSms({ accountSid, authToken, from }) }); // 出海 default
smsOTP({ provider: createRecordingSmsProvider().provider }); // dev/tests: records, never sends
```

`aliyunSms` (阿里云) and `tencentSms` (腾讯云, TC3-HMAC-SHA256) cover the domestic gateways;
`twilioSms` is the overseas default. Implement the one-method `SmsProvider` interface to add
any other gateway.

### Client

```ts
import { createAuthClient } from 'better-auth/react';
import { wechatMiniProgramClient, smsOTPClient } from '@coinfra/auth/client';

export const authClient = createAuthClient({
  plugins: [wechatMiniProgramClient(), smsOTPClient()],
});

await authClient.signInWeChatMiniProgram({ code });   // from wx.login()
await authClient.phoneNumber.sendOtp({ phoneNumber }); // Better Auth's phone client
```

## A note on testing & credentials

The connectors are unit-tested through an injected `fetch` that scripts the exact provider
responses, and the signing/crypto (Aliyun RPC, Tencent TC3, Alipay RSA2, WeChat AES) is
covered by determinism and round-trip tests. Those tests verify coinfra's wiring, parsing,
and request signing — **not** the providers' live behaviour, which needs real credentials.
Verify the authorize redirects and signatures against the live services in your own
environment.

## License

MIT © corelli
