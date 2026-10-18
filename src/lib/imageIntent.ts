import { apiRequest } from './http';

/** No automatic retry: classification may have consumed tokens before a lost response. */
export async function classifyImageIntent(base: string, question: string, signal?: AbortSignal): Promise<'GENERATE'|'REMIX'|'DESCRIBE'> {
  const result=await apiRequest<{intent?:unknown}>(base,'/api/chat/image-intent',{
    method:'POST',body:JSON.stringify({question}),signal,
  });
  if(result?.intent!=='GENERATE'&&result?.intent!=='REMIX'&&result?.intent!=='DESCRIBE')
    throw new Error('暂时无法明确图片意图，请明确描述要编辑的内容，或选择图片生成模式。');
  return result.intent;
}
