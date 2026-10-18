import assert from 'node:assert/strict';
import {test,before,afterEach} from 'node:test';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
let useConversations,createRoot,root,host,state;
const image=()=>new File(['image'],'photo.png',{type:'image/png'});
const flush=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));});
before(async()=>{
 const dom=new JSDOM('<body></body>',{url:'http://localhost'});
 for(const key of ['window','document','HTMLElement','localStorage','sessionStorage','Event'])globalThis[key]=dom.window[key];
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;URL.createObjectURL=()=> 'blob:preview';URL.revokeObjectURL=()=>{};
 ({createRoot}=await import('react-dom/client'));({useConversations}=await import('../src/hooks/useConversations'));
});
afterEach(()=>{if(root)act(()=>root.unmount());root=null;host?.remove();localStorage.clear();});
function Harness({scope='owner'}){state=useConversations({settings:{baseUrl:'',theme:'light'},accountScope:scope,notify:()=>{},openSettings:()=>{}});return null;}
function mount(){host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>root.render(<Harness/>));}
function backend(override?) {
 const calls=[],jobs=[];
 globalThis.fetch=async(url,init={})=>{
  const path=String(url);calls.push({path,init});
  if(override){const result=await override(path,init,jobs);if(result)return result;}
  if(path==='/api/chat/image-intent')return Response.json({intent:'DESCRIBE'});
  if(path==='/api/billing/wallet')return Response.json({balanceMicros:1000000,reservedMicros:0,freeTokens:1000,freeImages:1,arrears:false,blocked:false,activeUsageId:null});
  if(path==='/api/image-assets/upload-policy')return Response.json({assetId:'a1',uploadUrl:'https://oss.test/upload',fields:{key:'source'}});
  if(path==='https://oss.test/upload'||path.endsWith('/complete'))return new Response(null,{status:204});
  if(path==='/api/image-jobs'&&init.method==='POST'){
   const request=JSON.parse(init.body);let job=jobs.find(j=>j.requestId===request.requestId);
   if(!job){job={...request,jobId:'j-'+request.requestId,status:'QUEUED',createdAt:new Date().toISOString()};jobs.push(job);}return Response.json(job,{status:202});
  }
  if(path.startsWith('/api/image-jobs/by-request/')){const job=jobs.find(j=>path.endsWith(j.requestId));return job?Response.json(job):Response.json({message:'missing'},{status:404});}
  if(path.startsWith('/api/image-jobs?'))return Response.json(jobs);
  if(path.startsWith('/api/image-jobs/'))return Response.json(jobs.find(j=>path.endsWith(j.jobId))??{});
  if(path==='/api/agent-executions') {const request=JSON.parse(init.body);return Response.json({...request,executionId:'e1',status:'COMPLETED',version:1,lastSeq:1,answer:'hello',sources:[],error:null,roundsUsed:1,roundLimit:4,tokensUsed:1,toolCalls:0});}
  return Response.json([]);
 };return {calls,jobs};
}
const creates=calls=>calls.filter(c=>c.path==='/api/image-jobs'&&c.init.method==='POST');
test('storage failure prevents both image and chat dispatch and preserves the composer input',async()=>{
 const {calls}=backend();mount();const original=window.Storage.prototype.setItem;
 window.Storage.prototype.setItem=()=>{throw new Error('quota exceeded');};
 try {
  for(const mode of ['image','text'] as const){let sent;act(()=>{sent=state.send('a red panda',undefined,mode);});assert.equal(sent,false);}
  await flush();assert.equal(creates(calls).length,0);assert.equal(calls.some(c=>c.path==='/api/agent-executions'),false);
 }finally{window.Storage.prototype.setItem=original;}
});

