import type { Conversation } from '../types';
import { apiRequest } from './http';
import { ApiError } from './http';
import { uid } from './storage';

export interface SnapshotView { id:string; revision:number; deleted:boolean; snapshot:Conversation|null; }
export interface SnapshotIndex { id:string; revision:number; deleted:boolean; }
interface Write { expectedRevision:number; deleted:boolean; snapshot:Conversation|null; }
export interface SnapshotPage { items:SnapshotIndex[]; nextCursor:string|null; }
interface Remote {
  page?(cursor?:string,signal?:AbortSignal):Promise<SnapshotPage>;
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

type Known = {revision:number;deleted:boolean;json:string};
export interface SyncRecovery { id:string; local:Conversation|null; remote:SnapshotView; copy?:Conversation; }
interface SyncOptions { storageKey?:string; onRecovered?:(change:SyncRecovery)=>void; }
const encoded=(value:Conversation|null)=>JSON.stringify(value&&durableSnapshot(value));
export function conflictCopy(local:Conversation,id=uid()):Conversation {
  return {...local,id,title:`${local.title.slice(0,235)}（本地冲突副本）`,updatedAt:Date.now(),messages:local.messages.map(message=>({...message,
    ...(message.status==='streaming'?{status:'stopped' as const}:{}),
    ...(message.imageRequest?{imageRequest:{...message.imageRequest,stopRequested:true}}:{}),
  }))};
}
/** Apply authoritative truth without discarding edits made while the network request was pending. */
export function applySyncRecovery(current:Conversation[],change:SyncRecovery):Conversation[] {
  const latest=current.find(item=>item.id===change.id);
  const copy=latest&&encoded(latest)!==encoded(change.local)&&encoded(latest)!==encoded(change.remote.snapshot)?conflictCopy(latest,change.copy?.id):change.copy;
  const byId=new Map(current.filter(item=>item.id!==change.id).map(item=>[item.id,item]));
  if(!change.remote.deleted&&change.remote.snapshot)byId.set(change.id,change.remote.snapshot);
  if(copy)byId.set(copy.id,copy);
  return [...byId.values()].sort((a,b)=>b.updatedAt-a.updatedAt);
}

/** Owner-scoped, partial history. Only loaded records can be inferred deleted. */
export class ConversationSync {
  private known=new Map<string,Known>();
  private loaded=new Set<string>();
  private resolved=new Map<string,string>();
  private ready=false;
  private cacheContents:string|null=null;
  private externalEpoch=new Map<string,number>();
  private queue:Promise<void>=Promise.resolve();
  private cursor:string|null=null;
  private more:Promise<Conversation[]>|null=null;
  hasMore=false;
  isVisible(item:Conversation) {return !this.ready||this.loaded.has(item.id)||this.known.get(item.id)?.json!==encoded(item);}
  constructor(private remote:Remote,private signal?:AbortSignal,private options:SyncOptions={}) {
    try {
      const cache=JSON.parse(localStorage.getItem(options.storageKey??'')??'null');
      const rows=cache?.rows;this.cacheContents=typeof cache?.contents==='string'?cache.contents:null;
      if(Array.isArray(rows))for(const [id,row] of rows)if(typeof id==='string'&&Number.isSafeInteger(row?.revision)&&typeof row?.json==='string')this.known.set(id,row);
    }catch {/* Missing/corrupt baselines conservatively preserve divergent local work as a copy. */}
  }
  private exclusive<T>(operation:()=>Promise<T>):Promise<T> {
    const next=this.queue.catch(()=>{}).then(operation);
    this.queue=next.then(()=>{},()=>{});return next;
  }
  /** Call only after the corresponding conversation cache has been persisted. */
  checkpoint(local:Conversation[]) {
    if(!this.options.storageKey)return;
    localStorage.setItem(this.options.storageKey,JSON.stringify({rows:[...this.known],contents:JSON.stringify(local.map(durableSnapshot))}));
  }
  private remember(view:SnapshotView,external=false) {
    if(external&&this.known.get(view.id)?.revision!==view.revision)this.externalEpoch.set(view.id,(this.externalEpoch.get(view.id)??0)+1);
    this.known.set(view.id,{revision:view.revision,deleted:view.deleted,json:encoded(view.snapshot)});
  }
  private validate(view:SnapshotView) {
    if(!view||typeof view.id!=='string'||!Number.isSafeInteger(view.revision)||typeof view.deleted!=='boolean'||!view.deleted&&(!view.snapshot||view.snapshot.id!==view.id||!Array.isArray(view.snapshot.messages)))throw Error('会话快照无效，本地记录仍保留');
  }
  private async fetchPage(cursor?:string):Promise<SnapshotPage> {
    this.signal?.throwIfAborted();
    const page=this.remote.page?await this.remote.page(cursor,this.signal):{items:await this.remote.list(Number(cursor??0),this.signal),nextCursor:null};
    this.signal?.throwIfAborted();
    if(!page||!Array.isArray(page.items)||page.items.length>20||page.items.some(row=>typeof row.id!=='string'||!Number.isSafeInteger(row.revision)||typeof row.deleted!=='boolean')||page.nextCursor!==null&&typeof page.nextCursor!=='string')throw Error('会话分页响应无效，本地记录仍保留');
    if(cursor&&page.nextCursor===cursor)throw Error('会话分页游标未前进，请重试');
    return page;
  }
  private async views(index:SnapshotIndex[]):Promise<SnapshotView[]> {
    const views:SnapshotView[]=[];
    for(let offset=0;offset<index.length;offset+=4) {
      const batch=await Promise.all(index.slice(offset,offset+4).map(row=>row.deleted?Promise.resolve({...row,snapshot:null}):this.remote.get(row.id,this.signal)));
      for(const view of batch){this.signal?.throwIfAborted();this.validate(view);views.push(view);}
    }
    return views;
  }
  private merge(local:Conversation[],views:SnapshotView[]):Conversation[] {
    const byId=new Map(local.map(item=>[item.id,item]));
    for(const view of views) {
      const before=this.known.get(view.id),current=byId.get(view.id);
      if(before&&view.revision<before.revision)continue;
      const localDirty=current&&encoded(current)!==before?.json,remoteDirty=encoded(view.snapshot)!==before?.json;
      if(current&&encoded(current)!==encoded(view.snapshot)&&localDirty&&remoteDirty) {
        const copy=conflictCopy(current);byId.set(copy.id,copy);
      }
      if(view.deleted)byId.delete(view.id);
      else if(view.snapshot&&(!current||!localDirty||remoteDirty))byId.set(view.id,view.snapshot);
      this.loaded.add(view.id);this.remember(view,true);
    }
    return [...byId.values()].sort((a,b)=>b.updatedAt-a.updatedAt);
  }
  async load(local:Conversation[]|(()=>Conversation[]),options:{activeId?:string|null}={}):Promise<Conversation[]> {
    return this.exclusive(async()=>{
    const getLocal=()=>typeof local==='function'?local():local;
    if(!this.ready&&this.cacheContents!==JSON.stringify(getLocal().map(durableSnapshot)))this.known.clear();
    const page=await this.fetchPage();
    const views=await this.views(page.items);
    const present=new Set(views.map(view=>view.id));
    const extras=new Set(this.remote.page?getLocal().filter(item=>!this.known.has(item.id)||this.known.get(item.id)?.json!==encoded(item)).map(item=>item.id):[]);
    if(options.activeId)extras.add(options.activeId);
    for(const id of extras)if(!present.has(id)) {
      try {const view=await this.remote.get(id,this.signal);this.signal?.throwIfAborted();this.validate(view);views.push(view);}
      catch(error){if(!(error instanceof ApiError)||error.status!==404)throw error;}
    }
    this.signal?.throwIfAborted();
    const merged=this.merge(getLocal(),views);
    this.cursor=page.nextCursor;this.hasMore=page.nextCursor!==null;
    this.ready=true;
    return merged;
    });
  }
  loadMore(local:Conversation[]|(()=>Conversation[])):Promise<Conversation[]> {
    if(this.more)return this.more;
    if(!this.hasMore)return Promise.resolve(typeof local==='function'?local():local);
    const cursor=this.cursor!;
    this.more=this.exclusive(async()=>{
      const page=await this.fetchPage(cursor);const views=await this.views(page.items);
      this.signal?.throwIfAborted();const merged=this.merge(typeof local==='function'?local():local,views);
      this.cursor=page.nextCursor;this.hasMore=page.nextCursor!==null;return merged;
    }).finally(()=>{this.more=null;});
    return this.more;
  }
  private async recover(id:string,local:Conversation|null,baseline?:Known):Promise<void> {
    const remote=await this.remote.get(id,this.signal);this.signal?.throwIfAborted();this.validate(remote);
    const previous=baseline??this.known.get(id);
    const copy=local&&encoded(local)!==previous?.json&&encoded(local)!==encoded(remote.snapshot)?conflictCopy(local):undefined;
    this.options.onRecovered?.({id,local,remote,copy});
    this.remember(remote,true);this.resolved.set(id,encoded(local));
  }
  private async write(id:string,local:Conversation|null,previous?:Known) {
    try {
      const saved=await this.remote.put(id,{expectedRevision:previous?.revision??0,deleted:local===null,snapshot:local},this.signal);
      this.signal?.throwIfAborted();this.validate(saved);this.remember(saved);this.loaded.add(id);this.resolved.delete(id);
    }catch(error) {
      if(error instanceof ApiError&&[409,410].includes(error.status))await this.recover(id,local,previous);
      else throw error;
    }
  }
  save(conversations:Conversation[]):Promise<void> {
    const snapshot=conversations.map(durableSnapshot);
    const baselines=new Map(this.known),epochs=new Map(this.externalEpoch);
    // A delayed save cannot infer removals from pages discovered after it was captured.
    const deletionCandidates=new Map([...this.known].filter(([id])=>this.loaded.has(id)));
    const next=this.exclusive(async()=>{
      this.signal?.throwIfAborted();if(!this.ready)return;
      const live=new Set(snapshot.map(c=>c.id));
      for(const conversation of snapshot) {
        this.signal?.throwIfAborted();
        const current=this.known.get(conversation.id),baseline=baselines.get(conversation.id),json=JSON.stringify(conversation);
        if(baseline?.json===json)continue;
        const previous=epochs.get(conversation.id)===this.externalEpoch.get(conversation.id)?current:baseline;
        if(previous?.deleted||this.resolved.get(conversation.id)===json)continue;
        if(previous?.json===json){this.resolved.delete(conversation.id);continue;}
        if(this.resolved.has(conversation.id)){await this.recover(conversation.id,conversation,previous);continue;}
        await this.write(conversation.id,conversation,previous);
      }
      for(const [id,previous] of this.known) {
        this.signal?.throwIfAborted();
        if(deletionCandidates.get(id)?.revision!==previous.revision||live.has(id)||previous.deleted||this.resolved.get(id)==='null')continue;
        await this.write(id,null,previous);
      }
    });
    return next;
  }
}

export function conversationRemote(baseUrl:string):Remote {
  return {
    page:async(cursor,signal)=>{
      const result=await apiRequest<SnapshotPage|SnapshotIndex[]>(baseUrl,`/api/conversations?recent=true&limit=20${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,{signal});
      // Older test fixtures and old servers return an index array; one page stays bounded.
      return Array.isArray(result)?{items:result.slice(0,20),nextCursor:null}:result;
    },
    list:(offset,signal)=>apiRequest(baseUrl,`/api/conversations?offset=${offset}&limit=100`,{signal}),
    get:(id,signal)=>apiRequest(baseUrl,`/api/conversations/${encodeURIComponent(id)}`,{signal}),
    put:(id,request,signal)=>apiRequest(baseUrl,`/api/conversations/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(request),signal}),
  };
}
