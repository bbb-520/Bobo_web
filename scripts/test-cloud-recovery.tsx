import assert from 'node:assert/strict';
import {test,before,afterEach} from 'node:test';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
let createRoot:any,useConversations:any,root:any,state:any;
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const conv=(title='cloud')=>({id,title,createdAt:1,updatedAt:2,messages:[{id:'user',role:'user',content:'hello',createdAt:1,attachments:[{assetId:'asset1',fileName:'x.png',mimeType:'image/png',fileSize:10}]}]});
const response=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const flush=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
before(async()=>{
 const dom=new JSDOM('<body></body>',{url:'http://localhost'});
 for(const key of ['window','document','localStorage','sessionStorage','HTMLElement'])globalThis[key]=dom.window[key];
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 ({createRoot}=await import('react-dom/client'));({useConversations}=await import('../src/hooks/useConversations'));
});
afterEach(()=>{if(root){act(()=>root.unmount());root=null;}localStorage.clear();});
function Harness({scope='owner'}){state=useConversations({settings:{baseUrl:'',theme:'light'},accountScope:scope,notify:()=>{},openSettings:()=>{}});return null;}
function mount(){root=createRoot(document.createElement('div'));act(()=>root.render(<Harness/>));}
test('empty browser restores cloud conversation and fresh source preview without a generation request',async()=>{
 const calls:string[]=[];globalThis.fetch=async(url:any,init:any)=>{
  calls.push(`${init?.method??'GET'} ${url}`);
  if(String(url).startsWith('/api/conversations?'))return response([{id,revision:1,deleted:false}]);
  if(String(url)===`/api/conversations/${id}`)return response({id,revision:1,deleted:false,snapshot:conv()});
  if(String(url).endsWith('/preview'))return response({assetId:'asset1',previewUrl:'https://oss.example/fresh',expiresAt:new Date(Date.now()+600000).toISOString()});
  return response([]);
 };
 mount();await flush();await flush();
 assert.equal(state.conversations[0]?.title,'cloud');assert.equal(state.activeId,id);
 assert.equal(state.conversations[0].messages[0].attachments[0].previewUrl,'https://oss.example/fresh');
 assert.ok(calls.every(call=>call.startsWith('GET ')));
 assert.ok(!JSON.stringify(localStorage).includes('oss.example'));
});
test('account change prevents a late cloud snapshot from leaking into the next account',async()=>{
 let finish:any;globalThis.fetch=async(url:any)=>{
  if(String(url).startsWith('/api/conversations?'))return new Promise(resolve=>finish=()=>resolve(response([{id,revision:1,deleted:false}])));
  return response({id,revision:1,deleted:false,snapshot:conv('old-owner')});
 };
 mount();await flush();const old=finish;act(()=>root.render(<Harness scope="guest"/>));await flush();await act(async()=>old());await flush();
 assert.equal(state.conversations.length,0);
});
test('cloud active execution restores by existing execution ID without creating chargeable work',async()=>{
 const calls:string[]=[];
 const execution={executionId:'e1',requestId:'r1',type:'CHAT',status:'RUNNING',version:1,lastSeq:1,question:'hello',answer:'partial',sources:[],error:null,roundsUsed:1,roundLimit:4,tokensUsed:0,toolCalls:0};
 const snapshot={...conv(),messages:[{id:'a1',role:'assistant',content:'partial',createdAt:1,status:'streaming',execution}]};
 globalThis.fetch=async(url:any,init:any)=>{
  calls.push(`${init?.method??'GET'} ${url}`);
  if(String(url).startsWith('/api/conversations?'))return response([{id,revision:1,deleted:false}]);
  if(String(url)===`/api/conversations/${id}`)return response({id,revision:1,deleted:false,snapshot});
  if(String(url)==='/api/agent-executions/e1')return response({...execution,status:'COMPLETED',lastSeq:2,answer:'final'});
  return response([]);
 };
 mount();await flush();await flush();assert.equal(state.conversations[0].messages[0].content,'final');
 assert.ok(calls.includes('GET /api/agent-executions/e1'));assert.ok(calls.every(call=>call.startsWith('GET ')));
});
test('deleting a local conversation while initial cloud loading is pending does not resurrect it',async()=>{
 const {saveConversations,saveActiveSessionId}=await import('../src/lib/storage');
 saveConversations([conv()],'owner');saveActiveSessionId(id,'owner');let finish:any;
 globalThis.fetch=async(url:any)=>{
  if(String(url).startsWith('/api/conversations?'))return new Promise(resolve=>finish=()=>resolve(response([{id,revision:1,deleted:false}])));
  if(String(url)===`/api/conversations/${id}`)return response({id,revision:1,deleted:false,snapshot:conv()});
  return response([]);
 };
 mount();await flush();act(()=>state.removeConversation(id));await flush();await act(async()=>finish());await flush();
 assert.equal(state.conversations.length,0);
});