test('quota reached only when saving the new turn blocks text, image and document work',async()=>{
 const {calls}=backend();mount();const original=window.Storage.prototype.setItem;
 window.Storage.prototype.setItem=function(key,value){
  if(String(key).startsWith('travel-agent.conversations.')&&JSON.parse(value).some(c=>c.messages.length))throw new Error('quota reached by new message');
  return original.call(this,key,value);
 };
 try {
  let sent;act(()=>{sent=state.send('hello',undefined,'text');});assert.equal(sent,false);
  act(()=>{sent=state.send('a red panda',undefined,'image');});assert.equal(sent,false);
  act(()=>{sent=state.send('summarize',[new File(['document'],'notes.txt',{type:'text/plain'})],'document');});assert.equal(sent,false);
  await flush();assert.equal(calls.some(c=>c.init.method==='POST'),false);assert.equal(state.busy,null);
 }finally{window.Storage.prototype.setItem=original;}
});

test('explicit text request starts a durable image task, marks mode and releases browser busy',async()=>{
 const {calls,jobs}=backend();mount();act(()=>state.send('帮我生成一张图片：海边日落'));await flush();await flush();
 assert.equal(creates(calls).length,1);assert.equal(jobs.length,1);assert.equal(calls.some(c=>c.path==='/api/agent-executions'),false);
 const message=state.conversations[0].messages.at(-1);assert.equal(message.mode,'image');assert.equal(message.automaticMode,true);assert.equal(message.imageJobs[0].jobId,jobs[0].jobId);assert.equal(state.busy,null);
 assert.match(localStorage.getItem('travel-agent.conversations.v1.owner'),/requestId/);
});
test('reference creation uploads an owned asset and submits the asset reference rather than a zine form',async()=>{
 const {calls}=backend();mount();act(()=>state.send('保留主体改成水彩画',[image()],'image'));await flush();await flush();
 assert.equal(creates(calls).length,1);assert.equal(JSON.parse(creates(calls)[0].init.body).attachments[0].assetId,'a1');assert.equal(calls.some(c=>c.path.includes('/zine/')),false);
});
test('refresh locates accepted request and keeps exactly one job on its original assistant message',async()=>{
 const {calls,jobs}=backend();mount();act(()=>state.send('a red panda',undefined,'image'));await flush();await flush();
 assert.equal(jobs.length,1);const id=state.conversations[0].messages.at(-1).id;
 act(()=>state.send('你好',undefined,'text'));await flush();act(()=>root.unmount());root=null;mount();await flush();await flush();
 assert.equal(creates(calls).length,1);assert.equal(jobs.length,1);
 const messages=state.conversations[0].messages;assert.equal(messages.find(m=>m.id===id).imageJobs.length,1);assert.equal(messages.filter(m=>m.imageJobs?.length).length,1);
});
test('lost creation response is recovered by the saved request ID without creating another image',async()=>{
 let lose=true;const {calls,jobs}=backend((path,init,items)=>{
  if(path==='/api/image-jobs'&&lose){lose=false;const request=JSON.parse(init.body);items.push({...request,jobId:'accepted-before-disconnect',status:'QUEUED'});throw new TypeError('network disconnected');}
 });mount();act(()=>state.send('a red panda',undefined,'image'));await flush();
 assert.equal(state.busy,null);act(()=>root.unmount());root=null;mount();await flush();await flush();
 assert.equal(jobs.length,1);assert.equal(creates(calls).length,1);assert.equal(state.conversations[0].messages.at(-1).imageJobs[0].jobId,'accepted-before-disconnect');
});
test('stop during upload releases input, fences late upload and does not submit a paid job',async()=>{
 let release,signal;const pending=new Promise(resolve=>release=resolve);
 const {calls}=backend((path,init)=>{if(path==='/api/image-assets/upload-policy'){signal=init.signal;return pending;}});mount();act(()=>state.send('watercolor',[image()],'image'));await flush();act(()=>state.stop());
 assert.equal(state.busy,null);assert.equal(signal.aborted,true);
 await act(async()=>release(Response.json({assetId:'a1',uploadUrl:'https://oss.test/upload',fields:{key:'source'}})));await flush();assert.equal(creates(calls).length,0);
});
test('text mode excludes stored image and document context from the submitted execution',async()=>{
 const {calls}=backend();mount();act(()=>state.setDocumentContext({conversationId:'doc-context',documentIds:['d1'],indexVersions:{d1:1}}));
 act(()=>state.send('你好',undefined,'text'));await flush();
 const request=JSON.parse(calls.find(c=>c.path==='/api/agent-executions').init.body);assert.equal(request.type,'CHAT');assert.equal(request.documentConversationId,undefined);assert.equal(request.attachments,undefined);
 assert.equal(state.conversations[0].messages.at(-1).mode,'text');
});

