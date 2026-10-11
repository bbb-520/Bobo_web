import { apiUrl, csrfFetch } from '../lib/http';
import { readModelStatus, type ModelStatus } from '../lib/modelStatus';

export interface Source { id:string; documentId:string; chunkId:string; title:string; page:number|null; excerpt:string; }
export type ExecutionStatus = 'QUEUED'|'RUNNING'|'STOPPING'|'COMPLETED'|'FAILED'|'STOPPED'|'WAITING_FOR_BUDGET'|'WAITING_FOR_RECONCILIATION'|'NEEDS_INPUT';
export interface ExecutionRequest { requestId:string; type:'CHAT'|'DOCUMENT_QA'|'AGENT'; question:string; conversationId?:string; documentConversationId?:string; }
export interface ExecutionView {
  executionId:string; requestId:string; type:ExecutionRequest['type']; status:ExecutionStatus;
  version:number; lastSeq:number; question:string; answer:string; sources:Source[]; error:string|null;
  roundsUsed:number; roundLimit:number; tokensUsed:number; toolCalls:number; reservedTokens?:number;
  generationVersion?:number; progress?:string; fallback?:boolean; evaluation?:string;
  modelStatus?:ModelStatus;
}
export interface ExecutionEvent { executionId:string; seq:number; type:string; generationVersion:number; payload:Record<string,unknown>; }
export const TERMINAL_STATUSES = new Set<ExecutionStatus>(['COMPLETED','FAILED','STOPPED','WAITING_FOR_BUDGET','WAITING_FOR_RECONCILIATION','NEEDS_INPUT']);
export const isExecutionActive = (value:ExecutionView) => !TERMINAL_STATUSES.has(value.status);

/** Whole SSE frames are decoded, rather than parsing individual data lines. */
export class SseParser {
  private buffer=''; private data:string[]=[]; private event='message'; private id='';
  constructor(private dispatch:(frame:{id:string;event:string;data:string})=>void) {}
  push(chunk:string) {
    this.buffer+=chunk;
    let newline:number;
    while((newline=this.buffer.indexOf('\n'))>=0) {
      const line=this.buffer.slice(0,newline).replace(/\r$/,'');
      this.buffer=this.buffer.slice(newline+1); this.line(line);
    }
  }
  finish() { if(this.buffer) this.line(this.buffer.replace(/\r$/,'')); this.buffer=''; this.line(''); }
  private line(line:string) {
    if(!line) {
      if(this.data.length) this.dispatch({id:this.id,event:this.event,data:this.data.join('\n')});
      this.data=[]; this.event='message'; this.id=''; return;
    }
    if(line.startsWith(':')) return;
    const colon=line.indexOf(':');
    const key=colon<0?line:line.slice(0,colon);
    const value=colon<0?'':line.slice(colon+1).replace(/^ /,'');
    if(key==='data') this.data.push(value);
    else if(key==='event') this.event=value;
    else if(key==='id'&&!value.includes('\0')) this.id=value;
  }
}

