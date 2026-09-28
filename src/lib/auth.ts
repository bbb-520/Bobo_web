import { apiUrl } from './api';

async function request<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path, baseUrl), {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body?.message === 'string' ? body.message : `请求失败（HTTP ${res.status}）`);
  return body as T;
}

export interface AuthUser { username: string; userId?: string; }
export interface KeyStatus {
  configured: boolean;
  masked?: string | null;
}

export interface ModelProfile {
  provider: string;
  capability: string;
  model: string;
  enabled: boolean;
  maskedApiKey?: string | null;
}

export function listModelProfiles(baseUrl: string): Promise<ModelProfile[]> {
  return request<ModelProfile[]>(baseUrl, '/api/settings/models');
}

export function saveModelProfile(baseUrl: string, profile: { provider: string; capability: string; model: string; apiKey?: string }): Promise<ModelProfile> {
  return request<ModelProfile>(baseUrl, '/api/settings/models', { method: 'PUT', body: JSON.stringify(profile) });
}

export function getMe(baseUrl: string): Promise<AuthUser> {
  return request<AuthUser>(baseUrl, '/api/auth/me');
}

export function login(baseUrl: string, username: string, password: string): Promise<AuthUser> {
  return request<AuthUser>(baseUrl, '/api/auth/login', {
    method: 'POST', body: JSON.stringify({ username, password }),
  });
}

export async function register(baseUrl: string, username: string, password: string): Promise<void> {
  await request(baseUrl, '/api/auth/register', {
    method: 'POST', body: JSON.stringify({ username, password }),
  });
}

export function logout(baseUrl: string): Promise<void> {
  return request<void>(baseUrl, '/api/auth/logout', { method: 'POST' });
}

export function getKeyStatus(baseUrl: string): Promise<KeyStatus> {
  return request<KeyStatus>(baseUrl, '/api/settings/keys');
}

export function saveKeys(baseUrl: string, qwenApiKey: string): Promise<void> {
  return request<void>(baseUrl, '/api/settings/keys', {
    method: 'PUT', body: JSON.stringify({ qwenApiKey }),
  });
}

export function deleteKey(baseUrl: string, provider: 'qwen' | 'dashscope' = 'qwen'): Promise<void> {
  return request<void>(baseUrl, `/api/settings/keys/${provider}`, { method: 'DELETE' });
}