test('request recovery still works when the conversation task list is temporarily unavailable',async()=>{
 const {jobs}=backend(path=>path.startsWith('/api/image-jobs?')?Response.json({message:'temporary'},{status:503}):undefined);
 const conversationId='2fe09439-371d-418f-857e-1fb809058b40',requestId='b96c98f4-5588-47aa-8fdc-c24a14b0d2f8';
 const request={requestId,conversationId,prompt:'a red panda',state:'submitting'};
 jobs.push({...request,jobId:'j-recovered',status:'QUEUED'});
 localStorage.setItem('travel-agent.conversations.v1.owner',JSON.stringify([{id:conversationId,title:'image',createdAt:1,updatedAt:1,messages:[{id:'a',role:'assistant',createdAt:1,content:'',status:'stopped',mode:'image',imageRequest:request}]}]));
 localStorage.setItem('travel-agent.activeSessionId.v1.owner',conversationId);
 mount();await flush();await flush();assert.equal(state.conversations[0].messages[0].imageJobs[0].jobId,'j-recovered');
});

test('image upload has a bounded wait and ignores a receipt arriving after timeout',async()=>{
 let expire,release;const original=window.setTimeout.bind(window);
 window.setTimeout=(callback,delay,...args)=>delay===120000?(expire=callback,12345):original(callback,delay,...args);
 const pending=new Promise(resolve=>release=resolve);
 const {calls}=backend(path=>path==='/api/image-assets/upload-policy'?pending:undefined);
 try {
  mount();act(()=>state.send('watercolor',[image()],'image'));await flush();assert.equal(typeof expire,'function');
  act(()=>expire());assert.equal(state.busy,null);assert.match(state.conversations[0].messages.at(-1).error,/超时/);
  await act(async()=>release(Response.json({assetId:'a1',uploadUrl:'https://oss.test/upload',fields:{key:'source'}})));await flush();assert.equal(creates(calls).length,0);
 }finally{window.setTimeout=original;}
});
test('switching account during image creation cannot publish a late old-account response',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve);
 backend(path=>path==='/api/image-jobs'?pending:undefined);mount();act(()=>state.send('a panda',undefined,'image'));await flush();
 act(()=>root.render(<Harness scope="second"/>));assert.equal(state.busy,null);
 await act(async()=>release(Response.json({jobId:'old-job',status:'QUEUED'})));await flush();assert.equal(state.conversations.length,0);
});
test('persisted stop intent only looks up the request and never resubmits a missing task',async()=>{
 const {calls}=backend();const id='2fe09439-371d-418f-857e-1fb809058b40';
 localStorage.setItem('travel-agent.conversations.v1.owner',JSON.stringify([{id,title:'stopped',createdAt:1,updatedAt:1,messages:[{id:'a',role:'assistant',createdAt:1,content:'',status:'stopped',imageRequest:{requestId:'b96c98f4-5588-47aa-8fdc-c24a14b0d2f8',conversationId:id,prompt:'a panda',state:'stopped',stopRequested:true}}]}]));
 localStorage.setItem('travel-agent.activeSessionId.v1.owner',id);mount();await flush();await flush();assert.equal(creates(calls).length,0);assert.equal(state.busy,null);
});
test('terminal image failure remains terminal after refresh',async()=>{
 const {jobs}=backend();mount();act(()=>state.send('a panda',undefined,'image'));await flush();await flush();
 jobs[0].status='FAILED';jobs[0].error='供应商拒绝了该请求';act(()=>root.unmount());root=null;mount();await flush();await flush();
 const message=state.conversations[0].messages.at(-1);assert.equal(message.status,'error');assert.match(message.error,/供应商/);assert.equal(state.busy,null);
});

