import { describe, expect, it } from 'vitest';
import { exchangeWeChatCode, getWeChatUserInfo, wechat, wechatAuthorizeUrl } from '../wechat';
import { mockFetch } from './helpers';

const APP = { appId: 'wx_app_id', appSecret: 'wx_app_secret' };

describe('exchangeWeChatCode', () => {
  it('calls the token endpoint with appid/secret/code and parses openid', async () => {
    const { fetch, calls } = mockFetch([
      {
        match: '/sns/oauth2/access_token',
        json: {
          access_token: 'ACCESS',
          expires_in: 7200,
          refresh_token: 'REFRESH',
          openid: 'OPENID',
          unionid: 'UNIONID',
          scope: 'snsapi_login',
        },
      },
    ]);

    const tokens = await exchangeWeChatCode({ ...APP, code: 'CODE', fetch });

    expect(calls[0]).toContain('appid=wx_app_id');
    expect(calls[0]).toContain('secret=wx_app_secret');
    expect(calls[0]).toContain('code=CODE');
    expect(calls[0]).toContain('grant_type=authorization_code');
    expect(tokens.accessToken).toBe('ACCESS');
    expect(tokens.refreshToken).toBe('REFRESH');
    expect(tokens.scopes).toEqual(['snsapi_login']);
    expect(tokens.raw).toMatchObject({ openid: 'OPENID', unionid: 'UNIONID' });
    expect(tokens.accessTokenExpiresAt).toBeInstanceOf(Date);
  });

  it('throws with the WeChat error code on failure', async () => {
    const { fetch } = mockFetch([
      { match: '/sns/oauth2/access_token', json: { errcode: 40029, errmsg: 'invalid code' } },
    ]);
    await expect(exchangeWeChatCode({ ...APP, code: 'bad', fetch })).rejects.toThrow(/40029/);
  });

  it('throws when the response is missing access_token/openid', async () => {
    const { fetch } = mockFetch([{ match: '/sns/oauth2/access_token', json: {} }]);
    await expect(exchangeWeChatCode({ ...APP, code: 'CODE', fetch })).rejects.toThrow(
      /no access_token\/openid/,
    );
  });
});

describe('getWeChatUserInfo', () => {
  const tokens = {
    accessToken: 'ACCESS',
    raw: { openid: 'OPENID', unionid: 'UNIONID' },
  };

  it('maps the WeChat profile onto Better Auth user info', async () => {
    const { fetch, calls } = mockFetch([
      {
        match: '/sns/userinfo',
        json: {
          openid: 'OPENID',
          nickname: '小明',
          headimgurl: 'https://img/x.png',
          unionid: 'UNIONID',
        },
      },
    ]);

    const info = await getWeChatUserInfo(tokens, { fetch });

    expect(calls[0]).toContain('access_token=ACCESS');
    expect(calls[0]).toContain('openid=OPENID');
    expect(info).toEqual({
      id: 'UNIONID',
      name: '小明',
      image: 'https://img/x.png',
      emailVerified: false,
    });
  });

  it('falls back to an id-only identity when the profile scope is missing', async () => {
    const { fetch } = mockFetch([
      { match: '/sns/userinfo', json: { errcode: 48001, errmsg: 'api unauthorized' } },
    ]);
    const info = await getWeChatUserInfo(tokens, { fetch });
    expect(info).toEqual({ id: 'UNIONID', emailVerified: false });
  });

  it('returns null when there is no openid to identify the user', async () => {
    const { fetch } = mockFetch([{ match: '/sns/userinfo', json: {} }]);
    const info = await getWeChatUserInfo({ accessToken: 'ACCESS', raw: {} }, { fetch });
    expect(info).toBeNull();
  });
});

describe('wechat() genericOAuth config', () => {
  it('produces a provider that uses appid and the WeChat endpoints end to end', async () => {
    const { fetch, calls } = mockFetch([
      {
        match: '/sns/oauth2/access_token',
        json: {
          access_token: 'ACCESS',
          openid: 'OPENID',
          unionid: 'UNIONID',
          scope: 'snsapi_login',
        },
      },
      { match: '/sns/userinfo', json: { openid: 'OPENID', nickname: 'Coin', unionid: 'UNIONID' } },
    ]);

    const config = wechat({ ...APP, fetch });

    expect(config.providerId).toBe('wechat');
    expect(config.clientId).toBe('wx_app_id');
    expect(config.scopes).toEqual(['snsapi_login']);
    expect(config.authorizationUrlParams).toEqual({ appid: 'wx_app_id' });
    expect(config.pkce).toBe(false);

    // Exercise the wired hooks the way genericOAuth would.
    const tokens = await config.getToken?.({ code: 'CODE', redirectURI: 'https://app/cb' });
    expect(tokens?.accessToken).toBe('ACCESS');
    if (!tokens) throw new Error('expected tokens');
    const info = await config.getUserInfo?.(tokens);
    expect(info).toMatchObject({ id: 'UNIONID', name: 'Coin' });
    expect(calls.some((u) => u.includes('/sns/oauth2/access_token'))).toBe(true);
    expect(calls.some((u) => u.includes('/sns/userinfo'))).toBe(true);
  });

  it('defaults to snsapi_userinfo scope in official-account mode', () => {
    const config = wechat({ ...APP, mode: 'official-account' });
    expect(config.scopes).toEqual(['snsapi_userinfo']);
    expect(config.authorizationUrl).toContain('/connect/oauth2/authorize');
  });
});

describe('wechatAuthorizeUrl', () => {
  it('includes appid, standard params and the required #wechat_redirect fragment', () => {
    const url = wechatAuthorizeUrl(
      { appId: 'wx_app_id' },
      { redirectURI: 'https://app.example.com/cb', state: 'xyz' },
    );
    expect(url.startsWith('https://open.weixin.qq.com/connect/qrconnect?')).toBe(true);
    expect(url).toContain('appid=wx_app_id');
    expect(url).toContain('response_type=code');
    expect(url).toContain('scope=snsapi_login');
    expect(url).toContain('state=xyz');
    expect(url).toContain('redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb');
    expect(url.endsWith('#wechat_redirect')).toBe(true);
  });

  it('uses the oauth2/authorize endpoint for official-account mode', () => {
    const url = wechatAuthorizeUrl(
      { appId: 'wx_app_id', mode: 'official-account' },
      { redirectURI: 'https://app/cb', state: 's' },
    );
    expect(url).toContain('/connect/oauth2/authorize');
    expect(url).toContain('scope=snsapi_userinfo');
  });
});
