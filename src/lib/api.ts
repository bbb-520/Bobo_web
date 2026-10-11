import {
  type ChatEvent,
  type ImageAttachment,
  type ImageJobRef,
} from '../types';
import { imageJobResponseAction, ImageJobNotFoundError } from './imageJobPolling';
import { apiUrl, csrfFetch } from './http';
export { apiUrl } from './http';

/**
 * 拼接后端地址：baseUrl 为空时使用同源(开发经 Vite 代理 /api → Java 后端)。
 */

export type StreamResult = { kind: 'done' | 'error' | 'timeout'; message?: string; status?: number };

export interface StreamChatOptions {
  question: string;
  sessionId: string;
  baseUrl: string;
  signal?: AbortSignal;
  attachments?: ImageAttachment[];
  onEvent: (e: ChatEvent) => void;
  /**
   * 流空闲超时（单位 ms，默认 60000）：超过该时长未收到任何新数据视为连接挂起，
   * 自动中断并返回 {kind:'timeout'}，避免 UI 永远停在「生成中」。
   */
  idleTimeoutMs?: number;
}
/**
 * 调用后端 SSE(POST /api/chat, text/event-stream)。
 * 使用 fetch + ReadableStream 逐行解析 `data: {...}`（兼容 \n 与 \r\n），
 * 每次收到一个事件都会回调 onEvent；以 1002(STOP)/1004(ERROR) 收尾。
 * 网络/HTTP 层面的失败以 {kind:'error'} 返回，不会抛异常。
 *
 * 解析健壮性：
 * - 半行 JSON 跨 chunk → 按行缓冲后再解析；
 * - 多个 data: 挤在同一 chunk → 逐行循环处理；
 * - 空行 / 注释行(以 ':' 开头) / 其他字段行 → 跳过；
 * - 末尾无换行的残留 → 流关闭后补处理；
 * - 单帧 JSON 解析失败 → console.warn 跳过该帧，绝不中断整条流。
 *
 * 注意：流式接口的业务错误通常通过 1004 事件返回，
 * 成败以「是否收到 1002 / 1004」为准，不能只看 HTTP 状态码。
 */
export async function streamChat(opts: StreamChatOptions): Promise<StreamResult> {
  const { question, sessionId, baseUrl, signal, onEvent, attachments } = opts;
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  /* --- 空闲超时兜底：每次收到新数据重置计时，超时则本地中断 --- */
  const idleMs = Math.max(3000, opts.idleTimeoutMs ?? 60000);
  let idleHit = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const clearIdle = () => {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  };
  const resetIdle = () => {
    clearIdle();
    idleTimer = setTimeout(() => {
      idleHit = true;
      controller.abort();
    }, idleMs);
  };
  resetIdle();

  /** 处理一行 SSE 数据（去掉行尾 \r、取 data: 载荷并派发事件） */
  const handleLine = (rawLine: string) => {
    const line = rawLine.replace(/\r$/, '');
    // 空行 / 注释行(':' 开头) / 非 data 字段：跳过（事件帧之间的空行等）
    if (!line || line.startsWith(':') || !line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload) return;
    try {
      onEvent(JSON.parse(payload) as ChatEvent);
    } catch (err) {
      // 单帧解析失败只告警并跳过，不影响后续事件
      console.warn('[SSE] 忽略无法解析的事件帧：', payload, err);
    }
  };

  try {
    const res = await csrfFetch(baseUrl, '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ question, sessionId, attachments: attachments?.length ? attachments : undefined }),
      // AgentDemo 通过 HttpOnly 匿名 Cookie 绑定会话归属；直连模式同样需要带上它。
      credentials: 'include',
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let message = res.status === 401 ? '登录已过期，请重新登录' : res.status === 402 ? '余额不足，请充值后继续' : res.status === 409 ? '账户有请求处理中或待对账，请稍后再试' : `请求失败（HTTP ${res.status}）`;
      try { const problem = JSON.parse(body); message = problem.message || problem.detail || message; } catch { /* Use the status fallback. */ }
      return { kind: 'error', message, status: res.status };
    }
    if (!res.body) return { kind: 'error', message: '浏览器不支持流式响应' };

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      resetIdle(); // 收到任何新数据都视为「活动」，刷新空闲计时

      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        handleLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }

    // 流关闭后可能残留最后一行（无换行符结尾），也要处理
    if (buffer) handleLine(buffer);

    return { kind: 'done' };
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (idleHit) {
      // 空闲超时主动断连（区别于用户停止 / 网络错误）
      return {
        kind: 'timeout',
        message: `连接空闲超过 ${Math.round(idleMs / 1000)}s 未收到数据，已自动中断`,
      };
    }
    if (name === 'AbortError' || controller.signal.aborted) {
      return { kind: 'done', message: '已停止' };
    }
    const url = apiUrl('/api/chat', baseUrl);
    const tail = '（请确认 Gateway 已启动并可通过当前站点访问）';
    const msg =
      err instanceof TypeError
        ? `无法连接 ${url}${tail}`
        : err instanceof Error
          ? `${url}：${err.message}`
          : `未知错误（${url}）`;
    return { kind: 'error', message: msg };
  } finally {
    clearIdle();
    if (signal) signal.removeEventListener('abort', onOuterAbort);
  }
}
export interface UploadPolicyResponse {
  assetId: string;
  objectKey: string;
  uploadUrl: string;
  fields: Record<string, string>;
  expiresAt: string;
}

