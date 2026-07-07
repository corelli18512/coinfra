import { describe, expect, it } from 'vitest';
import { signTencentRequest, tencentSms, twilioSms } from '../sms';
import { mockFetch } from './helpers';

const TENCENT = {
  secretId: 'AKIDsecretid',
  secretKey: 'secretkey',
  smsSdkAppId: '1400000000',
  signName: 'coinfra',
  templateId: '1234567',
};

describe('signTencentRequest (TC3-HMAC-SHA256)', () => {
  const base = {
    secretId: TENCENT.secretId,
    secretKey: TENCENT.secretKey,
    host: 'sms.tencentcloudapi.com',
    payload: '{"PhoneNumberSet":["+8613800138000"]}',
    timestamp: 1700000000,
  };

  it('produces the canonical credential scope and a 64-hex signature', async () => {
    const auth = await signTencentRequest(base);
    expect(
      auth.startsWith('TC3-HMAC-SHA256 Credential=AKIDsecretid/2023-11-14/sms/tc3_request'),
    ).toBe(true);
    expect(auth).toContain('SignedHeaders=content-type;host;x-tc-action');
    expect(auth).toMatch(/Signature=[0-9a-f]{64}$/);
  });

  it('is deterministic for the same inputs', async () => {
    expect(await signTencentRequest(base)).toBe(await signTencentRequest(base));
  });
});

describe('tencentSms', () => {
  it('sends a signed SendSms request', async () => {
    const { fetch, requests } = mockFetch([
      {
        match: 'tencentcloudapi.com',
        json: {
          Response: { SendStatusSet: [{ Code: 'Ok', Message: 'send success' }], RequestId: 'r' },
        },
      },
    ]);
    const provider = tencentSms({ ...TENCENT, fetch, now: () => 1700000000000 });
    await provider.send({ phoneNumber: '+8613800138000', code: '123456' });

    expect(requests[0].method).toBe('POST');
    expect(requests[0].headers['x-tc-action']).toBe('SendSms');
    expect(requests[0].headers.authorization).toContain('TC3-HMAC-SHA256');
    expect(requests[0].body).toContain('"PhoneNumberSet":["+8613800138000"]');
    expect(requests[0].body).toContain('"TemplateParamSet":["123456"]');
  });

  it('throws on a top-level Error', async () => {
    const { fetch } = mockFetch([
      {
        match: 'tencentcloudapi.com',
        json: { Response: { Error: { Code: 'FailedOperation.X', Message: 'nope' } } },
      },
    ]);
    const provider = tencentSms({ ...TENCENT, fetch });
    await expect(provider.send({ phoneNumber: '+8613800138000', code: '1' })).rejects.toThrow(
      /FailedOperation/,
    );
  });

  it('throws when the per-number status is not Ok', async () => {
    const { fetch } = mockFetch([
      {
        match: 'tencentcloudapi.com',
        json: { Response: { SendStatusSet: [{ Code: 'LimitExceeded', Message: 'too many' }] } },
      },
    ]);
    const provider = tencentSms({ ...TENCENT, fetch });
    await expect(provider.send({ phoneNumber: '+8613800138000', code: '1' })).rejects.toThrow(
      /LimitExceeded/,
    );
  });
});

describe('twilioSms', () => {
  const CFG = { accountSid: 'ACxxxx', authToken: 'tok', from: '+15551234567' };

  it('sends via basic auth with a rendered body', async () => {
    const { fetch, requests } = mockFetch([
      { match: 'api.twilio.com', json: { sid: 'SM1', status: 'queued' } },
    ]);
    const provider = twilioSms({ ...CFG, fetch });
    await provider.send({ phoneNumber: '+8613800138000', code: '246810' });

    expect(requests[0].url).toContain('/Accounts/ACxxxx/Messages.json');
    expect(requests[0].headers.authorization).toBe(`Basic ${btoa('ACxxxx:tok')}`);
    expect(requests[0].body).toContain('From=%2B15551234567');
    expect(requests[0].body).toContain('Body=Your+verification+code+is+246810');
  });

  it('throws on a Twilio error payload', async () => {
    const { fetch } = mockFetch([
      { match: 'api.twilio.com', status: 400, json: { code: 21211, message: 'Invalid To' } },
    ]);
    const provider = twilioSms({ ...CFG, fetch });
    await expect(provider.send({ phoneNumber: 'bad', code: '1' })).rejects.toThrow(/21211/);
  });

  it('requires a sender', () => {
    expect(() => twilioSms({ accountSid: 'AC', authToken: 't' })).toThrow(
      /from.*messagingServiceSid/,
    );
  });
});
