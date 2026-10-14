import assert from 'node:assert/strict';
import {test,before,afterEach} from 'node:test';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
let useConversations:any,createRoot:any,root:any,state:any;
const key=(i:number)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
const conv=(i:number)=>({id:key(i),title:`history ${i}`,createdAt:1,updatedAt:100-i,messages:[]});
const view=(i:number)=>({id:key(i),revision:1,deleted:false,snapshot:conv(i)});
const response=(body:any,status=200)=>Response.json(body,{status});
const flush=()=>act(async()=>{await new Promise(done=>setTimeout(done,35));});
before(async()=>{
 const dom=new JSDOM('<body/>',{url:'http://localhost'});
 for(const name of ['window','document','HTMLElement','localStorage','sessionStorage','Event'])globalThis[name]=dom.window[name];
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 ({createRoot}=await import('react-dom/client'));({useConversations}=await import('../src/hooks/useConversations'));
});
afterEach(()=>{if(root)act(()=>root.unmount());root=null;localStorage.clear();});
function Harness({scope='owner'}){state=useConversations({settings:{baseUrl:'',theme:'light'},accountScope:scope,notify:()=>{},openSettings:()=>{}});return null;}
function mount(){root=createRoot(document.createElement('div'));act(()=>root.render(<Harness/>));}
function backend(override?:(path:string,init:any)=>Promise<Response|undefined>|Response|undefined) {
 const calls:any[]=[];globalThis.fetch=async(url:any,init:any={})=>{
  const path=String(url);calls.push({path,method:init.method??'GET'});
  const custom=await override?.(path,init);if(custom)return custom;
  if(path.startsWith('/api/conversations?')) {
   const offset=Number(new URL(path,'http://localhost').searchParams.get('cursor')??0);
   return response({items:Array.from({length:Math.min(20,45-offset)},(_,i)=>({id:key(offset+i),revision:1,deleted:false})),nextCursor:offset+20<45?String(offset+20):null});
  }
  if(path.startsWith('/api/conversations/')&&init.method==='PUT') {const write=JSON.parse(init.body);return response({...write,id:path.split('/').at(-1),revision:write.expectedRevision+1});}
  if(path.startsWith('/api/conversations/')) {const i=Number(path.split('-').at(-1));return response(view(i));}
  return response([]);
 };return calls;
}
test('hook shows 20 recent conversations and more appends without duplicates',async()=>{
 const calls=backend();mount();await flush();await flush();assert.equal(state.visibleConversations.length,20);assert.equal(state.hasMoreHistory,true);
 await act(async()=>{await Promise.all([state.loadEarlier(),state.loadEarlier()]);});
 assert.equal(state.visibleConversations.length,40);assert.equal(new Set(state.visibleConversations.map(c=>c.id)).size,40);
 assert.equal(calls.filter(c=>c.path.includes('cursor=20')).length,1);
 await act(async()=>{await state.loadEarlier();});assert.equal(state.visibleConversations.length,45);assert.equal(state.hasMoreHistory,false);
});
test('a failed more page preserves visible history and retries the cursor',async()=>{
 let fail=true;backend(path=>path.includes('cursor=20')&&fail?(fail=false,response({message:'offline'},503)):undefined);
 mount();await flush();await flush();await act(async()=>{await state.loadEarlier();});
 assert.equal(state.visibleConversations.length,20);assert.match(state.syncError,/offline/);
 await act(async()=>{await state.loadEarlier();});assert.equal(state.visibleConversations.length,40);assert.equal(state.syncError,'');
});
test('switching owner while more is pending fences the late page and preserves the next account',async()=>{
 let finish:any;backend(path=>path.includes('cursor=20')?new Promise(done=>finish=()=>done(response({items:[{id:key(20),revision:1,deleted:false}],nextCursor:null}))):undefined);
 mount();await flush();await flush();let pending:any;act(()=>{pending=state.loadEarlier();});await flush();
 act(()=>root.render(<Harness scope="guest"/>));await flush();await act(async()=>{finish();await pending;});await flush();
 assert.equal(state.conversations.length,0);assert.equal(state.visibleConversations.length,0);assert.equal(state.historyLoading,false);
});
test('selected older cloud conversation restores even when it is outside the recent page',async()=>{
 localStorage.setItem('travel-agent.activeSessionId.v1.owner',key(40));const calls=backend();mount();await flush();await flush();
 assert.equal(state.activeId,key(40));assert.equal(state.visibleConversations.length,21);assert.ok(state.visibleConversations.some(c=>c.id===key(40)));
 assert.equal(calls.filter(c=>c.path.startsWith('/api/conversations/')&&c.method==='GET').length,21);
 assert.ok(calls.every(c=>c.method==='GET'));
});
test('initial network failure is explicitly retryable without a reload or generation POST',async()=>{
 let fail=true;const calls=backend(path=>path.startsWith('/api/conversations?')&&fail?(fail=false,response({message:'network down'},503)):undefined);
 mount();await flush();assert.match(state.syncError,/network down/);
 await act(async()=>{await state.retryCloudSync();});assert.equal(state.visibleConversations.length,20);assert.equal(state.syncError,'');
 assert.ok(calls.every(c=>c.method==='GET'));
});
test('selecting an older newly loaded conversation resumes only its existing execution receipt',async()=>{
 const execution={executionId:'old-execution',requestId:'stable-request',type:'CHAT',status:'RUNNING',version:1,lastSeq:1,question:'old',answer:'partial',sources:[],error:null,roundsUsed:1,roundLimit:4,tokensUsed:1,toolCalls:0};
 const calls=backend(path=>path===`/api/conversations/${key(30)}`?response({...view(30),snapshot:{...conv(30),messages:[{id:'old-message',role:'assistant',content:'partial',createdAt:1,status:'streaming',execution}]}}):path==='/api/agent-executions/old-execution'?response({...execution,status:'COMPLETED',lastSeq:2,answer:'old final'}):undefined);
 mount();await flush();await flush();await act(async()=>{await state.loadEarlier();});act(()=>state.select(key(30)));await flush();await flush();
 assert.equal(state.conversations.find(c=>c.id===key(30)).messages[0].content,'old final');
 assert.ok(calls.some(c=>c.path==='/api/agent-executions/old-execution'));assert.ok(calls.every(c=>c.method==='GET'));
});
test('the App signed-out scope never queries cloud history before authentication completes',async()=>{
 const calls=backend();root=createRoot(document.createElement('div'));act(()=>root.render(<Harness scope=":guest"/>));await flush();await flush();
 assert.equal(calls.filter(call=>call.path.startsWith('/api/conversations')).length,0);assert.equal(state.conversations.length,0);
});


test('quota failure installing an older page never turns that page into cloud deletions',async()=>{
 let tombstones=0;backend((path,init)=>{if(path.startsWith('/api/conversations/')&&init.method==='PUT'&&JSON.parse(init.body).deleted)tombstones++;return undefined;});
 mount();await flush();await flush();const proto=Object.getPrototypeOf(localStorage),original=proto.setItem;
 proto.setItem=function(key:string,value:string){if(key.startsWith('travel-agent.conversations.'))throw new DOMException('quota','QuotaExceededError');return original.call(this,key,value);};
 try {
  await act(async()=>{await state.loadEarlier();});
  await act(async()=>{await state.retryCloudSync();});
  assert.equal(tombstones,0);assert.equal(state.conversations.length,40);
 }finally {proto.setItem=original;}
});
