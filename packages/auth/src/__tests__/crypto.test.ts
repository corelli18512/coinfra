import { describe, expect, it } from 'vitest';
import {
  aesCbcDecrypt,
  aesCbcEncrypt,
  fromBase64,
  hmacSha256,
  rsaSha256SignBase64,
  sha256Hex,
  toBase64,
  toHex,
  utf8,
} from '../internal/crypto';

describe('encoding helpers', () => {
  it('round-trips base64', () => {
    const bytes = utf8('coinfra 出海');
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  it('hex-encodes bytes', () => {
    expect(toHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe('00010f10ff');
  });
});

describe('sha256Hex', () => {
  it('matches known vectors', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('hmacSha256', () => {
  it('matches the RFC test vector', async () => {
    const mac = await hmacSha256('key', 'The quick brown fox jumps over the lazy dog');
    expect(toHex(mac)).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  });

  it('accepts a byte key so signing keys can be chained', async () => {
    const first = await hmacSha256('secret', 'date');
    const chained = await hmacSha256(first, 'service');
    expect(chained).toHaveLength(32);
  });
});

describe('aesCbc round-trip', () => {
  it('decrypts what it encrypts (PKCS#7)', async () => {
    const key = fromBase64(toBase64(new Uint8Array(16).fill(7)));
    const iv = new Uint8Array(16).fill(3);
    const plaintext = utf8(JSON.stringify({ phoneNumber: '13800138000' }));
    const ciphertext = await aesCbcEncrypt(key, iv, plaintext);
    const decrypted = await aesCbcDecrypt(key, iv, ciphertext);
    expect(new TextDecoder().decode(decrypted)).toBe('{"phoneNumber":"13800138000"}');
  });
});

describe('rsaSha256SignBase64', () => {
  it('produces a deterministic, verifiable RSA2 signature', async () => {
    const pair = await globalThis.crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );
    const pkcs8 = new Uint8Array(
      await globalThis.crypto.subtle.exportKey('pkcs8', pair.privateKey),
    );
    const pem = `-----BEGIN PRIVATE KEY-----\n${toBase64(pkcs8).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----`;

    const message = 'app_id=2021000000000000&method=alipay.system.oauth.token';
    const sig1 = await rsaSha256SignBase64(pem, message);
    const sig2 = await rsaSha256SignBase64(pem, message);
    expect(sig1).toBe(sig2); // RSASSA-PKCS1-v1_5 is deterministic

    const valid = await globalThis.crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      pair.publicKey,
      fromBase64(sig1),
      utf8(message),
    );
    expect(valid).toBe(true);
  });
});
