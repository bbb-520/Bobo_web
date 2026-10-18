import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConversationSync,applySyncRecovery } from '../src/lib/conversationSync';
import { ApiError } from '../src/lib/http';
const conv=(id:string,n=1)=>({id,title:id,createdAt:1,updatedAt:n,messages:[]});
const view=(id:string,n=1)=>({id,revision:n,deleted:false,snapshot:conv(id,n)});
function fixture() {
 const data=Array.from({length:45},(_,i)=>view(`c${i}`,100-i));const calls:any[]=[];
 const remote={page:async(cursor?:string)=>{calls.push(['page',cursor]);const offset=Number(cursor??0);return {items:data.slice(offset,offset+20).map(({snapshot,...row})=>row),nextCursor:offset+20<data.length?String(offset+20):null};},
 list:async()=>{throw Error('legacy full scan');},get:async(id:string)=>{calls.push(['get',id]);return data.find(row=>row.id===id)!;},
 put:async(id:string,body:any)=>{calls.push(['put',id,body]);return {...body,id,revision:body.expectedRevision+1};}};
 return {data,calls,remote};
}
test('initial history loads only 20, retains active older ID and never deletes unloaded cloud history',async()=>{
 const {remote,calls}=fixture();const sync:any=new ConversationSync(remote);
 let local=await sync.load([],{activeId:'c40'});assert.equal(local.length,21);assert.ok(local.some(c=>c.id==='c40'));
 assert.equal(calls.filter(c=>c[0]==='get').length,21);assert.equal(sync.hasMore,true);
 await sync.save(local);assert.equal(calls.filter(c=>c[0]==='put').length,0);
 local=await sync.loadMore(()=>local);assert.equal(local.length,41);
 local=await sync.loadMore(()=>local);assert.equal(local.length,45);assert.equal(sync.hasMore,false);
 assert.equal(new Set(local.map(c=>c.id)).size,45);
});
test('concurrent more clicks share one page and a failed page can retry the same cursor',async()=>{
 const {remote,calls}=fixture();const sync:any=new ConversationSync(remote);let local=await sync.load([]);
 let release:any;let fail=true;remote.page=async(cursor)=>{calls.push(['more',cursor]);await new Promise(done=>release=done);if(fail)throw Error('offline');return {items:[{id:'c20',revision:80,deleted:false}],nextCursor:null};};
 const first=sync.loadMore(()=>local),second=sync.loadMore(()=>local);await new Promise(done=>setTimeout(done,0));release();
 await assert.rejects(first,/offline/);await assert.rejects(second,/offline/);assert.equal(calls.filter(c=>c[0]==='more').length,1);
 fail=false;const retry=sync.loadMore(()=>local);await new Promise(done=>setTimeout(done,0));release();local=await retry;assert.equal(local.length,21);
 assert.deepEqual(calls.filter(c=>c[0]==='more').map(c=>c[1]),['20','20']);
});
test('account abort fences late page responses and all subsequent writes',async()=>{
 const {remote,calls}=fixture();const abort=new AbortController();const sync:any=new ConversationSync(remote,abort.signal);let local=await sync.load([]);
 let finish:any;remote.page=async()=>new Promise(done=>finish=done);const pending=sync.loadMore(()=>local);await new Promise(done=>setTimeout(done,0));abort.abort();finish({items:[],nextCursor:null});
 await assert.rejects(pending);await assert.rejects(sync.save(local));assert.equal(calls.filter(c=>c[0]==='put').length,0);
});
test('CAS conflict keeps cloud and forks locally edited work instead of overwriting or pausing forever',async()=>{
 const changes:any[]=[];const {remote,data}=fixture();const sync:any=new ConversationSync(remote,undefined,{onRecovered:(change:any)=>changes.push(change)});
 await sync.load([]);const local={...conv('c0',200),title:'local edit'};data[0]={...view('c0',201),snapshot:{...conv('c0',201),title:'cloud edit'}};
 let writes=0;remote.put=async()=>{writes++;throw new ApiError('conflict',409);};
 await sync.save([local,...data.slice(1,20).map(row=>row.snapshot)]);
 assert.equal(changes.length,1);assert.equal(changes[0].remote.snapshot.title,'cloud edit');assert.equal(changes[0].copy.title.includes('local edit'),true);assert.notEqual(changes[0].copy.id,'c0');
 await sync.save([local,...data.slice(1,20).map(row=>row.snapshot)]);assert.equal(changes.length,1);assert.equal(writes,1);
});
test('a cloud tombstone never revives the original ID while an edited local copy is preserved',async()=>{
 const changes:any[]=[];const {remote,data}=fixture();const sync:any=new ConversationSync(remote,undefined,{onRecovered:(change:any)=>changes.push(change)});await sync.load([]);
 data[0]={id:'c0',revision:300,deleted:true,snapshot:null} as any;remote.put=async()=>{throw new ApiError('deleted',410);};
 await sync.save([{...conv('c0',400),title:'unsynced'},...data.slice(1,20).map(row=>row.snapshot)]);
 assert.equal(changes[0].remote.deleted,true);assert.notEqual(changes[0].copy.id,'c0');assert.match(changes[0].copy.title,/unsynced/);
});
test('an unchanged local version adopts remote edits without making an unnecessary copy',async()=>{
 const changes:any[]=[];const {remote,data}=fixture();const sync:any=new ConversationSync(remote,undefined,{onRecovered:(change:any)=>changes.push(change)});await sync.load([]);
 remote.put=async()=>{throw new ApiError('conflict',409);};data[0]=view('c0',301);
 await sync.save(data.slice(1,20).map(row=>row.snapshot));
 assert.equal(changes[0].remote.revision,301);assert.equal(changes[0].copy,undefined);
});
test('a save captured before a page arrives must never tombstone that newly loaded page',async()=>{
 const {remote,calls}=fixture();const sync:any=new ConversationSync(remote);let local=await sync.load([]);
 let release:any;remote.put=async(id,body)=>{calls.push(['put',id,body]);if(!body.deleted)await new Promise(done=>release=done);return {...body,id,revision:body.expectedRevision+1};};
 const saving=sync.save(local.map(item=>item.id==='c0'?{...item,title:'edited'}:item));await new Promise(done=>setTimeout(done,0));
 const loading=sync.loadMore(()=>local);release();await saving;local=await loading;
 assert.equal(calls.filter(call=>call[0]==='put'&&call[2].deleted).length,0);
});
test('recovery keeps newer edits made during a conflict fetch and disables uncertain image replay in copies',()=>{
 const local={...conv('c0'),messages:[{id:'m',role:'assistant' as const,content:'local',createdAt:1,imageRequest:{requestId:'stable',conversationId:'c0',prompt:'image',state:'submitting' as const}}]};
 const current={...local,title:'edit while waiting'};
 const result=applySyncRecovery([current],{id:'c0',local,remote:{...view('c0',5),snapshot:{...conv('c0',5),title:'cloud'}},copy:{...local,id:'copy',title:'local copy'}});
 assert.equal(result.find(item=>item.id==='c0')?.title,'cloud');assert.match(result.find(item=>item.id==='copy')!.title,/edit while waiting/);
 assert.equal(result.find(item=>item.id==='copy')!.messages[0].imageRequest?.requestId,'stable');assert.equal(result.find(item=>item.id==='copy')!.messages[0].imageRequest?.stopRequested,true);
});
test('cached synchronized older history is not eagerly fetched or inferred deleted',async()=>{
 const oldStorage=globalThis.localStorage,cache=new Map<string,string>();
 globalThis.localStorage={getItem:key=>cache.get(key)??null,setItem:(key,value)=>cache.set(key,value)} as any;
 try {
  const {remote,calls}=fixture();const first:any=new ConversationSync(remote,undefined,{storageKey:'owner'});let local=await first.load([]);
  while(first.hasMore)local=await first.loadMore(()=>local);
  first.checkpoint(local);
  calls.length=0;const next:any=new ConversationSync(remote,undefined,{storageKey:'owner'});local=await next.load(()=>local);
  assert.equal(calls.filter(call=>call[0]==='get').length,20);assert.equal(local.filter(item=>next.isVisible(item)).length,20);
  await next.save(local);assert.equal(calls.filter(call=>call[0]==='put').length,0);
 }finally {globalThis.localStorage=oldStorage;}
});
test('a conflict copy is uploaded once on the next save while the cloud original remains authoritative',async()=>{
 const {remote,data,calls}=fixture();let local:any[]=[];
 const sync:any=new ConversationSync(remote,undefined,{onRecovered:change=>{local=applySyncRecovery(local,change);}});
 local=await sync.load([]);local=local.map(item=>item.id==='c0'?{...item,title:'local changed'}:item);
 data[0]={...view('c0',500),snapshot:{...conv('c0',500),title:'remote changed'}};
 remote.put=async(id,body)=>{calls.push(['put',id,body]);if(id==='c0')throw new ApiError('conflict',409);return {...body,id,revision:body.expectedRevision+1};};
 await sync.save(local);const copy=local.find(item=>item.id!=='c0'&&item.title.includes('local changed'));
 assert.ok(copy);await sync.save(local);await sync.save(local);
 assert.equal(local.find(item=>item.id==='c0').title,'remote changed');
 assert.equal(calls.filter(call=>call[0]==='put'&&call[1]==='c0').length,1);
 assert.equal(calls.filter(call=>call[0]==='put'&&call[1]===copy.id).length,1);
});


