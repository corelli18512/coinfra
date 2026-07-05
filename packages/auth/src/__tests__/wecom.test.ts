import { describe, expect, it } from 'vitest';
import {
  exchangeWeComCode,
  getWeComAccessToken,
  getWeComUserInfo,
  wecom,
  wecomAuthorizeUrl,
} from '../wecom';
import { mockFetch } from './helpers';

const APP = { corpId: 'corp_id', corpSecret: 'corp_secret' };

describe('getWeComAccessToken', () => {
  it('fetches the app token from corpid/corpsecret', async () => {
    const { fetch, calls } = mockFetch([
      {
        match: '/cgi-bin/gettoken',
        json: { errcode: 0, access_token: 'APP_TOKEN', expires_in: 7200 },
      },
    ]);
    const token = await getWeComAccessToken({ ...APP, fetch });
    expect(token).toBe('APP_TOKEN');
    expect(calls[0]).toContain('corpid=corp_id');
    expect(calls[0]).toContain('corpsecret=corp_secret');
  });

  it('throws on a WeCom error code', async () => {
    const { fetch } = mockFetch([
      { match: '/cgi-bin/gettoken', json: { errcode: 40001, errmsg: 'invalid secret' } },
    ]);
    await expect(getWeComAccessToken({ ...APP, fetch })).rejects.toThrow(/40001/);
  });
});

describe('exchangeWeComCode', () => {
  it('gets the app token then resolves the code to a userid', async () => {
    const { fetch, calls } = mockFetch([
      { match: '/cgi-bin/gettoken', json: { errcode: 0, access_token: 'APP_TOKEN' } },
      {
        match: '/cgi-bin/auth/getuserinfo',
        json: { errcode: 0, userid: 'zhangsan', user_ticket: 'TICKET' },
      },
    ]);

    const tokens = await exchangeWeComCode({ ...APP, code: 'CODE', fetch });

    expect(tokens.accessToken).toBe('APP_TOKEN');
    expect(tokens.raw).toMatchObject({ userid: 'zhangsan', user_ticket: 'TICKET' });
    // getuserinfo must be called with the app token + code.
    const authCall = calls.find((u) => u.includes('/auth/getuserinfo'));
    expect(authCall).toContain('access_token=APP_TOKEN');
    expect(authCall).toContain('code=CODE');
  });

  it('throws when the code resolves to no identity', async () => {
    const { fetch } = mockFetch([
      { match: '/cgi-bin/gettoken', json: { errcode: 0, access_token: 'APP_TOKEN' } },
      { match: '/cgi-bin/auth/getuserinfo', json: { errcode: 0 } },
    ]);
    await expect(exchangeWeComCode({ ...APP, code: 'CODE', fetch })).rejects.toThrow(
      /neither userid nor openid/,
    );
  });
});

describe('getWeComUserInfo', () => {
  const tokens = { accessToken: 'APP_TOKEN', raw: { userid: 'zhangsan' } };

  it('reads the member profile when detail is available', async () => {
    const { fetch, calls } = mockFetch([
      {
        match: '/cgi-bin/user/get',
        json: {
          errcode: 0,
          userid: 'zhangsan',
          name: '张三',
          email: 'zhangsan@corp.com',
          avatar: 'https://a/x.png',
        },
      },
    ]);

    const info = await getWeComUserInfo(tokens, { fetch });

    expect(calls[0]).toContain('/cgi-bin/user/get');
    expect(calls[0]).toContain('userid=zhangsan');
    expect(info).toEqual({
      id: 'zhangsan',
      name: '张三',
      email: 'zhangsan@corp.com',
      image: 'https://a/x.png',
      emailVerified: false,
    });
  });

  it('falls back to a userid-only identity when detail is forbidden', async () => {
    const { fetch } = mockFetch([
      { match: '/cgi-bin/user/get', json: { errcode: 60011, errmsg: 'no privilege' } },
    ]);
    const info = await getWeComUserInfo(tokens, { fetch });
    expect(info).toEqual({ id: 'zhangsan', emailVerified: false });
  });

  it('skips the detail call entirely when fetchDetail is false', async () => {
    const { fetch, calls } = mockFetch([]);
    const info = await getWeComUserInfo(tokens, { fetchDetail: false, fetch });
    expect(info).toEqual({ id: 'zhangsan', emailVerified: false });
    expect(calls).toHaveLength(0);
  });

  it('returns null when there is no identifier', async () => {
    const { fetch } = mockFetch([]);
    expect(await getWeComUserInfo({ accessToken: 'X', raw: {} }, { fetch })).toBeNull();
  });
});

describe('wecom() genericOAuth config', () => {
  it('wires the two-step exchange through the genericOAuth hooks', async () => {
    const { fetch } = mockFetch([
      { match: '/cgi-bin/gettoken', json: { errcode: 0, access_token: 'APP_TOKEN' } },
      { match: '/cgi-bin/auth/getuserinfo', json: { errcode: 0, userid: 'zhangsan' } },
      { match: '/cgi-bin/user/get', json: { errcode: 0, userid: 'zhangsan', name: '张三' } },
    ]);

    const config = wecom({ ...APP, agentId: 1000002, fetch });
    expect(config.providerId).toBe('wecom');
    expect(config.clientId).toBe('corp_id');
    expect(config.authorizationUrlParams).toEqual({ appid: 'corp_id', agentid: '1000002' });

    const tokens = await config.getToken?.({ code: 'CODE', redirectURI: 'https://app/cb' });
    expect(tokens?.accessToken).toBe('APP_TOKEN');
    if (!tokens) throw new Error('expected tokens');
    const info = await config.getUserInfo?.(tokens);
    expect(info).toMatchObject({ id: 'zhangsan', name: '张三' });
  });
});

describe('wecomAuthorizeUrl', () => {
  it('builds the QR login URL by default', () => {
    const url = wecomAuthorizeUrl(
      { corpId: 'corp_id', agentId: 1000002 },
      { redirectURI: 'https://app/cb', state: 's' },
    );
    expect(url.startsWith('https://login.work.weixin.qq.com/wwlogin/sso/login?')).toBe(true);
    expect(url).toContain('login_type=CorpApp');
    expect(url).toContain('appid=corp_id');
    expect(url).toContain('agentid=1000002');
  });

  it('builds the in-app oauth2 URL with the #wechat_redirect fragment', () => {
    const url = wecomAuthorizeUrl(
      { corpId: 'corp_id', agentId: 1000002, mode: 'in-app' },
      { redirectURI: 'https://app/cb', state: 's' },
    );
    expect(url).toContain('/connect/oauth2/authorize');
    expect(url).toContain('scope=snsapi_base');
    expect(url.endsWith('#wechat_redirect')).toBe(true);
  });
});