test('reference upload failure stays terminal across refresh and never submits a text-only job',async()=>{
 const {calls,jobs}=backend(path=>path==='/api/image-assets/upload-policy'?Response.json({message:'OSS unavailable'},{status:503}):undefined);
 mount();act(()=>state.send('watercolor',[image()],'image'));await flush();await flush();
 assert.equal(state.busy,null);assert.equal(state.conversations[0].messages.at(-1).imageRequest.state,'failed');
 act(()=>root.unmount());root=null;mount();await flush();await flush();assert.equal(creates(calls).length,0);assert.equal(jobs.length,0);
});

test('accepted pending job resumes polling after refresh even if the conversation task list fails',async()=>{
 let outage=false;const {calls,jobs}=backend(path=>outage&&path.startsWith('/api/image-jobs?')?Response.json({message:'temporary'},{status:503}):undefined);
 mount();act(()=>state.send('a panda',undefined,'image'));await flush();await flush();assert.equal(state.conversations[0].messages.at(-1).imageRequest.state,'accepted');
 act(()=>root.unmount());root=null;outage=true;jobs[0].status='SUCCEEDED';mount();await flush();await flush();
 assert.equal(state.conversations[0].messages.at(-1).imageJobs[0].status,'SUCCEEDED');assert.equal(creates(calls).length,1);
});

for(const [prompt,intent] of [
 ['这张图帮我换成水彩','REMIX'],['先描述这张图再改成水彩','REMIX'],
 ['这张图是什么风格','DESCRIBE'],['分析下这个方案能不能改成线上','DESCRIBE'],
 ['不要生成图片，只解释海报风格','DESCRIBE'],['教我如何把照片改成水彩','DESCRIBE'],
 ['把这张照片做成一张复古海报','DESCRIBE'],
] as const)test(`backend image intent controls dispatch: ${prompt} => ${intent}`,async()=>{
 const {calls}=backend(path=>path==='/api/chat/image-intent'?Response.json({intent}):undefined);
 mount();act(()=>state.send(prompt,[image()],'chat'));await flush();await flush();
 assert.equal(calls.filter(c=>c.path==='/api/chat/image-intent').length,1);
 assert.equal(creates(calls).length,intent!=='DESCRIBE'?1:0);
 assert.equal(calls.filter(c=>c.path==='/api/agent-executions').length,intent==='DESCRIBE'?1:0);
 if(intent!=='DESCRIBE')assert.equal(JSON.parse(creates(calls)[0].init.body).attachments[0].assetId,'a1');
 assert.equal(state.conversations[0].messages.at(-1).mode,intent!=='DESCRIBE'?'image':'vision');
});

for(const verdict of ['WAIT_FOR_INSTRUCTION','GENERATE please',null])test(`uncertain image intent stops without another paid task: ${verdict}`,async()=>{
 const {calls}=backend(path=>path==='/api/chat/image-intent'?Response.json({intent:verdict}):undefined);
 mount();act(()=>state.send('这张图帮我换成水彩',[image()],'chat'));await flush();await flush();
 assert.equal(calls.filter(c=>c.path==='/api/chat/image-intent').length,1);
 assert.equal(creates(calls).length,0);assert.equal(calls.some(c=>c.path==='/api/agent-executions'),false);
 assert.equal(state.busy,null);assert.match(state.conversations[0].messages.at(-1).error,/明确/);
});

test('classification failure is not retried and never falls through to vision',async()=>{
 const {calls}=backend(path=>path==='/api/chat/image-intent'?Response.json({message:'分类超时'},{status:503}):undefined);
 mount();act(()=>state.send('这张图帮我换成水彩',[image()],'chat'));await flush();await flush();
 assert.equal(calls.filter(c=>c.path==='/api/chat/image-intent').length,1);assert.equal(creates(calls).length,0);
 assert.equal(calls.some(c=>c.path==='/api/agent-executions'),false);assert.equal(state.busy,null);
});

