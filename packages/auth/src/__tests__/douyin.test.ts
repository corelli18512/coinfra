import { describe, expect, it } from 'vitest';
import { douyin, douyinAuthorizeUrl, exchangeDouyinCode, getDouyinUserInfo } from '../douyin';
import { mockFetch } from './helpers';

const APP = { clientKey: 'CLIENT_KEY', clientSecret: 'CLIENT_SECRET' };

describe('exchangeDouyinCode', () => {
  it('unwraps the data envelope and returns open_id', async () => {
    const { fetch, requests } = mockFetch([
      {
        match: '/oauth/access_token/',
        json: {
          data: { access_token: 'AT', open_id: 'OPEN_1', expires_in: 1000 },
          message: 'success',
        },
      },
    ]);

    const tokens = await exchangeDouyinCode({ ...APP, code: 'CODE', fetch });

    expect(tokens.accessToken).toBe('AT');
    expect(tokens.raw).toMatchObject({ open_id: 'OPEN_1' });
    expect(requests[0].body).toContain('client_key=CLIENT_KEY');
  });

  it('throws when the envelope carries an error_code', async () => {
    const { fetch } = mockFetch([
      {
        match: '/oauth/access_token/',
        json: { data: { error_code: 2190008, description: 'bad code' } },
      },
    ]);
    await expect(exchangeDouyinCode({ ...APP, code: 'X', fetch })).rejects.toThrow(/2190008/);
  });
});

describe('getDouyinUserInfo', () => {
  const tokens = { accessToken: 'AT', raw: { open_id: 'OPEN_1' } };

  it('prefers union_id and reads the profile', async () => {
    const { fetch } = mockFetch([
      {
        match: '/oauth/userinfo/',
        json: {
          data: {
            open_id: 'OPEN_1',
            union_id: 'UNION_1',
            nickname: '抖音',
            avatar: 'https://a/av.png',
          },
        },
      },
    ]);
    const info = await getDouyinUserInfo(tokens, { fetch });
    expect(info).toEqual({
      id: 'UNION_1',
      name: '抖音',
      image: 'https://a/av.png',
      emailVerified: false,
    });
  });

  it('falls back to open_id when the profile call errors', async () => {
    const { fetch } = mockFetch([{ match: '/oauth/userinfo/', json: { data: { error_code: 1 } } }]);
    expect(await getDouyinUserInfo(tokens, { fetch })).toEqual({
      id: 'OPEN_1',
      emailVerified: false,
    });
  });
});

describe('douyin() genericOAuth config', () => {
  it('keys the authorize request by client_key', async () => {
    const { fetch } = mockFetch([
      { match: '/oauth/access_token/', json: { data: { access_token: 'AT', open_id: 'OPEN_1' } } },
      { match: '/oauth/userinfo/', json: { data: { open_id: 'OPEN_1', nickname: '抖音' } } },
    ]);
    const config = douyin({ ...APP, fetch });
    expect(config.providerId).toBe('douyin');
    expect(config.authorizationUrlParams).toEqual({ client_key: 'CLIENT_KEY' });
    const tokens = await config.getToken?.({ code: 'CODE', redirectURI: 'https://app/cb' });
    if (!tokens) throw new Error('expected tokens');
    expect(await config.getUserInfo?.(tokens)).toMatchObject({ id: 'OPEN_1', name: '抖音' });
  });
});

describe('douyinAuthorizeUrl', () => {
  it('builds the authorize URL with client_key', () => {
    const url = douyinAuthorizeUrl(
      { clientKey: 'CLIENT_KEY' },
      { redirectURI: 'https://app/cb', state: 's' },
    );
    expect(url).toContain('client_key=CLIENT_KEY');
    expect(url).toContain('scope=user_info');
  });
});
