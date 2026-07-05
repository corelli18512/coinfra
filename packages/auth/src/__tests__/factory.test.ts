import { beforeEach, describe, expect, it } from 'vitest';
import { createCoinfraAuth } from '../factory';
import { testConfig } from './helpers';

describe('createCoinfraAuth', () => {
  it('returns a real Better Auth instance, not a wrapper', () => {
    const auth = createCoinfraAuth(testConfig());
    expect(auth.api).toBeDefined();
    expect(typeof auth.handler).toBe('function');
    // `$context` and `options` are Better Auth's genuine surface — present only
    // on the real instance, proving we return it rather than a proxy.
    expect(auth.$context).toBeDefined();
    expect(auth.options).toBeDefined();
  });

  describe('with a fresh in-memory store per test', () => {
    let auth: ReturnType<typeof createCoinfraAuth>;

    beforeEach(() => {
      auth = createCoinfraAuth(testConfig());
    });

    it('signs a user up and back in through the real engine', async () => {
      const email = 'coin@example.com';
      const password = 'sup3r-secret-passphrase';

      const signUp = await auth.api.signUpEmail({
        body: { email, password, name: 'Coin' },
      });
      expect(signUp.user.email).toBe(email);

      const signIn = await auth.api.signInEmail({ body: { email, password } });
      expect(signIn.user.email).toBe(email);
      expect(signIn.token).toBeTruthy();
    });

    it('rejects a wrong password', async () => {
      const email = 'mascot@example.com';
      await auth.api.signUpEmail({
        body: { email, password: 'the-right-password', name: 'Mascot' },
      });
      await expect(
        auth.api.signInEmail({ body: { email, password: 'the-wrong-password' } }),
      ).rejects.toThrow();
    });
  });

  it('bundles oauthProviders into the shared genericOAuth callback route', () => {
    const auth = createCoinfraAuth(
      testConfig({
        oauthProviders: [
          {
            providerId: 'demo',
            clientId: 'id',
            clientSecret: 'secret',
            authorizationUrl: 'https://example.com/authorize',
            tokenUrl: 'https://example.com/token',
            userInfoUrl: 'https://example.com/userinfo',
          },
        ],
      }),
    );
    const paths = Object.values(auth.api).map((endpoint) => endpoint.path);
    expect(paths).toContain('/oauth2/callback/:providerId');
  });

  it('applies the house session preset and lets the caller override it', () => {
    const THIRTY_DAYS = 60 * 60 * 24 * 30;
    const withDefault = createCoinfraAuth(testConfig());
    expect(withDefault.options.session?.expiresIn).toBe(THIRTY_DAYS);

    const overridden = createCoinfraAuth(testConfig({ session: { expiresIn: 42 } }));
    expect(overridden.options.session?.expiresIn).toBe(42);
  });
});
