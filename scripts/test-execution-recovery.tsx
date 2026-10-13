import assert from 'node:assert/strict';
import {test,before,afterEach} from 'node:test';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
let createRoot,useConversations,root,state;
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const view=(patch={})=>({executionId:'e1',requestId:'r1',type:'CHAT',status:'RUNNING',version:1,lastSeq:0,question:'question',answer:'',sources:[],error:null,roundsUsed:0,roundLimit:4,tokensUsed:0,toolCalls:0,...patch});
const flush=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
before(async()=>{
 const dom=new JSDOM('<body></body>',{url:'http://localhost'});
 for(const key of ['window','document','localStorage','sessionStorage','HTMLElement'])globalThis[key]=dom.window[key];
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 ({createRoot}=await import('react-dom/client'));({useConversations}=await import('../src/hooks/useConversations'));
});
afterEach(()=>{if(root){act(()=>root.unmount());root=null;}localStorage.clear();});
function Harness({scope='owner'}){state=useConversations({settings:{baseUrl:'',theme:'light'},accountScope:scope,notify:()=>{},openSettings:()=>{}});return null;}
function mount(){root=createRoot(document.createElement('div'));act(()=>root.render(<Harness/>));}

test('refresh restores request by ID and final snapshot without sending another generation',async()=>{
 const {saveConversations,saveActiveSessionId}=await import('../src/lib/storage');
 const {saveExecutionRecovery}=await import('../src/lib/executionRecovery');
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 saveConversations([{id,title:'recover',createdAt:1,updatedAt:1,messages:[{id:'a1',role:'assistant',content:'partial',createdAt:1,status:'streaming'}]}],'owner');saveActiveSessionId(id,'owner');
 saveExecutionRecovery('owner',[{convId:id,msgId:'a1',request:{requestId:'r1',type:'CHAT',question:'question',conversationId:id},lastSeq:4}]);
 const calls=[];globalThis.fetch=async(url,init)=>{calls.push([String(url),init?.method??'GET']);return String(url).includes('image-jobs')?response([]):response(view({status:'COMPLETED',lastSeq:7,answer:'recovered answer'}));};
 mount();await flush();
 assert.equal(state.conversations[0].messages[0].content,'recovered answer');
 assert.equal(state.busy,null);
 assert.ok(calls.some(([url])=>url==='/api/agent-executions?requestId=r1'));
 assert.ok(calls.every(([,method])=>method!=='POST'));
});

test('persisted stop intent never creates a missing text execution after refresh',async()=>{
 const {saveConversations,saveActiveSessionId}=await import('../src/lib/storage');
 const {saveExecutionRecovery}=await import('../src/lib/executionRecovery');
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 saveConversations([{id,title:'stopped',createdAt:1,updatedAt:1,messages:[{id:'a1',role:'assistant',content:'',createdAt:1,status:'stopped'}]}],'owner');saveActiveSessionId(id,'owner');
 saveExecutionRecovery('owner',[{convId:id,msgId:'a1',stopRequested:true,request:{requestId:'r1',type:'CHAT',question:'question',conversationId:id},lastSeq:0}]);
 const calls=[];globalThis.fetch=async(url,init)=>{
  calls.push([String(url),init?.method??'GET']);
  if(String(url)==='/api/agent-executions?requestId=r1')return new Response(JSON.stringify({message:'missing'}),{status:404,headers:{'Content-Type':'application/json'}});
  return String(url).includes('agent-executions')?response(view({status:'STOPPED'})):response([]);
 };
 mount();await flush();await flush();
 assert.equal(calls.filter(([url,method])=>url==='/api/agent-executions'&&method==='POST').length,0);
 assert.equal(state.conversations[0].messages[0].status,'stopped');assert.equal(state.busy,null);
});

test('text dispatches an execution and explicit stop is remembered before create receipt arrives',async()=>{
 const calls=[];let receipt;
 const pending=new Promise(resolve=>receipt=resolve);
 globalThis.fetch=async(url,init)=>{
  calls.push([String(url),init?.method??'GET',init?.body]);
  if(String(url)==='/api/agent-executions')return pending;
  if(String(url).endsWith('/stop'))return response(view({status:'STOPPED'}));
  return String(url).includes('image-jobs')?response([]):response(view({status:'STOPPED'}));
 };
 mount();act(()=>state.send('question'));await flush();act(()=>state.stop());assert.equal(state.busy,null);await flush();
 const created=calls.find(([url])=>url==='/api/agent-executions');assert.ok(created);
 const submitted=JSON.parse(created[2]);assert.equal(submitted.type,'CHAT');
 await act(async()=>receipt(response(view({requestId:submitted.requestId}))));await flush();
 assert.ok(calls.some(([url,method])=>url==='/api/agent-executions/e1/stop'&&method==='POST'));
 assert.equal(state.conversations[0].messages.at(-1).execution.status,'STOPPED');
});

test('payment-required creation stops immediately instead of retrying billable work',async()=>{
 const calls=[];
 globalThis.fetch=async(url,init)=>{
  calls.push([String(url),init?.method??'GET']);
  if(String(url)==='/api/agent-executions')return new Response(JSON.stringify({detail:'账户已欠费，请充值'}),{status:402,headers:{'Content-Type':'application/json'}});
  return response([]);
 };
 mount();act(()=>state.send('question'));await flush();
 assert.equal(state.busy,null);
 assert.match(state.conversations[0].messages.at(-1).executionConnection,/欠费/);
 assert.equal(calls.filter(([url,method])=>url==='/api/agent-executions'&&method==='POST').length,1);
});

