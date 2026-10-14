import { apiRequest } from '../lib/http';
import type { PromptEntry } from '../lib/promptLibrary';
export interface VisualPromptPage {items:PromptEntry[];nextCursor:string|null;}
export async function fetchVisualPrompts(baseUrl:string,q:string,cursor:string|null,signal:AbortSignal):Promise<VisualPromptPage> {
  const params=new URLSearchParams({q:q.trim().slice(0,160),limit:'24'});if(cursor)params.set('cursor',cursor);
  const page=await apiRequest<VisualPromptPage>(baseUrl,`/api/settings/visual-memory/prompts?${params}`,{signal,cache:'no-store'});
  if(!page||!Array.isArray(page.items)||page.items.length>24||page.nextCursor!==null&&typeof page.nextCursor!=='string'
    ||page.items.some(item=>!item||typeof item.id!=='string'||!item.id.startsWith('memory:')||typeof item.content!=='string'||typeof item.title!=='string'||item.source!=='visual-memory'||item.category!=='visual-memory'))throw Error('视觉记忆暂时无法读取，请重试');
  if(cursor&&page.nextCursor===cursor)throw Error('视觉记忆分页未前进，请重新打开');
  return page;
}
