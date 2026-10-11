/** Shared cookie-authenticated JSON transport. */
export function apiUrl(path: string, baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  return base ? `${base}${path}` : path;
}
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}
const csrfRequests = new Map<string, Promise<string>>();
async function csrfToken(baseUrl: string): Promise<string> {
  const endpoint = apiUrl('/api/auth/csrf', baseUrl);
  let pending = csrfRequests.get(endpoint);
  if (!pending) {
    pending = fetch(endpoint, { credentials: 'include', signal: AbortSignal.timeout(15000) })
      .then(async response => {
        const body = await response.json().catch(() => null);
        if (!response.ok || body?.headerName !== 'X-XSRF-TOKEN' || typeof body?.token !== 'string' || !body.token || body.token.length > 512)
          throw new ApiError('无法初始化安全请求，请刷新后重试', response.status >= 400 ? response.status : 503);
        return body.token as string;
      });
    csrfRequests.set(endpoint, pending);
    const request = pending;
    void pending.finally(() => { if (csrfRequests.get(endpoint) === request) csrfRequests.delete(endpoint); }).catch(() => {});
  }
  return pending;
}
async function abortable<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  let abort: () => void = () => {};
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
    })]);
  } finally { signal.removeEventListener('abort', abort); }
}
/** Shared by fetch and progress uploads; never sets a multipart Content-Type. */
export async function csrfHeaders(baseUrl: string, initial?: HeadersInit, signal?: AbortSignal | null): Promise<Headers> {
  signal?.throwIfAborted();
  const headers = new Headers(initial);
  headers.set('X-XSRF-TOKEN', await abortable(csrfToken(baseUrl), signal));
  signal?.throwIfAborted();
  return headers;
}
/** For our backend only; third-party object storage continues to use plain fetch. */
export async function csrfFetch(baseUrl: string, path: string, init: RequestInit = {}): Promise<Response> {
  let headers = new Headers(init.headers);
  init.signal?.throwIfAborted();
  if (!['GET', 'HEAD', 'OPTIONS'].includes((init.method ?? 'GET').toUpperCase()))
    headers = await csrfHeaders(baseUrl, headers, init.signal);
  init.signal?.throwIfAborted();
  return fetch(apiUrl(path, baseUrl), { ...init, headers, credentials: 'include' });
}
export async function apiRequest<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (
    init.body &&
    !headers.has('Content-Type') &&
    !(init.body instanceof FormData)
  )
    headers.set('Content-Type', 'application/json');
  const controller = new AbortController();
  const cancelled = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  else init.signal?.addEventListener('abort', cancelled, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await csrfFetch(baseUrl, path, {
      ...init,
      headers,
      signal: controller.signal,
      credentials: 'include',
    });
    if (response.status === 204) return undefined as T;
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message = body?.message || body?.detail || body?.error;
      const fallback =
        response.status === 401
          ? '登录已过期，请重新登录'
          : response.status === 403
            ? '权限不足或安全令牌已失效，请刷新账户后重试'
          : response.status === 402
            ? '余额不足，请充值后继续'
            : response.status === 409
              ? '账户有请求处理中或待对账，请稍后重试'
              : `请求失败（HTTP ${response.status}）`;
      throw new ApiError(
        typeof message === 'string' ? message : fallback,
        response.status,
      );
    }
    if (timedOut)
      throw new ApiError('请求超时，请查看账户与生成回执后再操作', 408);
    return body as T;
  } catch (cause) {
    if (timedOut)
      throw new ApiError('请求超时，请查看账户与生成回执后再操作', 408);
    if (cause instanceof TypeError)
      throw new ApiError('无法连接服务，请稍后重试', 503);
    throw cause;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', cancelled);
  }
}
