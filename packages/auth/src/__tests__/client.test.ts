import { describe, expect, it } from 'vitest';
import { smsOTPClient, wechatMiniProgramClient } from '../client';

// biome-ignore lint/suspicious/noExplicitAny: exercising loosely-typed client plumbing.
type Any = any;

describe('wechatMiniProgramClient', () => {
  it('is a client plugin with the wechat-miniprogram id', () => {
    const plugin = wechatMiniProgramClient() as Any;
    expect(plugin.id).toBe('wechat-miniprogram');
    expect(plugin.pathMethods['/sign-in/wechat-miniprogram']).toBe('POST');
  });

  it('POSTs the login code to the sign-in endpoint', async () => {
    const calls: Array<{ path: string; options: Any }> = [];
    const fakeFetch = (async (path: string, options: Any) => {
      calls.push({ path, options });
      return { data: { token: 'tok', user: { id: 'u1' } }, error: null };
    }) as Any;

    const actions = (wechatMiniProgramClient() as Any).getActions(fakeFetch, {}, undefined);
    const res = await actions.signInWeChatMiniProgram({ code: 'abc' });

    expect(calls[0]?.path).toBe('/sign-in/wechat-miniprogram');
    expect(calls[0]?.options.method).toBe('POST');
    expect(calls[0]?.options.body).toEqual({ code: 'abc' });
    expect(res.data.token).toBe('tok');
  });

  it('forwards extra fetch options', async () => {
    const calls: Array<{ path: string; options: Any }> = [];
    const fakeFetch = (async (path: string, options: Any) => {
      calls.push({ path, options });
      return { data: null, error: null };
    }) as Any;

    const actions = (wechatMiniProgramClient() as Any).getActions(fakeFetch, {}, undefined);
    await actions.signInWeChatMiniProgram({ code: 'abc' }, { headers: { 'x-test': '1' } });

    expect(calls[0]?.options.headers).toEqual({ 'x-test': '1' });
    expect(calls[0]?.options.body).toEqual({ code: 'abc' });
  });
});

describe('smsOTPClient', () => {
  it('re-exports Better Auth’s phone-number client plugin', () => {
    expect((smsOTPClient() as Any).id).toBe('phoneNumber');
  });
});