test('late older GET cannot downgrade an already saved revision',async()=>{
 const original={...view('c',1),snapshot:{...conv('c'),title:'original'}};let server=original;let release:any;
 const remote={list:async()=>[],page:async(cursor?:string)=>({items:cursor?[{id:'c',revision:1,deleted:false}]:[],nextCursor:cursor?null:'older'}),
 get:async()=>server,put:async(id:string,body:any)=>{server={id,revision:body.expectedRevision+1,deleted:false,snapshot:body.snapshot};return server;}};
 const sync=new ConversationSync(remote);let local=await sync.load([],{activeId:'c'});
 remote.get=async()=>{const captured=server;await new Promise(done=>release=done);return captured;};
 const loading=sync.loadMore(()=>local);await new Promise(done=>setTimeout(done,0));
 local=[{...local[0],title:'fresh local edit',updatedAt:10}];const saving=sync.save(local);
 await new Promise(done=>setTimeout(done,0));release();local=await loading;await saving;
 assert.equal(local.find(c=>c.id==='c')?.title,'fresh local edit');
 await sync.save(local);assert.equal(server.snapshot.title,'fresh local edit');
});

test('a captured save cannot overwrite cloud changes installed by a concurrent page',async()=>{
 let server=view('c',1);let release:any;let local:any[]=[];
 const remote={list:async()=>[],page:async(cursor?:string)=>({items:cursor?[{id:'c',revision:server.revision,deleted:false}]:[{id:'x',revision:1,deleted:false},{id:'c',revision:1,deleted:false}],nextCursor:cursor?null:'older'}),
 get:async(id:string)=>id==='c'?server:view('x',1),put:async(id:string,body:any)=>{
  if(id==='x')await new Promise(done=>release=done);
  if(id==='c'&&body.expectedRevision!==server.revision)throw new ApiError('conflict',409);
  const value={id,revision:body.expectedRevision+1,deleted:body.deleted,snapshot:body.snapshot};if(id==='c')server=value;return value;
 }};
 const sync=new ConversationSync(remote,undefined,{onRecovered:change=>{local=applySyncRecovery(local,change);}});
 local=await sync.load([]);local=local.map(c=>c.id==='x'?{...c,title:'x edit'}:c);
 const saving=sync.save(local);await new Promise(done=>setTimeout(done,0));
 server={...view('c',2),snapshot:{...conv('c',2),title:'new cloud edit'}};
 const loading=sync.loadMore(()=>local);await new Promise(done=>setTimeout(done,0));release();await saving;local=await loading;
 assert.equal(server.snapshot.title,'new cloud edit');assert.equal(local.find(c=>c.id==='c')?.title,'new cloud edit');
});

test('metadata from a newer cache must not legitimize stale local contents after reload',async()=>{
 const oldStorage=globalThis.localStorage,cache=new Map<string,string>();
 globalThis.localStorage={getItem:key=>cache.get(key)??null,setItem:(key,value)=>cache.set(key,value)} as any;
 try {
  const {remote,data}=fixture();data[0]={...view('c0',500),snapshot:{...conv('c0',500),title:'new cloud'}};
  const first:any=new ConversationSync(remote,undefined,{storageKey:'owner'});const fresh=await first.load([]);first.checkpoint?.(fresh);
  const next=new ConversationSync(remote,undefined,{storageKey:'owner'});const stale=fresh.map(c=>c.id==='c0'?{...conv('c0',1),title:'old cache'}:c);
  const restored=await next.load(stale);await next.save(restored);
  assert.equal(restored.find(c=>c.id==='c0')?.title,'new cloud');assert.ok(restored.some(c=>c.id!=='c0'&&c.title.includes('old cache')));
 }finally {globalThis.localStorage=oldStorage;}
});