export interface ImageJobView extends ImageJobRef {}

export interface ZineGenerationResponse {
  mode: string;
  language: string;
  prompt: string;
  imageUrl?: string | null;
}

/** Generate a zine image through the backend content service. */
export async function generateZine(
  file: File,
  options: { mode?: string; language?: string; text?: string; guidance?: string },
  baseUrl: string,
  signal?: AbortSignal,
): Promise<ZineGenerationResponse> {
  const form = new FormData();
  form.append('image', file, file.name);
  for (const [key, value] of Object.entries(options)) if (value) form.append(key, value);
  const response = await csrfFetch(baseUrl, '/api/zine/generate', { method: 'POST', body: form, credentials: 'include', signal });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.message === 'string' ? body.message : `生成失败（HTTP ${response.status}）`);
  return body as ZineGenerationResponse;
}

/** 前端先拿短期 PostObject 策略，再把图片直接送到 OSS，不经过 Java 服务内存。 */
export async function uploadImageAsset(file: File, baseUrl: string, signal?: AbortSignal): Promise<ImageAttachment> {
  const policyResponse = await csrfFetch(baseUrl, '/api/image-assets/upload-policy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    signal,
    body: JSON.stringify({ fileName: file.name, contentType: file.type, fileSize: file.size }),
  });
  if (!policyResponse.ok) {
    const message = await policyResponse.text().catch(() => '');
    throw new Error(message || `获取图片上传策略失败（${policyResponse.status}）`);
  }
  const policy = (await policyResponse.json()) as UploadPolicyResponse;
  const form = new FormData();
  Object.entries(policy.fields).forEach(([key, value]) => form.append(key, value));
  form.append('file', file, file.name);
  let uploaded: Response;
  try {
    uploaded = await fetch(policy.uploadUrl, { method: 'POST', body: form, signal });
  } catch (error) {
    // 跨域上传被 OSS CORS 拦截时，浏览器通常只会返回 TypeError，
    // DevTools 里常见表现是 OSS 请求 200 但响应体为 0 B。
    if (error instanceof TypeError) {
      throw new Error(
        '图片上传被 OSS 跨域策略拦截，请在 Bucket CORS 中加入当前前端地址（例如 http://127.0.0.1:5176 和 http://localhost:5176）',
      );
    }
    throw error;
  }
  if (!uploaded.ok) {
    const message = await uploaded.text().catch(() => '');
    throw new Error(message || `图片上传 OSS 失败（${uploaded.status}）`);
  }

  const completed = await csrfFetch(baseUrl, `/api/image-assets/${encodeURIComponent(policy.assetId)}/complete`, {
    method: 'POST',
    credentials: 'include',
    signal,
  });
  if (!completed.ok) throw new Error('OSS 图片校验失败，未能创建图片任务');
  return {
    assetId: policy.assetId,
    fileName: file.name,
    mimeType: file.type,
    fileSize: file.size,
  };
}

