import { describe, expect, it } from 'vitest';
import { createCoinfraAuth } from '../factory';
import { aliyunSms, createRecordingSmsProvider, signAliyunRequest, smsOTP } from '../sms';
import { mockFetch, testConfig } from './helpers';

describe('smsOTP', () => {
  it('returns a real phone-number plugin', () => {
    const { provider } = createRecordingSmsProvider();
    expect(smsOTP({ provider }).id).toBe('phone-number');
  });

  it('drives the real send → verify flow, delivering the code via the provider', async () => {
    const { provider, sent } = createRecordingSmsProvider();
    const auth = createCoinfraAuth(testConfig({ plugins: [smsOTP({ provider })] }));
    const phone = '+8613800138000';

    await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: phone } });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.phoneNumber).toBe(phone);
    const code = sent[0]?.code ?? '';
    expect(code).toMatch(/^\d+$/);

    const verified = await auth.api.verifyPhoneNumber({ body: { phoneNumber: phone, code } });
    expect(verified).toBeTruthy();
  });

  it('rejects a wrong code', async () => {
    const { provider } = createRecordingSmsProvider();
    const auth = createCoinfraAuth(testConfig({ plugins: [smsOTP({ provider })] }));
    const phone = '+8613900139000';

    await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: phone } });
    await expect(
      auth.api.verifyPhoneNumber({ body: { phoneNumber: phone, code: '000000' } }),
    ).rejects.toThrow();
  });
});

describe('signAliyunRequest', () => {
  const params = {
    Action: 'SendSms',
    PhoneNumbers: '13800138000',
    SignName: 'coinfra',
    TemplateCode: 'SMS_1',
  };

  it('is deterministic for the same inputs', async () => {
    const a = await signAliyunRequest(params, 'secret');
    const b = await signAliyunRequest(params, 'secret');
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/); // base64
  });

  it('changes when a param or the secret changes', async () => {
    const base = await signAliyunRequest(params, 'secret');
    expect(await signAliyunRequest({ ...params, PhoneNumbers: '13900139000' }, 'secret')).not.toBe(
      base,
    );
    expect(await signAliyunRequest(params, 'other-secret')).not.toBe(base);
  });
});

describe('aliyunSms', () => {
  const config = {
    accessKeyId: 'AKID',
    accessKeySecret: 'SECRET',
    signName: '芯片',
    templateCode: 'SMS_1',
    now: () => 0,
    nonce: () => 'fixed-nonce',
  };

  it('signs and sends a SendSms request with the OTP code', async () => {
    const { fetch, calls } = mockFetch([
      { match: 'dysmsapi', json: { Code: 'OK', Message: 'OK' } },
    ]);
    const sms = aliyunSms({ ...config, fetch });

    await sms.send({ phoneNumber: '+8613800138000', code: '123456' });

    const url = calls[0] ?? '';
    expect(url).toContain('Action=SendSms');
    expect(url).toContain('AccessKeyId=AKID');
    expect(url).toContain('TemplateCode=SMS_1');
    expect(url).toContain('Signature=');
    expect(url).toContain('SignatureNonce=fixed-nonce');
    // TemplateParam carries the code under the default `code` variable.
    expect(decodeURIComponent(url)).toContain('"code":"123456"');
  });

  it('uses a custom template variable name', async () => {
    const { fetch, calls } = mockFetch([{ match: 'dysmsapi', json: { Code: 'OK' } }]);
    const sms = aliyunSms({ ...config, codeVariable: 'otp', fetch });
    await sms.send({ phoneNumber: '+86138', code: '9999' });
    expect(decodeURIComponent(calls[0] ?? '')).toContain('"otp":"9999"');
  });

  it('throws with the Aliyun error code on a non-OK response', async () => {
    const { fetch } = mockFetch([
      { match: 'dysmsapi', json: { Code: 'isv.BUSINESS_LIMIT_CONTROL', Message: 'too many' } },
    ]);
    const sms = aliyunSms({ ...config, fetch });
    await expect(sms.send({ phoneNumber: '+86138', code: '1' })).rejects.toThrow(
      /isv.BUSINESS_LIMIT_CONTROL/,
    );
  });
});

describe('createRecordingSmsProvider', () => {
  it('records messages instead of sending them', async () => {
    const { provider, sent } = createRecordingSmsProvider();
    await provider.send({ phoneNumber: '+86138', code: '111' });
    await provider.send({ phoneNumber: '+86139', code: '222' });
    expect(sent).toEqual([
      { phoneNumber: '+86138', code: '111' },
      { phoneNumber: '+86139', code: '222' },
    ]);
  });
});
