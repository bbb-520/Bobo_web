import type { Conversation } from '../types';
import { apiRequest } from './http';

export interface SnapshotView { id:string; revision:number; deleted:boolean; snapshot:Conversation|null; }
export interface SnapshotIndex { id:string; revision:number; deleted:boolean; }
interface Write { expectedRevision:number; deleted:boolean; snapshot:Conversation|null; }
interface Remote {
  list(offset:number,signal?:AbortSignal):Promise<SnapshotIndex[]>;
  get(id:string,signal?:AbortSignal):Promise<SnapshotView>;
  put(id:string,request:Write,signal?:AbortSignal):Promise<SnapshotView>;
}

/** Strip short-lived URLs everywhere, including imageRequest.attachments. User text is untouched. */
export function durableSnapshot(conversation:Conversation):Conversation {
  return JSON.parse(JSON.stringify(conversation,(key,value)=>['previewUrl','imageUrl','zineResult'].includes(key)?undefined:value));
}
export function mergeSnapshots(local:Conversation[],remote:SnapshotView[]):Conversation[] {
  const byId=new Map(local.map(c=>[c.id,c]));
  for(const item of remote) {
    if(item.deleted) {byId.delete(item.id);continue;}
    if(!item.snapshot)continue;
    const current=byId.get(item.id);
    if(!current || item.snapshot.updatedAt>current.updatedAt)byId.set(item.id,item.snapshot);
  }
  return [...byId.values()].sort((a,b)=>b.updatedAt-a.updatedAt);
}

/** Optimistic writes serialize per client. A conflict is surfaced; no stale-version force overwrite. */
export class ConversationSync {
  private known=new Map<string,{revision:number;deleted:boolean;json:string}>();
  private ready=false;
  private queue:Promise<void>=Promise.resolve();
  constructor(private remote:Remote,private signal?:AbortSignal) {}
  async load(local:Conversation[]|(()=>Conversation[])):Promise<Conversation[]> {
    const index:SnapshotIndex[]=[];
    for(let offset=0;offset<10000;offset+=100) {
      this.signal?.throwIfAborted();
      const page=await this.remote.list(offset,this.signal);
      if(!Array.isArray(page)||page.some(row=>typeof row.id!=='string'||!Number.isSafeInteger(row.revision)||typeof row.deleted!=='boolean'))throw Error('会话同步响应无效，本地记录仍保留');
      index.push(...page);if(page.length<100)break;
      if(offset===9900)throw Error('会话过多，请联系管理员导出后归档');
    }
    const views:SnapshotView[]=[];
    for(let offset=0;offset<index.length;offset+=4) {
      const batch=await Promise.all(index.slice(offset,offset+4).map(row=>row.deleted?Promise.resolve({...row,snapshot:null}):this.remote.get(row.id,this.signal)));
      views.push(...batch);
    }
    this.signal?.throwIfAborted();
    for(const view of views) {
      if(!view.deleted && (!view.snapshot||view.snapshot.id!==view.id||!Array.isArray(view.snapshot.messages)))throw Error('会话快照无效，本地记录仍保留');
      this.known.set(view.id,{revision:view.revision,deleted:view.deleted,json:JSON.stringify(view.snapshot&&durableSnapshot(view.snapshot))});
    }
    this.ready=true;
    return mergeSnapshots(typeof local==='function'?local():local,views);
  }
  save(conversations:Conversation[]):Promise<void> {
    const snapshot=conversations.map(durableSnapshot);
    const next=this.queue.catch(()=>{}).then(async()=>{
      this.signal?.throwIfAborted();if(!this.ready)return;
      const live=new Set(snapshot.map(c=>c.id));
      for(const conversation of snapshot) {
        this.signal?.throwIfAborted();
        const previous=this.known.get(conversation.id),json=JSON.stringify(conversation);
        if(previous?.deleted||previous?.json===json)continue;
        const saved=await this.remote.put(conversation.id,{expectedRevision:previous?.revision??0,deleted:false,snapshot:conversation},this.signal);
        this.known.set(conversation.id,{revision:saved.revision,deleted:false,json});
      }
      for(const [id,previous] of this.known) {
        this.signal?.throwIfAborted();
        if(live.has(id)||previous.deleted)continue;
        const saved=await this.remote.put(id,{expectedRevision:previous.revision,deleted:true,snapshot:null},this.signal);
        this.known.set(id,{revision:saved.revision,deleted:true,json:'null'});
      }
    });
    this.queue=next;return next;
  }
}

export function conversationRemote(baseUrl:string):Remote {
  return {
    list:(offset,signal)=>apiRequest(baseUrl,`/api/conversations?offset=${offset}&limit=100`,{signal}),
    get:(id,signal)=>apiRequest(baseUrl,`/api/conversations/${encodeURIComponent(id)}`,{signal}),
    put:(id,request,signal)=>apiRequest(baseUrl,`/api/conversations/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(request),signal}),
  };
}
