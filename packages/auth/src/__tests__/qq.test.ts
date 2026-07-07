import { describe, expect, it } from 'vitest';
import { exchangeQQCode, getQQUserInfo, qq, qqAuthorizeUrl } from '../qq';
import { mockFetch } from './helpers';

const APP = { appId: 'APPID', appKey: 'APPKEY' };

describe('exchangeQQCode', () => {
  it('exchanges the code, then resolves openid/unionid', async () => {
    const { fetch, calls } = mockFetch([
      { match: '/oauth2.0/token', json: { access_token: 'AT', refresh_token: 'RT' } },
      { match: '/oauth2.0/me', json: { client_id: 'APPID', openid: 'OPEN_1', unionid: 'UNION_1' } },
    ]);

    const tokens = await exchangeQQCode({
      ...APP,
      code: 'CODE',
      redirectURI: 'https://app/cb',
      fetch,
    });

    expect(tokens.accessToken).toBe('AT');
    expect(tokens.raw).toMatchObject({ openid: 'OPEN_1', unionid: 'UNION_1' });
    expect(calls[0]).toContain('fmt=json');
    expect(calls[0]).toContain('client_id=APPID');
    expect(calls[1]).toContain('access_token=AT');
  });

  it('throws when the token endpoint returns an error', async () => {
    const { fetch } = mockFetch([
      { match: '/oauth2.0/token', json: { error: 100016, error_description: 'bad code' } },
    ]);
    await expect(
      exchangeQQCode({ ...APP, code: 'X', redirectURI: 'https://app/cb', fetch }),
    ).rejects.toThrow(/100016/);
  });
});

describe('getQQUserInfo', () => {
  const tokens = { accessToken: 'AT', raw: { openid: 'OPEN_1', unionid: 'UNION_1' } };

  it('prefers unionid and reads the profile', async () => {
    const { fetch, calls } = mockFetch([
      {
        match: '/user/get_user_info',
        json: { ret: 0, nickname: '小明', figureurl_qq_2: 'https://a/2.png' },
      },
    ]);
    const info = await getQQUserInfo(tokens, { appId: 'APPID', fetch });
    expect(info).toEqual({
      id: 'UNION_1',
      name: '小明',
      image: 'https://a/2.png',
      emailVerified: false,
    });
    expect(calls[0]).toContain('oauth_consumer_key=APPID');
    expect(calls[0]).toContain('openid=OPEN_1');
  });

  it('falls back to an id-only identity when the profile call errors', async () => {
    const { fetch } = mockFetch([
      { match: '/user/get_user_info', json: { ret: 1002, msg: 'nope' } },
    ]);
    const info = await getQQUserInfo(tokens, { appId: 'APPID', fetch });
    expect(info).toEqual({ id: 'UNION_1', emailVerified: false });
  });
});

describe('qq() genericOAuth config', () => {
  it('wires the exchange through the hooks', async () => {
    const { fetch } = mockFetch([
      { match: '/oauth2.0/token', json: { access_token: 'AT' } },
      { match: '/oauth2.0/me', json: { openid: 'OPEN_1' } },
      { match: '/user/get_user_info', json: { ret: 0, nickname: '小明' } },
    ]);
    const config = qq({ ...APP, fetch });
    expect(config.providerId).toBe('qq');
    expect(config.clientId).toBe('APPID');

    const tokens = await config.getToken?.({ code: 'CODE', redirectURI: 'https://app/cb' });
    if (!tokens) throw new Error('expected tokens');
    const info = await config.getUserInfo?.(tokens);
    expect(info).toMatchObject({ id: 'OPEN_1', name: '小明' });
  });
});

describe('qqAuthorizeUrl', () => {
  it('builds the authorize URL', () => {
    const url = qqAuthorizeUrl({ appId: 'APPID' }, { redirectURI: 'https://app/cb', state: 's' });
    expect(url.startsWith('https://graph.qq.com/oauth2.0/authorize?')).toBe(true);
    expect(url).toContain('client_id=APPID');
    expect(url).toContain('scope=get_user_info');
  });
});
