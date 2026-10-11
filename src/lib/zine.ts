import { apiRequest } from './http.ts';
export interface ZineResult {
  requestId: string;
  result: {
    mode: string;
    model: string;
    imageUrl: string;
    rationale: string;
    providerRequestId: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
  };
}
export async function generateImage(
  base: string,
  file: File,
  text: string,
  signal?: AbortSignal,
): Promise<ZineResult> {
  const form = new FormData();
  form.append('image', file);
  form.append('mode', 'gathered');
  form.append('language', 'zh');
  form.append('text', text);
  return apiRequest(
    base,
    '/api/zine/generate',
    { method: 'POST', body: form, signal },
    300000,
  );
}
export const listImageReceipts = (
  base: string,
  signal?: AbortSignal,
): Promise<string[]> => apiRequest(base, '/api/zine/generations', { signal });
export const getImageReceipt = (
  base: string,
  id: string,
  signal?: AbortSignal,
): Promise<ZineResult> =>
  apiRequest(base, `/api/zine/generations/${encodeURIComponent(id)}`, {
    signal,
  });
