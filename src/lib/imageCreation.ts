import type { ImageAttachment, ImageJobRef } from '../types';
import { apiRequest } from './http';

export interface ImageCreationRequest {
  requestId: string;
  conversationId: string;
  prompt: string;
  imageGenerationConfirmed: boolean;
  attachments?: ImageAttachment[];
}
export const imageCreationApi = (base: string) => ({
  create: (request: ImageCreationRequest, signal?: AbortSignal) => apiRequest<ImageJobRef>(base, '/api/image-jobs', {method:'POST', body:JSON.stringify(request), signal}),
  byRequest: (requestId: string, signal?: AbortSignal) => apiRequest<ImageJobRef>(base, `/api/image-jobs/by-request/${encodeURIComponent(requestId)}`, {signal}),
});


/** A model verdict recommends a route; only this separate user choice permits creation. */
export function confirmImageCreation(prompt: string, explicitImageMode: boolean, reference: boolean): boolean {
  if (explicitImageMode) return true;
  const action=reference?'生成或编辑参考图片':'生成一张新图片';
  return window.confirm(`将${action}，会正常计费。确认继续吗？\n\n本次需求：${prompt}`);
}
