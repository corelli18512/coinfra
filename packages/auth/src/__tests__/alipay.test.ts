import { describe, expect, it } from 'vitest';
import {
  alipay,
  alipayAuthorizeUrl,
  exchangeAlipayCode,
  getAlipayUserInfo,
  signAlipayRequest,
} from '../alipay';
import { fromBase64, toBase64, utf8 } from '../internal/crypto';
import type { FetchLike } from '../internal/http';

/** Generate an ephemeral PKCS#8 RSA private key (PEM) plus its public key. */
async function makeKeypair(): Promise<{ pem: string; publicKey: CryptoKey }> {
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
  const pkcs8 = new Uint8Array(await globalThis.crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${toBase64(pkcs8).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----`;
  return { pem, publicKey: pair.publicKey };
}

/** A fetch that routes Alipay gateway calls by the `method` param in the body. */
function gatewayFetch(byMethod: Record<string, unknown>): FetchLike {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body ?? ''));
    const method = body.get('method') ?? '';
    const json = byMethod[method] ?? {};
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as FetchLike;
}

describe('signAlipayRequest', () => {
  it('signs the sorted params and verifies with the public key', async () => {
    const { pem, publicKey } = await makeKeypair();
    const params = {
      app_id: '2021000000000000',
      method: 'alipay.system.oauth.token',
      charset: 'utf-8',
      sign: 'SHOULD_BE_IGNORED',
      empty: '',
      code: 'AUTHCODE',
    };
    const sig1 = await signAlipayRequest(params, pem);
    const sig2 = await signAlipayRequest(params, pem);
    expect(sig1).toBe(sig2);

    const expectedSignString =
      'app_id=2021000000000000&charset=utf-8&code=AUTHCODE&method=alipay.system.oauth.token';
    const valid = await globalThis.crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      fromBase64(sig1),
      utf8(expectedSignString),
    );
    expect(valid).toBe(true);
  });
});

describe('exchangeAlipayCode', () => {
  it('signs, POSTs, and extracts access_token + user_id', async () => {
    const { pem } = await makeKeypair();
    let capturedBody = '';
    const fetch = (async (_url: unknown, init?: RequestInit) => {
      capturedBody = String(init?.body ?? '');
      return new Response(
        JSON.stringify({
          alipay_system_oauth_token_response: {
            access_token: 'AT',
            user_id: '2088100000000000',
            expires_in: 3600,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as FetchLike;

    const tokens = await exchangeAlipayCode({
      appId: 'APPID',
      appPrivateKey: pem,
      code: 'AUTHCODE',
      now: () => 0,
      fetch,
    });
    expect(tokens.accessToken).toBe('AT');
    expect(tokens.raw).toMatchObject({ user_id: '2088100000000000' });
    expect(capturedBody).toContain('method=alipay.system.oauth.token');
    expect(capturedBody).toContain('sign=');
  });

  it('throws on an error_response', async () => {
    const { pem } = await makeKeypair();
    const fetch = (async () =>
      new Response(JSON.stringify({ error_response: { code: '20000', sub_msg: 'system busy' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as FetchLike;
    await expect(
      exchangeAlipayCode({ appId: 'A', appPrivateKey: pem, code: 'X', fetch }),
    ).rejects.toThrow(/system busy/);
  });
});

describe('getAlipayUserInfo', () => {
  it('reads the shared profile when permitted', async () => {
    const { pem } = await makeKeypair();
    const fetch = gatewayFetch({
      'alipay.user.info.share': {
        alipay_user_info_share_response: {
          code: '10000',
          user_id: '2088100000000000',
          nick_name: '支付宝用户',
          avatar: 'https://a/av.png',
        },
      },
    });
    const info = await getAlipayUserInfo(
      { accessToken: 'AT', raw: { user_id: '2088100000000000' } },
      { appId: 'APPID', appPrivateKey: pem, fetch },
    );
    expect(info).toEqual({
      id: '2088100000000000',
      name: '支付宝用户',
      image: 'https://a/av.png',
      emailVerified: false,
    });
  });

  it('falls back to a user_id-only identity when the profile call fails', async () => {
    const { pem } = await makeKeypair();
    const fetch = gatewayFetch({
      'alipay.user.info.share': { error_response: { code: '40006', sub_msg: 'no permission' } },
    });
    const info = await getAlipayUserInfo(
      { accessToken: 'AT', raw: { user_id: '2088100000000000' } },
      { appId: 'APPID', appPrivateKey: pem, fetch },
    );
    expect(info).toEqual({ id: '2088100000000000', emailVerified: false });
  });

  it('skips the profile call entirely when fetchProfile is false', async () => {
    let called = false;
    const fetch = (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as FetchLike;
    const info = await getAlipayUserInfo(
      { accessToken: 'AT', raw: { user_id: '2088100000000000' } },
      { appId: 'APPID', appPrivateKey: 'unused', fetchProfile: false, fetch },
    );
    expect(info).toEqual({ id: '2088100000000000', emailVerified: false });
    expect(called).toBe(false);
  });
});

describe('alipay() genericOAuth config', () => {
  it('keys the authorize request by app_id and wires the exchange', async () => {
    const { pem } = await makeKeypair();
    const fetch = gatewayFetch({
      'alipay.system.oauth.token': {
        alipay_system_oauth_token_response: { access_token: 'AT', user_id: '2088100000000000' },
      },
      'alipay.user.info.share': {
        alipay_user_info_share_response: {
          code: '10000',
          user_id: '2088100000000000',
          nick_name: '支付宝用户',
        },
      },
    });
    const config = alipay({ appId: 'APPID', appPrivateKey: pem, fetch });
    expect(config.providerId).toBe('alipay');
    expect(config.clientId).toBe('APPID');
    expect(config.clientSecret).toBeUndefined();
    expect(config.authorizationUrlParams).toEqual({ app_id: 'APPID' });

    const tokens = await config.getToken?.({ code: 'AUTHCODE', redirectURI: 'https://app/cb' });
    if (!tokens) throw new Error('expected tokens');
    expect(await config.getUserInfo?.(tokens)).toMatchObject({
      id: '2088100000000000',
      name: '支付宝用户',
    });
  });
});

describe('alipayAuthorizeUrl', () => {
  it('builds the authorize URL with app_id and scope', () => {
    const url = alipayAuthorizeUrl(
      { appId: 'APPID' },
      { redirectURI: 'https://app/cb', state: 's' },
    );
    expect(url.startsWith('https://openauth.alipay.com/oauth2/publicAppAuthorize.htm?')).toBe(true);
    expect(url).toContain('app_id=APPID');
    expect(url).toContain('scope=auth_user');
  });
});
