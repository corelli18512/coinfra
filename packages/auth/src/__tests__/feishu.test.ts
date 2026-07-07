import { describe, expect, it } from 'vitest';
import { exchangeFeishuCode, feishu, feishuAuthorizeUrl, getFeishuUserInfo } from '../feishu';
import { mockFetch } from './helpers';

const APP = { appId: 'APP_ID', appSecret: 'APP_SECRET' };

describe('exchangeFeishuCode', () => {
  it('POSTs JSON to the v2 token endpoint', async () => {
    const { fetch, calls, requests } = mockFetch([
      {
        match: '/authen/v2/oauth/token',
        json: { code: 0, access_token: 'u-AT', refresh_token: 'RT' },
      },
    ]);

    const tokens = await exchangeFeishuCode({
      ...APP,
      code: 'CODE',
      redirectURI: 'https://app/cb',
      fetch,
    });

    expect(tokens.accessToken).toBe('u-AT');
    expect(calls[0]).toContain('open.feishu.cn');
    expect(requests[0].body).toContain('"code":"CODE"');
  });

  it('throws when the wrapped code is non-zero', async () => {
    const { fetch } = mockFetch([
      { match: '/authen/v2/oauth/token', json: { code: 20037, error: 'invalid_grant' } },
    ]);
    await expect(exchangeFeishuCode({ ...APP, code: 'X', fetch })).rejects.toThrow(/invalid_grant/);
  });

  it('targets the larksuite endpoints when domain is lark', async () => {
    const { fetch, calls } = mockFetch([
      { match: '/authen/v2/oauth/token', json: { code: 0, access_token: 'u-AT' } },
    ]);
    await exchangeFeishuCode({ ...APP, code: 'CODE', domain: 'lark', fetch });
    expect(calls[0]).toContain('open.larksuite.com');
  });
});

describe('getFeishuUserInfo', () => {
  it('reads the profile behind a bearer token and prefers union_id', async () => {
    const { fetch, requests } = mockFetch([
      {
        match: '/authen/v1/user_info',
        json: {
          code: 0,
          data: {
            name: '飞书',
            open_id: 'O1',
            union_id: 'U1',
            email: 'x@y.com',
            avatar_url: 'https://a/av',
          },
        },
      },
    ]);
    const info = await getFeishuUserInfo({ accessToken: 'u-AT', raw: {} }, { fetch });
    expect(info).toEqual({
      id: 'U1',
      name: '飞书',
      email: 'x@y.com',
      image: 'https://a/av',
      emailVerified: false,
    });
    expect(requests[0].headers.authorization).toBe('Bearer u-AT');
  });
});

describe('feishu() genericOAuth config', () => {
  it('wires the exchange and uses accounts.feishu.cn to authorize', async () => {
    const { fetch } = mockFetch([
      { match: '/authen/v2/oauth/token', json: { code: 0, access_token: 'u-AT' } },
      { match: '/authen/v1/user_info', json: { code: 0, data: { name: '飞书', union_id: 'U1' } } },
    ]);
    const config = feishu({ ...APP, fetch });
    expect(config.providerId).toBe('feishu');
    expect(config.authorizationUrl).toContain('accounts.feishu.cn');
    const tokens = await config.getToken?.({ code: 'CODE', redirectURI: 'https://app/cb' });
    if (!tokens) throw new Error('expected tokens');
    expect(await config.getUserInfo?.(tokens)).toMatchObject({ id: 'U1', name: '飞书' });
  });

  it('switches to larksuite domains for lark', () => {
    const config = feishu({ ...APP, domain: 'lark' });
    expect(config.authorizationUrl).toContain('accounts.larksuite.com');
  });
});

describe('feishuAuthorizeUrl', () => {
  it('builds the authorize URL', () => {
    const url = feishuAuthorizeUrl(
      { appId: 'APP_ID' },
      { redirectURI: 'https://app/cb', state: 's' },
    );
    expect(url.startsWith('https://accounts.feishu.cn/open-apis/authen/v1/authorize?')).toBe(true);
    expect(url).toContain('client_id=APP_ID');
  });
});