for(const switchAccount of [false,true])test(`late classification is fenced after ${switchAccount?'account switch':'stop'}`,async()=>{
 let release;const pending=new Promise(resolve=>release=resolve);
 const {calls}=backend(path=>path==='/api/chat/image-intent'?pending:undefined);
 mount();act(()=>state.send('这张图帮我换成水彩',[image()],'chat'));await flush();
 assert.ok(state.busy);assert.equal(calls.filter(c=>c.path==='/api/chat/image-intent').length,1);
 act(()=>switchAccount?root.render(<Harness scope="second"/>):state.stop());
 await act(async()=>release(Response.json({intent:'GENERATE'})));await flush();
 assert.equal(creates(calls).length,0);assert.equal(calls.some(c=>c.path==='/api/agent-executions'),false);assert.equal(state.busy,null);
});

test('a follow-up edit classifies stored context and preserves its owned reference',async()=>{
 const {calls}=backend(path=>path==='/api/chat/image-intent'?Response.json({intent:'REMIX'}):undefined);
 const id='2fe09439-371d-418f-857e-1fb809058b40';
 localStorage.setItem('travel-agent.conversations.v1.owner',JSON.stringify([{id,title:'photo',createdAt:1,updatedAt:1,messages:[],imageAttachments:[{assetId:'stored',fileName:'photo.png',mimeType:'image/png',fileSize:5}]}]));
 localStorage.setItem('travel-agent.activeSessionId.v1.owner',id);
 mount();await flush();act(()=>state.send('这张图帮我换成水彩'));await flush();await flush();
 assert.equal(calls.filter(c=>c.path==='/api/chat/image-intent').length,1);assert.equal(creates(calls).length,1);
 assert.equal(JSON.parse(creates(calls)[0].init.body).attachments[0].assetId,'stored');
});

test('multiple image edit references stop before any image task',async()=>{
 const {calls}=backend(path=>path==='/api/chat/image-intent'?Response.json({intent:'GENERATE'}):undefined);
 mount();act(()=>state.send('这张图帮我换成水彩',[image(),image()]));await flush();await flush();
 assert.equal(creates(calls).length,0);assert.equal(calls.some(c=>c.path==='/api/agent-executions'),false);
 assert.match(state.conversations[0].messages.at(-1).error,/一张|1 张/);
});

test('a new text-to-image request does not inherit older references after classification',async()=>{
 const {calls}=backend(path=>path==='/api/chat/image-intent'?Response.json({intent:'GENERATE'}):undefined);
 const id='2fe09439-371d-418f-857e-1fb809058b40';
 localStorage.setItem('travel-agent.conversations.v1.owner',JSON.stringify([{id,title:'photo',createdAt:1,updatedAt:1,messages:[],imageAttachments:[{assetId:'stored',fileName:'photo.png',mimeType:'image/png',fileSize:5}]}]));
 localStorage.setItem('travel-agent.activeSessionId.v1.owner',id);
 mount();await flush();act(()=>state.send('生成一张海边日落照片'));await flush();await flush();
 assert.equal(creates(calls).length,1);assert.equal(JSON.parse(creates(calls)[0].init.body).attachments,undefined);
});

test('blocked wallet after classification prevents the next task',async()=>{
 const {calls}=backend(path=>path==='/api/chat/image-intent'?Response.json({intent:'GENERATE'}):path==='/api/billing/wallet'?Response.json({balanceMicros:0,reservedMicros:0,freeTokens:0,freeImages:0,arrears:false,blocked:true,activeUsageId:'pending'}):undefined);
 mount();act(()=>state.send('这张图帮我换成水彩',[image()]));await flush();await flush();
 assert.equal(creates(calls).length,0);assert.equal(calls.some(c=>c.path==='/api/agent-executions'),false);assert.equal(state.busy,null);
});

test('image-only upload and explicit creation skip paid intent classification',async()=>{
 const {calls}=backend();mount();act(()=>state.send('',[image()]));await flush();await flush();
 assert.equal(calls.filter(c=>c.path==='/api/chat/image-intent').length,0);
 act(()=>state.send('watercolor',[image()],'image'));await flush();await flush();
 assert.equal(calls.filter(c=>c.path==='/api/chat/image-intent').length,0);assert.equal(creates(calls).length,1);
});

