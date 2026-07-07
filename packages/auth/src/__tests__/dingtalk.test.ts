import { describe, expect, it } from 'vitest';
import {
  dingtalk,
  dingtalkAuthorizeUrl,
  exchangeDingTalkCode,
  getDingTalkUserInfo,
} from '../dingtalk';
import { mockFetch } from './helpers';

const APP = { clientId: 'CLIENT_ID', clientSecret: 'CLIENT_SECRET' };

describe('exchangeDingTalkCode', () => {
  it('POSTs JSON and returns the user access token', async () => {
    const { fetch, requests } = mockFetch([
      {
        match: '/v1.0/oauth2/userAccessToken',
        json: { accessToken: 'AT', corpId: 'CORP', expireIn: 7200 },
      },
    ]);

    const tokens = await exchangeDingTalkCode({ ...APP, code: 'CODE', fetch });

    expect(tokens.accessToken).toBe('AT');
    expect(tokens.raw).toMatchObject({ corpId: 'CORP' });
    expect(requests[0].headers['content-type']).toContain('application/json');
    expect(requests[0].body).toContain('"grantType":"authorization_code"');
    expect(requests[0].body).toContain('"code":"CODE"');
  });

  it('throws when no accessToken comes back', async () => {
    const { fetch } = mockFetch([{ match: '/userAccessToken', json: {} }]);
    await expect(exchangeDingTalkCode({ ...APP, code: 'X', fetch })).rejects.toThrow(
      /no accessToken/,
    );
  });
});

describe('getDingTalkUserInfo', () => {
  it('authenticates with the x-acs-dingtalk-access-token header and prefers unionId', async () => {
    const { fetch, requests } = mockFetch([
      {
        match: '/v1.0/contact/users/me',
        json: {
          nick: '钉钉',
          unionId: 'U1',
          openId: 'O1',
          email: 'a@b.com',
          avatarUrl: 'https://a/av',
        },
      },
    ]);
    const info = await getDingTalkUserInfo({ accessToken: 'AT', raw: {} }, { fetch });
    expect(info).toEqual({
      id: 'U1',
      name: '钉钉',
      email: 'a@b.com',
      image: 'https://a/av',
      emailVerified: false,
    });
    expect(requests[0].headers['x-acs-dingtalk-access-token']).toBe('AT');
  });
});

describe('dingtalk() genericOAuth config', () => {
  it('wires the exchange through the hooks', async () => {
    const { fetch } = mockFetch([
      { match: '/userAccessToken', json: { accessToken: 'AT' } },
      { match: '/contact/users/me', json: { nick: '钉钉', unionId: 'U1' } },
    ]);
    const config = dingtalk({ ...APP, fetch });
    expect(config.providerId).toBe('dingtalk');
    expect(config.prompt).toBe('consent');
    const tokens = await config.getToken?.({ code: 'CODE', redirectURI: 'https://app/cb' });
    if (!tokens) throw new Error('expected tokens');
    expect(await config.getUserInfo?.(tokens)).toMatchObject({ id: 'U1', name: '钉钉' });
  });
});

describe('dingtalkAuthorizeUrl', () => {
  it('builds the authorize URL', () => {
    const url = dingtalkAuthorizeUrl(
      { clientId: 'CLIENT_ID' },
      { redirectURI: 'https://app/cb', state: 's' },
    );
    expect(url.startsWith('https://login.dingtalk.com/oauth2/auth?')).toBe(true);
    expect(url).toContain('client_id=CLIENT_ID');
    expect(url).toContain('scope=openid');
  });
});
