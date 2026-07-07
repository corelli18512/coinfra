/**
 * The tiny slice of HTTP the domestic connectors need. Everything goes through
 * an injected {@link FetchLike} so tests can drive the exact provider responses
 * without touching the network or holding real credentials.
 */

/** The subset of the platform `fetch` the connectors use — the test seam. */
export type FetchLike = typeof globalThis.fetch;

/**
 * GET a URL and parse the JSON body. Deliberately never includes the URL in the
 * error — WeChat/WeCom carry the app secret in the query string, and it must
 * not leak into logs or thrown errors.
 */
export async function getJson<T>(
  url: string,
  fetchImpl: FetchLike,
  headers?: Record<string, string>,
): Promise<T> {
  const response = await fetchImpl(url, { method: 'GET', headers });
  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * POST a JSON body and parse the JSON response. Used by the connectors whose
 * token endpoints are JSON-in/JSON-out (DingTalk, Feishu). Like {@link getJson},
 * the URL is kept out of thrown errors so credentials never leak.
 */
export async function postJson<T>(
  url: string,
  body: unknown,
  fetchImpl: FetchLike,
  headers?: Record<string, string>,
): Promise<T> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * POST an `application/x-www-form-urlencoded` body and parse the JSON response —
 * the shape OAuth token endpoints classically expect (Weibo, Douyin, Twilio).
 * `undefined` values are dropped.
 */
export async function postForm<T>(
  url: string,
  params: Record<string, string | undefined>,
  fetchImpl: FetchLike,
  headers?: Record<string, string>,
): Promise<T> {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) form.set(key, value);
  }
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: form.toString(),
  });
  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

/** Build a query string from string params, dropping any that are undefined. */
export function queryString(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, value);
  }
  return search.toString();
}
