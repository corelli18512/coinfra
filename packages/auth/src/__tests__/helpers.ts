import { memoryAdapter } from '@better-auth/memory-adapter';
import type { FetchLike } from '../internal/http';
import type { CoinfraAuthConfig } from '../types';

export const TEST_SECRET = 'test-secret-that-is-at-least-32-characters-long';

/**
 * A fresh in-memory store seeded with Better Auth's core models. The memory
 * adapter does not lazily create model arrays, so every model a test touches
 * must exist up front. Pass `extraModels` for plugin-owned tables.
 */
export function freshMemoryDb(...extraModels: string[]): Record<string, unknown[]> {
  const db: Record<string, unknown[]> = {};
  for (const model of ['user', 'session', 'account', 'verification', ...extraModels]) {
    db[model] = [];
  }
  return db;
}

/** A ready-to-run `createCoinfraAuth` config backed by a fresh in-memory store. */
export function testConfig(
  overrides: Partial<CoinfraAuthConfig> = {},
  ...extraModels: string[]
): CoinfraAuthConfig {
  return {
    database: memoryAdapter(freshMemoryDb(...extraModels)),
    secret: TEST_SECRET,
    baseURL: 'http://localhost:3000',
    emailAndPassword: { enabled: true },
    ...overrides,
  };
}

export interface MockRoute {
  /** Substring matched against the request URL. */
  match: string;
  /** JSON body to return. */
  json?: unknown;
  /** HTTP status. @default 200 */
  status?: number;
}

/**
 * A {@link FetchLike} that answers by matching request URLs against `routes`
 * (first substring match wins) and records every requested URL. This is the
 * injection point that lets connector tests script exact WeChat/WeCom responses
 * with no network and no real credentials.
 */
export function mockFetch(routes: MockRoute[]): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetch = (async (input: unknown) => {
    const url = typeof input === 'string' ? input : String((input as { url: string }).url);
    calls.push(url);
    const route = routes.find((candidate) => url.includes(candidate.match));
    if (!route) return new Response('no matching mock route', { status: 404 });
    return new Response(JSON.stringify(route.json ?? {}), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as FetchLike;
  return { fetch, calls };
}
