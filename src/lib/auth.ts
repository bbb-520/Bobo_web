import { apiRequest } from './http.ts';
export interface AuthUser {
  username: string;
  userId?: string;
  qqEmail?: string | null;
  emailBound?: boolean;
  roles?: string[];
  permissions?: string[];
}
export const hasPermission = (user: AuthUser | null, permission: string): boolean =>
  Boolean(user?.permissions?.includes(permission));
export interface ModelProfile {
  provider: string;
  capability: string;
  model: string;
  enabled: boolean;
}
export type CodePurpose = 'REGISTER' | 'LOGIN' | 'BIND';
export const isQqEmail = (email: string) =>
  /^[a-z0-9][a-z0-9._-]{0,63}@qq\.com$/i.test(email.trim());
export function listModelProfiles(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<ModelProfile[]> {
  return apiRequest(baseUrl, '/api/settings/models', { signal });
}
export function getMe(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<AuthUser> {
  return apiRequest(baseUrl, '/api/auth/me', { signal });
}
export function login(
  baseUrl: string,
  username: string,
  password: string,
  signal?: AbortSignal,
): Promise<AuthUser> {
  return apiRequest(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
    signal,
  });
}
export function register(
  baseUrl: string,
  username: string,
  password: string,
  qqEmail: string,
  code: string,
  signal?: AbortSignal,
): Promise<void> {
  return apiRequest(baseUrl, '/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, qqEmail, code }),
    signal,
  });
}
export function emailLogin(
  baseUrl: string,
  qqEmail: string,
  code: string,
  signal?: AbortSignal,
): Promise<AuthUser> {
  return apiRequest(baseUrl, '/api/auth/email/login', {
    method: 'POST',
    body: JSON.stringify({ qqEmail, code }),
    signal,
  });
}
export function sendEmailCode(
  baseUrl: string,
  qqEmail: string,
  purpose: CodePurpose,
  signal?: AbortSignal,
): Promise<{ expiresIn: number; resendAfter: number }> {
  return apiRequest(baseUrl, '/api/auth/email/code', {
    method: 'POST',
    body: JSON.stringify({ qqEmail, purpose }),
    signal,
  });
}
export function bindEmail(
  baseUrl: string,
  qqEmail: string,
  code: string,
  signal?: AbortSignal,
): Promise<{ qqEmail: string; emailBound: boolean }> {
  return apiRequest(baseUrl, '/api/auth/email/bind', {
    method: 'POST',
    body: JSON.stringify({ qqEmail, code }),
    signal,
  });
}
export function logout(baseUrl: string): Promise<void> {
  return apiRequest(baseUrl, '/api/auth/logout', { method: 'POST' });
}