export function applyExecutionEvent(state:ExecutionView,event:ExecutionEvent):ExecutionView {
  if(event.executionId!==state.executionId || !Number.isSafeInteger(event.seq) || event.seq<=state.lastSeq) return state;
  const generation=state.generationVersion??1;
  // Consume old events' cursor, but never their answer, sources or status.
  if(event.generationVersion<generation) return {...state,lastSeq:event.seq};
  const next={...state,lastSeq:event.seq,generationVersion:event.generationVersion};
  const p=event.payload;
  switch(event.type) {
    case 'model_status': {
      const modelStatus=readModelStatus(p);
      return modelStatus?{...next,modelStatus:{...modelStatus,generationVersion:event.generationVersion},fallback:modelStatus.fallback}:next;
    }
    case 'answer_delta': return {...next,answer:(event.generationVersion>generation?'':state.answer)+(typeof p.text==='string'?p.text:'')};
    case 'answer_replace': return {...next,answer:typeof p.text==='string'?p.text:'',sources:[],evaluation:undefined};
    case 'answer_committed': return {...next,answer:typeof p.text==='string'?p.text:next.answer,sources:Array.isArray(p.sources)?p.sources as Source[]:next.sources,evaluation:typeof p.evaluation==='string'?p.evaluation:undefined};
    case 'sources': return {...next,sources:Array.isArray(p.sources)?p.sources as Source[]:next.sources};
    case 'fallback_started': return {...next,fallback:true,progress:typeof p.message==='string'?p.message:'正在切换备用模型'};
    case 'progress': return {...next,progress:typeof p.message==='string'?p.message:typeof p.stage==='string'?p.stage:next.progress};
    case 'evaluation': return {...next,evaluation:typeof p.status==='string'?p.status:next.evaluation};
    case 'status': return {...next,status:typeof p.status==='string'?p.status as ExecutionStatus:next.status,error:typeof p.error==='string'?p.error:null};
    default: return next;
  }
}
export function mergeExecutionSnapshot(current:ExecutionView,snapshot:ExecutionView):ExecutionView {
  if(current.executionId!==snapshot.executionId || snapshot.lastSeq<current.lastSeq || snapshot.version<current.version) return current;
  const newGeneration=(snapshot.generationVersion??1)>(current.generationVersion??1);
  const modelStatus=Object.prototype.hasOwnProperty.call(snapshot,'modelStatus')?readModelStatus(snapshot.modelStatus):newGeneration?undefined:current.modelStatus;
  return {...current,...snapshot,modelStatus,fallback:modelStatus?.fallback??snapshot.fallback??(newGeneration?false:current.fallback),generationVersion:Math.max(current.generationVersion??1,snapshot.generationVersion??1)};
}
export class ExecutionApiError extends Error {
  constructor(message:string,readonly status:number) {super(message);this.name='ExecutionApiError';}
}
export async function jsonRequest<T>(path:string,baseUrl:string,init:RequestInit={}):Promise<T> {
  const response=await csrfFetch(baseUrl, path,{...init,credentials:'include',headers:{...(init.body?{'Content-Type':'application/json'}:{}),...init.headers}});
  if(!response.ok) {
    const body=await response.json().catch(()=>({}));
    throw new ExecutionApiError(body.message||body.detail||body.error||`请求失败（HTTP ${response.status}）`,response.status);
  }
  if(response.status===204) return undefined as T;
  return response.json() as Promise<T>;
}
export function executionApi(baseUrl:string) {
  const path=(id:string)=>`/api/agent-executions/${encodeURIComponent(id)}`;
  return {
    create:(request:ExecutionRequest,signal?:AbortSignal)=>jsonRequest<ExecutionView>('/api/agent-executions',baseUrl,{method:'POST',body:JSON.stringify(request),signal}),
    find:(requestId:string,signal?:AbortSignal)=>jsonRequest<ExecutionView>(`/api/agent-executions?requestId=${encodeURIComponent(requestId)}`,baseUrl,{signal}),
    get:(id:string,signal?:AbortSignal)=>jsonRequest<ExecutionView>(path(id),baseUrl,{signal}),
    stop:(id:string,signal?:AbortSignal)=>jsonRequest<ExecutionView>(path(id)+'/stop',baseUrl,{method:'POST',signal}),
    resume:(id:string,request:{requestId:string;expectedVersion:number;additionalRounds?:number;instruction?:string},signal?:AbortSignal)=>jsonRequest<ExecutionView>(path(id)+'/resume',baseUrl,{method:'POST',body:JSON.stringify(request),signal}),
    async subscribe(id:string,lastSeq:number,signal:AbortSignal,onEvent:(event:ExecutionEvent)=>void) {
      const controller=new AbortController();
      const abort=()=>controller.abort();
      if(signal.aborted) controller.abort(); else signal.addEventListener('abort',abort,{once:true});
      let timer:ReturnType<typeof setTimeout>;
      const touch=()=>{clearTimeout(timer);timer=setTimeout(abort,65000);};
      let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
      try {
        touch();
        const response=await csrfFetch(baseUrl, path(id)+'/events',{credentials:'include',headers:{Accept:'text/event-stream','Last-Event-ID':`${id}:${lastSeq}`},signal:controller.signal});
        if(!response.ok) throw new ExecutionApiError(`事件连接失败（HTTP ${response.status}）`,response.status);
        if(!response.body) throw new Error('浏览器不支持流式响应');
        const parser=new SseParser(frame=>{
          const event=JSON.parse(frame.data) as ExecutionEvent;
          if(frame.id!==`${id}:${event.seq}`||event.executionId!==id||typeof event.type!=='string'||!Number.isInteger(event.generationVersion)||!event.payload||typeof event.payload!=='object') throw new Error('事件数据与执行不匹配，请重新同步');
          onEvent(event);
        });
        reader=response.body.getReader(); const decoder=new TextDecoder();
        while(!signal.aborted) { const {done,value}=await reader.read(); if(done)break; touch(); parser.push(decoder.decode(value,{stream:true})); }
        parser.push(decoder.decode()); parser.finish();
      } finally {clearTimeout(timer!);signal.removeEventListener('abort',abort);await reader?.cancel().catch(()=>{});}
    },
  };
}
