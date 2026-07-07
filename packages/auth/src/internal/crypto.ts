/**
 * The cryptographic primitives the domestic connectors need, implemented once
 * on the Web Crypto API (`globalThis.crypto.subtle`) so every wheel that signs a
 * request or decrypts a payload stays cross-platform — Node, Bun, Deno,
 * Cloudflare Workers — with no native dependency.
 *
 * These are deliberately low-level and side-effect free; each connector composes
 * them into its provider-specific signing scheme (Tencent TC3, Alipay RSA2,
 * WeChat Mini Program AES).
 */

/** A `Uint8Array` explicitly backed by a (non-shared) `ArrayBuffer`, i.e. a
 * valid Web Crypto `BufferSource`. */
type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();

/** UTF-8 encode a string to bytes. */
export function utf8(text: string): Bytes {
  return encoder.encode(text) as Bytes;
}

function toBytes(input: string | Bytes): Bytes {
  return typeof input === 'string' ? utf8(input) : input;
}

/** Base64-encode raw bytes (standard alphabet, with padding). */
export function toBase64(bytes: Bytes): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Decode a standard base64 string to raw bytes. */
export function fromBase64(value: string): Bytes {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Lowercase hex-encode raw bytes. */
export function toHex(bytes: Bytes): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** SHA-256 digest of a string or bytes. */
export async function sha256(input: string | Bytes): Promise<Bytes> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', toBytes(input));
  return new Uint8Array(digest);
}

/** Lowercase hex SHA-256 digest — the form most Chinese-cloud signing schemes use. */
export async function sha256Hex(input: string | Bytes): Promise<string> {
  return toHex(await sha256(input));
}

/**
 * HMAC-SHA256 returning raw bytes, so derived-key schemes (AWS SigV4, Tencent
 * TC3) can chain one HMAC's output straight into the next as the key. A string
 * key is UTF-8 encoded.
 */
export async function hmacSha256(key: string | Bytes, message: string | Bytes): Promise<Bytes> {
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    toBytes(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await globalThis.crypto.subtle.sign('HMAC', cryptoKey, toBytes(message));
  return new Uint8Array(signature);
}

/** AES-128/256-CBC decrypt with PKCS#7 padding (Web Crypto strips the padding). */
export async function aesCbcDecrypt(key: Bytes, iv: Bytes, ciphertext: Bytes): Promise<Bytes> {
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-CBC' },
    false,
    ['decrypt'],
  );
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-CBC', iv },
    cryptoKey,
    ciphertext,
  );
  return new Uint8Array(plaintext);
}

/** AES-128/256-CBC encrypt with PKCS#7 padding. Used by tests to produce
 * fixtures for {@link aesCbcDecrypt}; kept here so the round-trip lives together. */
export async function aesCbcEncrypt(key: Bytes, iv: Bytes, plaintext: Bytes): Promise<Bytes> {
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-CBC' },
    false,
    ['encrypt'],
  );
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-CBC', iv },
    cryptoKey,
    plaintext,
  );
  return new Uint8Array(ciphertext);
}

/** Strip the PEM armour and decode the base64 body to DER bytes. */
function pemToDer(pem: string): Bytes {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  return fromBase64(body);
}

/**
 * RSA sign (`RSASSA-PKCS1-v1_5` + SHA-256, i.e. Alipay's "RSA2") returning a
 * base64 signature. `privateKeyPem` must be an unencrypted **PKCS#8** key
 * (`-----BEGIN PRIVATE KEY-----`); convert a PKCS#1 key (`BEGIN RSA PRIVATE
 * KEY`) with `openssl pkcs8 -topk8 -nocrypt` first — Web Crypto only imports
 * PKCS#8.
 */
export async function rsaSha256SignBase64(privateKeyPem: string, message: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    'pkcs8',
    pemToDer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await globalThis.crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8(message));
  return toBase64(new Uint8Array(signature));
}