test('classification timeout aborts once and a late response cannot start work',async()=>{
 const original=globalThis.setTimeout;let expire,release;
 const pending=new Promise(resolve=>release=resolve);
 globalThis.setTimeout=((callback,delay,...args)=>delay===15000?(expire=callback,original(()=>{},60000)):original(callback,delay,...args)) as typeof setTimeout;
 const {calls}=backend(path=>path==='/api/chat/image-intent'?pending:undefined);
 try {
  mount();act(()=>state.send('这张图帮我换成水彩',[image()]));await flush();
  assert.equal(calls.filter(c=>c.path==='/api/chat/image-intent').length,1);
  act(()=>expire());
  await act(async()=>release(Response.json({intent:'GENERATE'})));await flush();
  assert.equal(creates(calls).length,0);assert.equal(calls.some(c=>c.path==='/api/agent-executions'),false);
  assert.equal(state.busy,null);assert.match(state.conversations[0].messages.at(-1).error,/超时/);
 }finally{globalThis.setTimeout=original;}
});

test('storage failure after classification prevents image submission',async()=>{
 const original=window.Storage.prototype.setItem;
 const {calls}=backend(path=>{
  if(path==='/api/chat/image-intent') {
   window.Storage.prototype.setItem=function(key,value){
    if(String(key).startsWith('travel-agent.conversations.')&&value.includes('"imageRequest"'))throw new Error('quota');
    return original.call(this,key,value);
   };
   return Response.json({intent:'GENERATE'});
  }
 });
 try {
  mount();act(()=>state.send('这张图帮我换成水彩',[image()]));await flush();await flush();
  assert.equal(creates(calls).length,0);assert.equal(state.busy,null);
 }finally{window.Storage.prototype.setItem=original;}
});

test('an uploaded auto-edit keeps the owned reference for the next image question',async()=>{
 const {calls}=backend((path,init)=>path==='/api/chat/image-intent'?Response.json({intent:JSON.parse(init.body).question==='这张图帮我换成水彩'?'REMIX':'DESCRIBE'}):undefined);
 mount();act(()=>state.send('这张图帮我换成水彩',[image()]));await flush();await flush();
 act(()=>state.send('这张图是什么风格'));await flush();await flush();
 assert.equal(calls.filter(c=>c.path==='/api/chat/image-intent').length,2);
 const question=JSON.parse(calls.find(c=>c.path==='/api/agent-executions').init.body);
 assert.equal(question.attachments[0].assetId,'a1');assert.equal(state.conversations[0].messages.at(-1).mode,'vision');
});

test('reload and retry after an unknown classification must classify again',async()=>{
 const {calls}=backend(path=>path==='/api/chat/image-intent'?Response.json({intent:'WAIT_FOR_INSTRUCTION'}):undefined);
 mount();act(()=>state.send('把这张照片做成一张复古海报',[image()]));await flush();await flush();
 const userId=state.conversations[0].messages[0].id;
 act(()=>root.unmount());root=null;mount();await flush();await flush();
 act(()=>state.retryAttachments(userId));await flush();await flush();
 assert.equal(calls.filter(c=>c.path==='/api/chat/image-intent').length,2);
 assert.equal(creates(calls).length,0);assert.equal(calls.some(c=>c.path==='/api/agent-executions'),false);
});

for(const prompt of ['改成水彩','把背景换成蓝色'])test(`semantic edit uses stored source without referent keywords: ${prompt}`,async()=>{
 const {calls}=backend(path=>path==='/api/chat/image-intent'?Response.json({intent:'REMIX'}):undefined);
 const id='2fe09439-371d-418f-857e-1fb809058b40';
 localStorage.setItem('travel-agent.conversations.v1.owner',JSON.stringify([{id,title:'photo',createdAt:1,updatedAt:1,messages:[],imageAttachments:[{assetId:'stored',fileName:'photo.png',mimeType:'image/png',fileSize:5}]}]));
 localStorage.setItem('travel-agent.activeSessionId.v1.owner',id);
 mount();await flush();act(()=>state.send(prompt));await flush();await flush();
 assert.equal(creates(calls).length,1);assert.equal(JSON.parse(creates(calls)[0].init.body).attachments[0].assetId,'stored');
});
