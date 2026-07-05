import { describe, expect, it } from 'vitest';
import { createCoinfraAuth } from '../factory';
import { exchangeMiniProgramCode, wechatMiniProgram } from '../wechat';
import { mockFetch, testConfig } from './helpers';

const APP = { appId: 'wx_mp_id', appSecret: 'wx_mp_secret' };

// biome-ignore lint/suspicious/noExplicitAny: the plugin is intentionally type-erased to BetterAuthPlugin, so its endpoint is reached dynamically here.
type AnyApi = any;

describe('exchangeMiniProgramCode', () => {
  it('calls jscode2session with appid/secret/js_code and parses the openid', async () => {
    const { fetch, calls } = mockFetch([
      {
        match: '/sns/jscode2session',
        json: { openid: 'OPENID', session_key: 'SK', unionid: 'UNIONID' },
      },
    ]);

    const session = await exchangeMiniProgramCode({ ...APP, code: 'CODE', fetch });

    expect(calls[0]).toContain('appid=wx_mp_id');
    expect(calls[0]).toContain('secret=wx_mp_secret');
    expect(calls[0]).toContain('js_code=CODE');
    expect(calls[0]).toContain('grant_type=authorization_code');
    expect(session).toEqual({ openid: 'OPENID', sessionKey: 'SK', unionid: 'UNIONID' });
  });

  it('throws with the WeChat error code on failure', async () => {
    const { fetch } = mockFetch([
      { match: '/sns/jscode2session', json: { errcode: 40029, errmsg: 'invalid code' } },
    ]);
    await expect(exchangeMiniProgramCode({ ...APP, code: 'bad', fetch })).rejects.toThrow(/40029/);
  });

  it('throws when WeChat returns no openid/session_key', async () => {
    const { fetch } = mockFetch([{ match: '/sns/jscode2session', json: {} }]);
    await expect(exchangeMiniProgramCode({ ...APP, code: 'x', fetch })).rejects.toThrow(/openid/);
  });
});

describe('wechatMiniProgram plugin', () => {
  it('exposes a signInWeChatMiniProgram endpoint', () => {
    const plugin = wechatMiniProgram(APP) as AnyApi;
    expect(plugin.id).toBe('wechat-miniprogram');
    expect(plugin.endpoints.signInWeChatMiniProgram).toBeTruthy();
  });

  it('signs a Mini Program user in, creating a coinfra user + session', async () => {
    const { fetch } = mockFetch([
      { match: 'js_code=alice', json: { openid: 'openid-alice', session_key: 'sk' } },
    ]);
    const auth = createCoinfraAuth(testConfig({ plugins: [wechatMiniProgram({ ...APP, fetch })] }));

    const res = await (auth.api as AnyApi).signInWeChatMiniProgram({ body: { code: 'alice' } });

    expect(res.token).toBeTruthy();
    expect(res.user.email).toBe('openid-alice@wechat.local');
  });

  it('links the same openid to one stable user across sign-ins', async () => {
    const { fetch } = mockFetch([
      { match: 'js_code=alice', json: { openid: 'openid-alice', session_key: 'sk' } },
      { match: 'js_code=bob', json: { openid: 'openid-bob', session_key: 'sk' } },
    ]);
    const auth = createCoinfraAuth(testConfig({ plugins: [wechatMiniProgram({ ...APP, fetch })] }));
    const api = auth.api as AnyApi;

    const a1 = await api.signInWeChatMiniProgram({ body: { code: 'alice' } });
    const a2 = await api.signInWeChatMiniProgram({ body: { code: 'alice' } });
    const b1 = await api.signInWeChatMiniProgram({ body: { code: 'bob' } });

    expect(a1.user.id).toBe(a2.user.id);
    expect(a1.user.id).not.toBe(b1.user.id);
  });

  it('rejects unknown users when disableSignUp is set', async () => {
    const { fetch } = mockFetch([
      { match: 'js_code=ghost', json: { openid: 'openid-ghost', session_key: 'sk' } },
    ]);
    const auth = createCoinfraAuth(
      testConfig({ plugins: [wechatMiniProgram({ ...APP, disableSignUp: true, fetch })] }),
    );

    await expect(
      (auth.api as AnyApi).signInWeChatMiniProgram({ body: { code: 'ghost' } }),
    ).rejects.toThrow();
  });
});