export async function fetchImageJob(jobId: string, baseUrl: string, signal?: AbortSignal): Promise<ImageJobView | null> {
  try {
    const response = await csrfFetch(baseUrl, `/api/image-jobs/${encodeURIComponent(jobId)}`, {
      credentials: 'include', signal,
    });
    const action = imageJobResponseAction(response.status);
    if (action === 'missing') throw new ImageJobNotFoundError(jobId);
    if (action === 'retry') return null;
    const value = await response.json();
    return value && typeof value.jobId === 'string' ? value as ImageJobView : null;
  } catch (error) {
    if (error instanceof ImageJobNotFoundError) throw error;
    return null;
  }
}
export async function fetchConversationImageJobs(conversationId: string, baseUrl: string): Promise<ImageJobView[] | null> {
  try {
    const response = await csrfFetch(baseUrl, `/api/image-jobs?conversationId=${encodeURIComponent(conversationId)}`, {
      credentials: 'include',
    });
    if (!response.ok) return null;
    const value = await response.json();
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export class BoboApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'BoboApiError';
  }
}

export interface BoboWorldItem {
  itemId: string;
  imageUrl: string;
  thumbnailUrl: string;
  hasCaption: boolean;
  caption: string | null;
  senderName: string | null;
  anonymous: boolean;
  createdAt: string;
}

export interface BoboMineItem {
  itemId: string;
  status: 'ACTIVE' | 'HIDDEN' | 'DELETED';
  visibility: 'PUBLIC' | 'PRIVATE';
  caption: string | null;
  prompt?: string | null;
  anonymous: boolean;
  version: number;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BoboWorldPage { items: BoboWorldItem[]; nextCursor: string | null; }
export interface BoboMinePage { items: BoboMineItem[]; nextCursor: string | null; publicCount: number; }
export interface BoboPublishRequest { jobId: string; caption?: string | null; anonymous?: boolean; }
export interface BoboPublishResult {
  itemId: string;
  status: string;
  caption: string | null;
  anonymous: boolean;
  visibility: 'PUBLIC' | 'PRIVATE';
  version: number;
  imageUrl: string | null;
  createdAt: string;
}

async function boboRequest<T>(path: string, baseUrl: string, init: RequestInit = {}): Promise<T> {
  const response = await csrfFetch(baseUrl, path, {
    ...init,
    credentials: 'include',
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    let message = raw;
    try {
      const body = JSON.parse(raw) as { message?: unknown; detail?: unknown; error?: unknown };
      if (typeof body.message === 'string') message = body.message;
      else if (typeof body.detail === 'string') message = body.detail;
      else if (typeof body.error === 'string') message = body.error;
    } catch { /* Keep the plain response text when it is not JSON. */ }
    throw new BoboApiError(message || `请求失败（HTTP ${response.status}）`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

function boboPagePath(path: string, limit: number, cursor?: string | null) {
  const query = new URLSearchParams({ limit: String(Math.max(1, Math.min(48, Math.trunc(limit)))) });
  if (cursor) query.set('cursor', cursor);
  return `${path}?${query.toString()}`;
}

export function fetchBoboWorld(baseUrl: string, limit = 24, cursor?: string | null, signal?: AbortSignal): Promise<BoboWorldPage> {
  return boboRequest(boboPagePath('/api/bobo/world', limit, cursor), baseUrl, { signal });
}

export function fetchMyBoboItems(baseUrl: string, limit = 24, cursor?: string | null, signal?: AbortSignal): Promise<BoboMinePage> {
  return boboRequest(boboPagePath('/api/bobo/items/mine', limit, cursor), baseUrl, { signal });
}

export function publishBoboItem(baseUrl: string, request: BoboPublishRequest): Promise<BoboPublishResult> {
  return boboRequest('/api/bobo/items', baseUrl, { method: 'POST', body: JSON.stringify(request) });
}

export function patchBoboItem(baseUrl: string, itemId: string, patch: {
  caption: string; anonymous: boolean; visibility: 'PUBLIC' | 'PRIVATE'; version: number;
}): Promise<BoboMineItem> {
  return boboRequest(`/api/bobo/items/${encodeURIComponent(itemId)}`, baseUrl, {
    method: 'PATCH', body: JSON.stringify(patch),
  });
}

export function deleteBoboItem(baseUrl: string, itemId: string): Promise<void> {
  return boboRequest(`/api/bobo/items/${encodeURIComponent(itemId)}`, baseUrl, { method: 'DELETE' });
}
