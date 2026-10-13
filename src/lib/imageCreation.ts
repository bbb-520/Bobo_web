import type { ImageAttachment, ImageJobRef } from '../types';
import { apiRequest } from './http';

export interface ImageCreationRequest {
  requestId: string;
  conversationId: string;
  prompt: string;
  attachments?: ImageAttachment[];
}
export const imageCreationApi = (base: string) => ({
  create: (request: ImageCreationRequest, signal?: AbortSignal) => apiRequest<ImageJobRef>(base, '/api/image-jobs', {method:'POST', body:JSON.stringify(request), signal}),
  byRequest: (requestId: string, signal?: AbortSignal) => apiRequest<ImageJobRef>(base, `/api/image-jobs/by-request/${encodeURIComponent(requestId)}`, {signal}),
});
