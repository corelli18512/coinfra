import { describe, expect, it } from 'vitest';
import { exchangeWeiboCode, getWeiboUserInfo, weibo, weiboAuthorizeUrl } from '../weibo';
import { mockFetch } from './helpers';

const APP = { appKey: 'APPKEY', appSecret: 'APPSECRET' };

describe('exchangeWeiboCode', () => {
  it('POSTs the code as a form and returns the uid', async () => {
    const { fetch, requests } = mockFetch([
      { match: '/oauth2/access_token', json: { access_token: 'AT', uid: '123', expires_in: 1000 } },
    ]);

    const tokens = await exchangeWeiboCode({
      ...APP,
      code: 'CODE',
      redirectURI: 'https://app/cb',
      fetch,
    });

    expect(tokens.accessToken).toBe('AT');
    expect(tokens.raw).toMatchObject({ uid: '123' });
    expect(requests[0].method).toBe('POST');
    expect(requests[0].body).toContain('code=CODE');
    expect(requests[0].body).toContain('redirect_uri=https');
  });

  it('throws on an error response', async () => {
    const { fetch } = mockFetch([
      { match: '/oauth2/access_token', json: { error: 'invalid_grant', error_code: 21325 } },
    ]);
    await expect(
      exchangeWeiboCode({ ...APP, code: 'X', redirectURI: 'https://app/cb', fetch }),
    ).rejects.toThrow(/21325/);
  });
});

describe('getWeiboUserInfo', () => {
  const tokens = { accessToken: 'AT', raw: { uid: '123' } };

  it('reads the profile with the best avatar', async () => {
    const { fetch, calls } = mockFetch([
      {
        match: '/2/users/show.json',
        json: { id: 123, screen_name: '微博用户', avatar_hd: 'https://a/hd.png' },
      },
    ]);
    const info = await getWeiboUserInfo(tokens, { fetch });
    expect(info).toEqual({
      id: '123',
      name: '微博用户',
      image: 'https://a/hd.png',
      emailVerified: false,
    });
    expect(calls[0]).toContain('uid=123');
  });

  it('falls back to a uid-only identity on error', async () => {
    const { fetch } = mockFetch([
      { match: '/2/users/show.json', json: { error: 'x', error_code: 21332 } },
    ]);
    expect(await getWeiboUserInfo(tokens, { fetch })).toEqual({ id: '123', emailVerified: false });
  });
});

describe('weibo() genericOAuth config', () => {
  it('wires the exchange and exposes the id', async () => {
    const { fetch } = mockFetch([
      { match: '/oauth2/access_token', json: { access_token: 'AT', uid: '123' } },
      { match: '/2/users/show.json', json: { id: 123, screen_name: '微博用户' } },
    ]);
    const config = weibo({ ...APP, fetch });
    expect(config.providerId).toBe('weibo');
    const tokens = await config.getToken?.({ code: 'CODE', redirectURI: 'https://app/cb' });
    if (!tokens) throw new Error('expected tokens');
    expect(await config.getUserInfo?.(tokens)).toMatchObject({ id: '123', name: '微博用户' });
  });
});

describe('weiboAuthorizeUrl', () => {
  it('builds the authorize URL', () => {
    const url = weiboAuthorizeUrl(
      { appKey: 'APPKEY' },
      { redirectURI: 'https://app/cb', state: 's' },
    );
    expect(url).toContain('client_id=APPKEY');
    expect(url).toContain('response_type=code');
  });
});
