/**
 * Phone-number OTP sign-in for coinfra.
 *
 * Better Auth ships the sign-in flow (its `phoneNumber` plugin); what it leaves
 * to you is the actual "send this code to this number" step. {@link smsOTP}
 * wraps the plugin and delegates sending to a pluggable {@link SmsProvider}, and
 * {@link aliyunSms} is the first provider — the notoriously fiddly Aliyun RPC
 * request signing, implemented once with cross-platform Web Crypto so no app has
 * to get it right again.
 */
import { phoneNumber } from 'better-auth/plugins/phone-number';
import type { FetchLike } from './internal/http.js';
import type { BetterAuthPlugin } from './types.js';

type PhoneNumberOptions = NonNullable<Parameters<typeof phoneNumber>[0]>;

/** A single OTP to deliver. */
export interface SmsMessage {
  phoneNumber: string;
  code: string;
}

/**
 * Something that can deliver an OTP over SMS. Implement this to support a new
 * carrier/gateway; throwing aborts the sign-in with an error.
 */
export interface SmsProvider {
  send(message: SmsMessage): Promise<void>;
}

/** Options for {@link smsOTP}: everything the phone-number plugin takes, minus
 * `sendOTP` (which the {@link SmsProvider} supplies). */
export type SmsOtpOptions = Omit<PhoneNumberOptions, 'sendOTP'> & {
  /** The SMS gateway used to deliver codes (e.g. {@link aliyunSms}). */
  provider: SmsProvider;
  /**
   * Domain for the synthetic email assigned to phone-only accounts the first
   * time a number is verified (Better Auth requires every user to have an
   * email). Only used when you don't pass your own `signUpOnVerification`.
   * @default "phone.local"
   */
  tempEmailDomain?: string;
};

/**
 * Phone-number OTP plugin backed by an {@link SmsProvider}. Returns a real
 * Better Auth plugin — drop it straight into `plugins`
 * (`createCoinfraAuth({ plugins: [smsOTP({ provider })] })`).
 *
 * By default, verifying a brand-new number signs the user up on the spot,
 * synthesising a placeholder email (`<digits>@phone.local`). Override
 * `signUpOnVerification` for full control, or `tempEmailDomain` to just change
 * the domain.
 */
export function smsOTP(options: SmsOtpOptions): BetterAuthPlugin {
  const { provider, tempEmailDomain, signUpOnVerification, ...rest } = options;
  const domain = tempEmailDomain ?? 'phone.local';
  return phoneNumber({
    ...rest,
    signUpOnVerification: signUpOnVerification ?? {
      getTempEmail: (phone) => `${phone.replace(/\D/g, '')}@${domain}`,
    },
    sendOTP: ({ phoneNumber: to, code }) => provider.send({ phoneNumber: to, code }),
  }) as unknown as BetterAuthPlugin;
}

/**
 * An in-memory {@link SmsProvider} that records every message instead of
 * sending it. For local development and for tests (your app's and ours).
 */
export function createRecordingSmsProvider(): { provider: SmsProvider; sent: SmsMessage[] } {
  const sent: SmsMessage[] = [];
  return {
    sent,
    provider: {
      send: async (message) => {
        sent.push(message);
      },
    },
  };
}

// --- Aliyun (阿里云) SMS ------------------------------------------------------

/** Configuration for {@link aliyunSms}. */
export interface AliyunSmsConfig {
  /** AccessKey ID. */
  accessKeyId: string;
  /** AccessKey secret. */
  accessKeySecret: string;
  /** Approved SMS signature (短信签名). */
  signName: string;
  /** Approved template code (模板CODE). */
  templateCode: string;
  /**
   * The template variable that receives the OTP. For a template like
   * `您的验证码为${code}` this is `code`. @default "code"
   */
  codeVariable?: string;
  /** RPC region. @default "cn-hangzhou" */
  regionId?: string;
  /** Service endpoint. @default "https://dysmsapi.aliyuncs.com/" */
  endpoint?: string;
  /** Injected `fetch`, for tests. @default globalThis.fetch */
  fetch?: FetchLike;
  /** Clock, for deterministic tests. @default Date.now */
  now?: () => number;
  /** Nonce source, for deterministic tests. @default crypto.randomUUID */
  nonce?: () => string;
}

interface AliyunSmsResponse {
  Code?: string;
  Message?: string;
  RequestId?: string;
  BizId?: string;
}

/** Aliyun's POP percent-encoding (RFC 3986, with `~` left intact). */
function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~');
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function hmacSha1Base64(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const signature = await globalThis.crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return toBase64(new Uint8Array(signature));
}

/**
 * Compute the Aliyun RPC `Signature` for a set of request params. Exported for
 * testing; most callers only need {@link aliyunSms}.
 */
export async function signAliyunRequest(
  params: Record<string, string>,
  accessKeySecret: string,
): Promise<string> {
  const canonical = Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key] ?? '')}`)
    .join('&');
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonical)}`;
  return hmacSha1Base64(`${accessKeySecret}&`, stringToSign);
}

/**
 * Aliyun SMS provider. Signs and sends a `SendSms` RPC request. Verify the
 * signature/credentials against the live service in your environment — the unit
 * tests cover request shape and determinism, not Aliyun's server behaviour.
 */
export function aliyunSms(config: AliyunSmsConfig): SmsProvider {
  const endpoint = config.endpoint ?? 'https://dysmsapi.aliyuncs.com/';
  const regionId = config.regionId ?? 'cn-hangzhou';
  const codeVariable = config.codeVariable ?? 'code';
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const now = config.now ?? Date.now;
  const nonce = config.nonce ?? (() => globalThis.crypto.randomUUID());

  return {
    send: async ({ phoneNumber: to, code }) => {
      const params: Record<string, string> = {
        AccessKeyId: config.accessKeyId,
        Action: 'SendSms',
        Format: 'JSON',
        RegionId: regionId,
        SignatureMethod: 'HMAC-SHA1',
        SignatureNonce: nonce(),
        SignatureVersion: '1.0',
        Timestamp: new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        Version: '2017-05-25',
        PhoneNumbers: to,
        SignName: config.signName,
        TemplateCode: config.templateCode,
        TemplateParam: JSON.stringify({ [codeVariable]: code }),
      };
      params.Signature = await signAliyunRequest(params, config.accessKeySecret);

      // The wire encoding must match what was signed, so build the query with
      // the same percent-encoding rather than URLSearchParams (which uses `+`).
      const query = Object.keys(params)
        .map((key) => `${percentEncode(key)}=${percentEncode(params[key] ?? '')}`)
        .join('&');

      const response = await fetchImpl(`${endpoint}?${query}`, { method: 'GET' });
      if (!response.ok) {
        throw new Error(`Aliyun SMS request failed with HTTP ${response.status}`);
      }
      const data = (await response.json()) as AliyunSmsResponse;
      if (data.Code !== 'OK') {
        throw new Error(
          `Aliyun SMS send failed (${data.Code ?? 'unknown'}): ${data.Message ?? ''}`.trim(),
        );
      }
    },
  };
}
