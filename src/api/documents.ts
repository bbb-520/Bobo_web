import { apiUrl, csrfFetch, csrfHeaders } from '../lib/http';
import { ExecutionApiError, jsonRequest, type Source } from './executions';
export interface DocumentView { documentId:string; filename:string; status:string; indexStatus:string; summaryStatus:string; chunkCount:number; completedChunks:number; error:string|null; indexVersion:number; updatedAt:string; }
export interface DocumentSummary {status:string;text:string;coverage:unknown;}
export interface DocumentConversation {conversationId:string;documentIds:string[];indexVersions:Record<string,number>|number[];history?:unknown[];}
export async function uploadDocument(file:File,requestId:string,baseUrl:string,signal?:AbortSignal,onProgress?:(percent:number)=>void):Promise<DocumentView> {
  if(file.size>100*1024*1024)throw new Error('文件超过 100 MiB 限制');
  if(!file.size)throw new Error('请选择有内容的文档');
  const body=new FormData();body.append('file',file,file.name);
  if(onProgress&&typeof XMLHttpRequest!=='undefined') {
    const headers=await csrfHeaders(baseUrl,{'X-Request-ID':requestId},signal);
    return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();const abort=()=>xhr.abort();
    xhr.open('POST',apiUrl('/api/documents',baseUrl));xhr.timeout=120000;xhr.withCredentials=true;headers.forEach((value,key)=>xhr.setRequestHeader(key,value));
    xhr.upload.onprogress=event=>{if(event.lengthComputable)onProgress(Math.min(100,Math.round(event.loaded/event.total*100)));};
    xhr.onload=()=>{try{const value=JSON.parse(xhr.responseText);if(xhr.status<200||xhr.status>=300)reject(new ExecutionApiError(value.message||value.error||`上传失败（HTTP ${xhr.status}）`,xhr.status));else resolve(value);}catch{reject(new Error('上传结果暂时无法读取，请刷新文档列表'));}};
    xhr.onerror=()=>reject(new Error('上传连接中断，请刷新文档列表后重试'));
    xhr.ontimeout=()=>reject(new Error('文档上传超时，请检查网络后重试'));
    xhr.onabort=()=>reject(new DOMException('上传已取消','AbortError'));
    xhr.onloadend=()=>signal?.removeEventListener('abort',abort);
    if(signal?.aborted){reject(new DOMException('上传已取消','AbortError'));return;}
    signal?.addEventListener('abort',abort,{once:true});xhr.send(body);
    });
  }
  const response=await csrfFetch(baseUrl, '/api/documents',{method:'POST',body,credentials:'include',signal,headers:{'X-Request-ID':requestId}});
  const value=await response.json().catch(()=>({}));
  if(!response.ok)throw new ExecutionApiError(value.message||value.error||`上传失败（HTTP ${response.status}）`,response.status);
  return value as DocumentView;
}
export function documentApi(baseUrl:string) {
  const path=(id:string)=>`/api/documents/${encodeURIComponent(id)}`;
  return {
    list:(signal?:AbortSignal)=>jsonRequest<DocumentView[]>('/api/documents',baseUrl,{signal}),
    get:(id:string,signal?:AbortSignal)=>jsonRequest<DocumentView>(path(id),baseUrl,{signal}),
    remove:(id:string,signal?:AbortSignal)=>jsonRequest<void>(path(id),baseUrl,{method:'DELETE',signal}),
    retry:(id:string,signal?:AbortSignal)=>jsonRequest<DocumentView>(path(id)+'/retry',baseUrl,{method:'POST',signal}),
    summary:(id:string,signal?:AbortSignal)=>jsonRequest<DocumentSummary>(path(id)+'/summary',baseUrl,{signal}),
    source:(id:string,chunkId:string,signal?:AbortSignal)=>jsonRequest<Source>(path(id)+`/sources/${encodeURIComponent(chunkId)}`,baseUrl,{signal}),
    createConversation:(ids:string[],signal?:AbortSignal)=>jsonRequest<DocumentConversation>('/api/document-conversations',baseUrl,{method:'POST',body:JSON.stringify({documentIds:ids}),signal}),
    conversation:(id:string,signal?:AbortSignal)=>jsonRequest<DocumentConversation>(`/api/document-conversations/${encodeURIComponent(id)}`,baseUrl,{signal}),
  };
}
