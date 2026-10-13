import type { Conversation, ImageJobRef } from '../types';

export type ImageJobResponseAction = 'success' | 'missing' | 'retry';

/** Distinguishes a permanently missing task from a transient backend failure. */
export function imageJobResponseAction(status: number): ImageJobResponseAction {
  if (status === 404) return 'missing';
  if (status >= 200 && status < 300) return 'success';
  return 'retry';
}

export class ImageJobNotFoundError extends Error {
  readonly jobId: string;

  constructor(jobId: string) {
    super(`Image job not found: ${jobId}`);
    this.name = 'ImageJobNotFoundError';
    this.jobId = jobId;
  }
}

/** Reconciles persisted cards with an authoritative successful server response. */
export function reconcileImageJobs(conversation: Conversation, jobs: ImageJobRef[]): Conversation {
  const fresh = new Map(jobs.map((job) => [job.jobId, job]));
  const latestAssistantIndex = conversation.messages.reduce(
    (index, message, current) => message.role === 'assistant' ? current : index,
    -1,
  );
  const assigned=new Set(conversation.messages.flatMap(message=>message.imageJobs??[]).map(job=>job.jobId));
  for(const job of jobs)if(job.requestId&&conversation.messages.some(message=>message.imageRequest?.requestId===job.requestId))assigned.add(job.jobId);

  return {
    ...conversation,
    messages: conversation.messages.map((message, index) => {
      const existing = [...new Map([
        ...(message.imageJobs ?? []).map(job=>fresh.get(job.jobId)).filter((job):job is ImageJobRef=>Boolean(job)),
        ...jobs.filter(job=>job.requestId&&job.requestId===message.imageRequest?.requestId),
      ].map(job=>[job.jobId,job])).values()];
      const received=message.imageRequest&&existing.find(job=>job.requestId===message.imageRequest?.requestId);
      const state=received?{imageRequest:{...message.imageRequest!,state:'accepted' as const},
        status:received.status==='FAILED'?'error' as const:'done' as const,
        content:received.status==='FAILED'?'图片生成未完成。':received.status==='SUCCEEDED'?'图片已生成。':'图片任务已受理，完成后会显示在这里。',
        error:received.status==='FAILED'?received.error??'图片生成失败':undefined,finishedAt:message.finishedAt??Date.now()}:{};
      if (index !== latestAssistantIndex) return { ...message,...state,imageJobs: existing };
      return {
        ...message,
        ...state,
        imageJobs: [...existing, ...jobs.filter((job) => !assigned.has(job.jobId))],
      };
    }),
  };
}