test('healthy execution progress renews the inactivity deadline while a lost observer releases busy',async()=>{
 const originalSet=window.setTimeout.bind(window),originalClear=window.clearTimeout.bind(window);
 const timers=new Map();let next=90000,events;
 window.setTimeout=(callback,delay,...args)=>{if(delay===300000){timers.set(++next,callback);return next;}return originalSet(callback,delay,...args);};
 window.clearTimeout=id=>{timers.delete(id);originalClear(id);};
 globalThis.fetch=async(url,init)=>{
  const path=String(url);
  if(path.endsWith('/events'))return new Response(new ReadableStream({start(controller){events=controller;init.signal.addEventListener('abort',()=>controller.close(),{once:true});}}));
  if(path.includes('agent-executions'))return response(view());return response([]);
 };
 try {
  mount();act(()=>state.send('long task'));await flush();
  const before=[...timers.keys()].at(-1);assert.ok(events);assert.ok(state.busy);
  await act(async()=>events.enqueue(new TextEncoder().encode('id: e1:1\ndata: {"executionId":"e1","seq":1,"type":"progress","generationVersion":1,"payload":{"message":"still working"}}\n\n')));await flush();
  assert.equal(timers.has(before),false);assert.equal(timers.size,1);assert.ok(state.busy);
  act(()=>[...timers.values()][0]());await flush();assert.equal(state.busy,null);
 } finally {window.setTimeout=originalSet;window.clearTimeout=originalClear;}
});

test('account switch aborts subscriptions and leaves backend execution running',async()=>{
 const calls=[];let receipt,oldSignal;
 globalThis.fetch=async(url,init)=>{
  calls.push(String(url));
  if(String(url)==='/api/agent-executions'){oldSignal=init.signal;return new Promise(resolve=>receipt=resolve);}
  return response([]);
 };
 mount();act(()=>state.send('old'));await flush();act(()=>root.render(<Harness scope="second"/>));
 assert.equal(oldSignal.aborted,true);assert.equal(state.busy,null);
 await act(async()=>receipt(response(view({status:'COMPLETED',answer:'old account answer'}))));
 assert.equal(state.conversations.length,0);
 assert.ok(calls.every(url=>!url.endsWith('/stop')));
});

test('continuous document questions reuse the fixed document conversation and clear starts fresh text memory',async()=>{
 const requests=[];
 globalThis.fetch=async(url,init)=>{
  if(String(url)==='/api/agent-executions'){const body=JSON.parse(init.body);requests.push(body);return response(view({executionId:'e'+requests.length,requestId:body.requestId,type:body.type,status:'COMPLETED',question:body.question,answer:'42'}));}
  return String(url).includes('image-jobs')?response([]):response(view({status:'COMPLETED',answer:'42'}));
 };
 mount();act(()=>state.setDocumentContext({conversationId:'dc1',documentIds:['d1'],indexVersions:{d1:1}}));
 act(()=>state.send('first question'));await flush();act(()=>state.send('follow-up'));await flush();
 assert.equal(requests.length,2);assert.equal(requests[0].type,'DOCUMENT_QA');assert.equal(requests[1].documentConversationId,'dc1');
 const previous=state.activeId;act(()=>state.clearContext());act(()=>state.send('fresh chat'));await flush();
 assert.equal(requests[2].type,'CHAT');assert.notEqual(requests[2].conversationId,previous);assert.equal(requests[2].documentConversationId,undefined);
});

test('resume sends durable optimistic version and adds four rounds without creating a new execution',async()=>{
 const requests=[];
 globalThis.fetch=async(url,init)=>{
  requests.push({url:String(url),init});
  if(String(url).endsWith('/resume'))return response(view({status:'COMPLETED',version:4,lastSeq:3,answer:'resumed'}));
  return String(url).includes('image-jobs')?response([]):response(view({status:'STOPPED',version:3,lastSeq:2,answer:'partial'}));
 };
 mount();act(()=>state.send('question'));await flush();
 const message=state.conversations[0].messages.at(-1);act(()=>state.resumeExecution(message.id,'continue'));await flush();
 const resumed=requests.find(item=>item.url.endsWith('/resume'));const body=JSON.parse(resumed.init.body);
 assert.equal(body.expectedVersion,3);assert.equal(body.additionalRounds,4);assert.equal(body.instruction,'continue');assert.ok(body.requestId);
 assert.equal(requests.filter(item=>item.url==='/api/agent-executions').length,1);
 assert.equal(state.conversations[0].messages.at(-1).content,'resumed');
});

test('replaying a terminal receipt preserves the persisted completion time',async()=>{
 const {saveConversations,saveActiveSessionId}=await import('../src/lib/storage');
 const {saveExecutionRecovery}=await import('../src/lib/executionRecovery');
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 saveConversations([{id,title:'timing',createdAt:1000,updatedAt:2500,messages:[{id:'a1',role:'assistant',content:'done',createdAt:1001,startedAt:1000,finishedAt:2500,status:'done',execution:view({status:'COMPLETED'})}]}],'owner');
 saveActiveSessionId(id,'owner');
 saveExecutionRecovery('owner',[{convId:id,msgId:'a1',executionId:'e1',request:{requestId:'r1',type:'CHAT',question:'question',conversationId:id},lastSeq:4}]);
 globalThis.fetch=async(url)=>String(url).includes('image-jobs')?response([]):response(view({status:'COMPLETED',answer:'done',lastSeq:7}));
 mount();await flush();
 const message=state.conversations[0].messages[0];
 assert.equal(message.startedAt,1000);assert.equal(message.finishedAt,2500);
 assert.equal(message.status,'done');
});
