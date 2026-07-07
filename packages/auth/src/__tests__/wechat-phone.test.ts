import { describe, expect, it } from 'vitest';
import { aesCbcEncrypt, fromBase64, toBase64, utf8 } from '../internal/crypto';
import {
  decryptWeChatData,
  getWeChatMiniProgramPhoneNumber,
  getWeChatMiniProgramPhoneNumberByCode,
} from '../wechat';
import { mockFetch } from './helpers';

const SESSION_KEY = toBase64(new Uint8Array(16).fill(1));
const IV = toBase64(new Uint8Array(16).fill(2));
const APP_ID = 'wxAPPID';

async function encryptPayload(payload: unknown): Promise<string> {
  const ciphertext = await aesCbcEncrypt(
    fromBase64(SESSION_KEY),
    fromBase64(IV),
    utf8(JSON.stringify(payload)),
  );
  return toBase64(ciphertext);
}

describe('decryptWeChatData', () => {
  it('decrypts an AES-128-CBC payload back to JSON', async () => {
    const payload = { phoneNumber: '13800138000', watermark: { appid: APP_ID } };
    const encryptedData = await encryptPayload(payload);
    const decoded = await decryptWeChatData({ sessionKey: SESSION_KEY, encryptedData, iv: IV });
    expect(decoded).toEqual(payload);
  });

  it('throws on a wrong session key', async () => {
    const encryptedData = await encryptPayload({ phoneNumber: '13800138000' });
    const wrongKey = toBase64(new Uint8Array(16).fill(9));
    await expect(
      decryptWeChatData({ sessionKey: wrongKey, encryptedData, iv: IV }),
    ).rejects.toThrow(/invalid or expired sessionKey/);
  });
});

describe('getWeChatMiniProgramPhoneNumber', () => {
  const phone = {
    phoneNumber: '13800138000',
    purePhoneNumber: '13800138000',
    countryCode: '86',
    watermark: { appid: APP_ID, timestamp: 1700000000 },
  };

  it('returns the phone number when the watermark matches', async () => {
    const encryptedData = await encryptPayload(phone);
    const result = await getWeChatMiniProgramPhoneNumber({
      sessionKey: SESSION_KEY,
      encryptedData,
      iv: IV,
      appId: APP_ID,
    });
    expect(result.phoneNumber).toBe('13800138000');
    expect(result.countryCode).toBe('86');
  });

  it('rejects a watermark appid mismatch', async () => {
    const encryptedData = await encryptPayload(phone);
    await expect(
      getWeChatMiniProgramPhoneNumber({
        sessionKey: SESSION_KEY,
        encryptedData,
        iv: IV,
        appId: 'wxDIFFERENT',
      }),
    ).rejects.toThrow(/watermark appid mismatch/);
  });
});

describe('getWeChatMiniProgramPhoneNumberByCode', () => {
  const phoneInfo = {
    errcode: 0,
    phone_info: { phoneNumber: '13800138000', purePhoneNumber: '13800138000', countryCode: '86' },
  };

  it('fetches an access token then exchanges the phone code', async () => {
    const { fetch, calls } = mockFetch([
      { match: '/cgi-bin/token', json: { access_token: 'AT', expires_in: 7200 } },
      { match: '/wxa/business/getuserphonenumber', json: phoneInfo },
    ]);
    const result = await getWeChatMiniProgramPhoneNumberByCode({
      appId: APP_ID,
      appSecret: 'SECRET',
      code: 'PHONE_CODE',
      fetch,
    });
    expect(result.phoneNumber).toBe('13800138000');
    expect(calls[0]).toContain('/cgi-bin/token');
    expect(calls[1]).toContain('access_token=AT');
  });

  it('skips the token fetch when an accessToken is supplied', async () => {
    const { fetch, calls } = mockFetch([
      { match: '/wxa/business/getuserphonenumber', json: phoneInfo },
    ]);
    const result = await getWeChatMiniProgramPhoneNumberByCode({
      accessToken: 'CACHED',
      code: 'PHONE_CODE',
      fetch,
    });
    expect(result.phoneNumber).toBe('13800138000');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('access_token=CACHED');
  });

  it('throws on a WeChat error code', async () => {
    const { fetch } = mockFetch([
      {
        match: '/wxa/business/getuserphonenumber',
        json: { errcode: 40029, errmsg: 'invalid code' },
      },
    ]);
    await expect(
      getWeChatMiniProgramPhoneNumberByCode({ accessToken: 'AT', code: 'X', fetch }),
    ).rejects.toThrow(/40029/);
  });
});
