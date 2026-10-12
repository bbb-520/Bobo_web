import assert from 'node:assert/strict';
import {test,before,afterEach} from 'node:test';
import {registerHooks} from 'node:module';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
registerHooks({load(url,context,nextLoad){if(url.endsWith('.css'))return{format:'module',source:'export {};',shortCircuit:true};return nextLoad(url,context);}});
let Composer,useConversations,createRoot,root,host,state;
let previewCounter=0;
const flush=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
const wallet={balanceMicros:0,reservedMicros:0,freeImages:0,freeTokens:1000000,arrears:false,lowBalance:true,blocked:false,activeUsageId:null};
const image=()=>new File(['image'],'photo.png',{type:'image/png'});
const documentFile=()=>new File(['document'],'report.txt',{type:'text/plain'});
const readyDoc={documentId:'d1',filename:'report.txt',status:'READY',indexStatus:'READY',summaryStatus:'COMPLETED',chunkCount:2,completedChunks:2,error:null,indexVersion:1,updatedAt:'2026-10-11T00:00:00Z'};
const view=body=>({executionId:'e-'+body.requestId,requestId:body.requestId,type:body.type,status:'COMPLETED',version:1,lastSeq:2,question:body.question,answer:'附件回答',sources:[],error:null,roundsUsed:1,roundLimit:4,tokensUsed:10,toolCalls:0});
before(async()=>{
 const dom=new JSDOM('<body></body>',{url:'http://localhost'});
 for(const key of ['window','document','HTMLElement','localStorage','sessionStorage','Event'])globalThis[key]=dom.window[key];
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 globalThis.requestAnimationFrame=cb=>setTimeout(cb,0);globalThis.cancelAnimationFrame=clearTimeout;
 URL.createObjectURL=()=>`blob:preview-${++previewCounter}`;URL.revokeObjectURL=()=>{};
 ({createRoot}=await import('react-dom/client'));
 Composer=(await import('../src/components/Composer')).default;
 ({useConversations}=await import('../src/hooks/useConversations'));
});
afterEach(()=>{if(root){act(()=>root.unmount());root=null;}host?.remove();localStorage.clear();});
function mount(element){host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>root.render(element));}
function composer(onSend,value=''){mount(<Composer value={value} onChange={()=>{}} onSend={onSend} onStop={()=>{}} running={false} wallet={wallet} signedIn onOpenAccount={()=>{}}/>);}
function attach(files,method='select'){
 const element=method==='paste'?host.querySelector('textarea'):method==='drop'?host.querySelector('.composer-inner'):host.querySelector('input[type=file]');
 const event=new Event(method==='select'?'change':method==='paste'?'paste':'drop',{bubbles:true,cancelable:true});
 if(method==='select')Object.defineProperty(element,'files',{value:files,configurable:true});
 else Object.defineProperty(event,method==='paste'?'clipboardData':'dataTransfer',{value:{files}});
 act(()=>element.dispatchEvent(event));
}
function Harness({scope='owner'}){state=useConversations({settings:{baseUrl:'',theme:'light'},accountScope:scope,notify:()=>{},openSettings:()=>{}});return null;}
function backend(options={}){
 const calls=[];let count=0;
 globalThis.fetch=async(url,init={})=>{
  const path=String(url);calls.push({path,init});
  if(options.fetch){const result=await options.fetch(path,init,calls);if(result)return result;}
  if(path==='/api/image-assets/upload-policy')return Response.json({assetId:`asset-${++count}`,uploadUrl:'https://oss.test/upload',fields:{key:'object'}});
  if(path==='https://oss.test/upload'||path.endsWith('/complete'))return new Response(null,{status:204});
  if(path==='/api/documents'&&init.method==='POST')return Response.json(options.doc??readyDoc);
  if(path==='/api/documents/d1')return Response.json(readyDoc);
  if(path==='/api/documents/d1/retry')return Response.json(readyDoc);
  if(path==='/api/document-conversations')return Response.json({conversationId:'dc1',documentIds:JSON.parse(init.body).documentIds,indexVersions:{d1:1}});
  if(path==='/api/agent-executions')return Response.json(view(JSON.parse(init.body)));
  return Response.json([]);
 };
 return calls;
}
const executions=calls=>calls.filter(call=>call.path==='/api/agent-executions').map(call=>JSON.parse(call.init.body));

test('default composer sends mixed attachments as ordinary chat through selection, paste and drop',async()=>{
 const sent=[];composer(async(files,kind)=>{sent.push({files,kind});return true;});
 assert.equal(host.querySelector('select').value,'chat');
 attach([image()]);attach([documentFile()],'paste');attach([new File(['more'],'more.md',{type:'text/markdown'})],'drop');
 assert.equal(host.querySelector('input[type=file]').multiple,true);
 assert.match(host.textContent,/report.txt/);assert.match(host.textContent,/more.md/);
 await act(async()=>host.querySelector('[aria-label="发送"]').click());
 assert.equal(sent.length,1);assert.equal(sent[0].kind,'chat');assert.equal(sent[0].files.length,3);
 assert.equal(host.querySelectorAll('.composer-attachment').length,0);
});

test('composer validates image count, file count, supported formats and per-file byte limits visibly',()=>{
 composer(async()=>true);
 attach(Array.from({length:4},image));assert.match(host.querySelector('[role=alert]')?.textContent??'',/3/);
 attach(Array.from({length:9},documentFile));assert.match(host.querySelector('[role=alert]')?.textContent??'',/8/);
 attach([new File(['x'],'archive.exe')]);assert.match(host.querySelector('[role=alert]')?.textContent??'',/格式|支持/);
 const large=image();Object.defineProperty(large,'size',{value:20*1024*1024+1});attach([large]);assert.match(host.querySelector('[role=alert]')?.textContent??'',/20/);
 const largeDoc=documentFile();Object.defineProperty(largeDoc,'size',{value:100*1024*1024+1});attach([largeDoc]);assert.match(host.querySelector('[role=alert]')?.textContent??'',/100/);
 assert.equal(host.querySelectorAll('.composer-attachment').length,0);
});

test('explicit image creation requires exactly one image and disallows documents',()=>{
 composer(async()=>true,'create');const select=host.querySelector('select');act(()=>{select.value='image';select.dispatchEvent(new Event('change',{bubbles:true}));});
 assert.equal(host.querySelector('[aria-label="发送"]').disabled,true);
 attach([documentFile()]);assert.match(host.querySelector('[role=alert]')?.textContent??'',/图片/);
 attach([image(),image()]);assert.match(host.querySelector('[role=alert]')?.textContent??'',/1|一张/);
 attach([image()]);assert.equal(host.querySelector('[aria-label="发送"]').disabled,false);
});

test('ordinary image chat submits durable owned references and retains them for follow-up and refresh',async()=>{
 const calls=backend();mount(<Harness/>);
 act(()=>state.send('',[image(),image()],'chat'));await flush();await flush();
 let requests=executions(calls);assert.equal(requests.length,1);assert.equal(requests[0].type,'CHAT');assert.match(requests[0].question,/描述|图片/);
 assert.deepEqual(requests[0].attachments,[{assetId:'asset-1',fileName:'photo.png',mimeType:'image/png',fileSize:5},{assetId:'asset-2',fileName:'photo.png',mimeType:'image/png',fileSize:5}]);
 assert.ok(calls.every(call=>!call.path.includes('/chat/')));
 assert.equal(state.conversations[0].messages[0].attachments.length,2);
 act(()=>state.send('what else?'));await flush();assert.deepEqual(executions(calls)[1].attachments,requests[0].attachments);
 const saved=localStorage.getItem('travel-agent.conversations.v1.owner');assert.doesNotMatch(saved,/blob:/);assert.match(saved,/asset-1/);
 act(()=>root.unmount());root=null;mount(<Harness/>);await flush();act(()=>state.send('after reload'));await flush();assert.deepEqual(executions(calls)[2].attachments,requests[0].attachments);
 act(()=>state.send('replacement',[image()],'chat'));await flush();act(()=>state.send('follow replacement'));await flush();assert.equal(executions(calls).at(-1).attachments.length,1);assert.equal(executions(calls).at(-1).attachments[0].assetId,'asset-3');
 act(()=>state.clearContext());act(()=>state.send('fresh'));await flush();assert.equal(executions(calls).at(-1).attachments,undefined);
});

test('document-only and mixed messages wait for index readiness, persist cards and keep document context',async()=>{
 let read;const indexPending=new Promise(resolve=>read=resolve);
 const calls=backend({doc:{...readyDoc,status:'PROCESSING',indexStatus:'INDEXING',completedChunks:1},fetch:(path)=>path==='/api/documents/d1'?indexPending:undefined});
 mount(<Harness/>);act(()=>state.send('',[documentFile(),image()],'chat'));await flush();
 assert.equal(executions(calls).length,0);assert.ok(state.busy);assert.equal(state.conversations[0].messages[0].documentAttachments[0].documentId,'d1');
 await act(async()=>read(Response.json(readyDoc)));await flush();await flush();
 const request=executions(calls)[0];assert.equal(request.type,'DOCUMENT_QA');assert.equal(request.documentConversationId,'dc1');assert.equal(request.attachments[0].assetId,'asset-1');assert.match(request.question,/概述|文档/);
 act(()=>state.send('follow docs'));await flush();assert.equal(executions(calls)[1].documentConversationId,'dc1');
 assert.match(localStorage.getItem('travel-agent.conversations.v1.owner'),/report.txt/);
});

test('document parsing failure preserves uploaded reference and retry processes it without uploading twice',async()=>{
 let retried=false;const failed={...readyDoc,status:'FAILED',indexStatus:'PENDING',error:'无法解析该文档'};
 const calls=backend({doc:failed,fetch:path=>{if(path==='/api/documents/d1/retry'){retried=true;return Response.json(readyDoc);}if(path==='/api/documents/d1')return Response.json(retried?readyDoc:failed);}});mount(<Harness/>);
 act(()=>state.send('summarize',[documentFile()],'chat'));await flush();await flush();
 assert.equal(executions(calls).length,0);assert.equal(state.busy,null);assert.match(state.conversations[0].messages.at(-1).error,/无法解析/);
 const message=state.conversations[0].messages[0];assert.equal(message.documentAttachments[0].documentId,'d1');
 act(()=>state.retryAttachments(message.id));await flush();await flush();
 assert.equal(calls.filter(call=>call.path==='/api/documents'&&call.init.method==='POST').length,1);
 assert.equal(executions(calls).length,1);assert.ok(calls.some(call=>call.path==='/api/documents/d1/retry'));
});

test('cancel during attachment preparation aborts upload and never submits an execution',async()=>{
 let release,signal;const pending=new Promise(resolve=>release=resolve);
 const calls=backend({fetch:(path,init)=>{if(path==='/api/documents'&&init.method==='POST'){signal=init.signal;return pending;}}});mount(<Harness/>);
 act(()=>state.send('summarize',[documentFile()],'chat'));await flush();act(()=>state.stop());assert.equal(signal.aborted,true);
 await act(async()=>release(Response.json(readyDoc)));await flush();assert.equal(executions(calls).length,0);assert.equal(state.busy,null);
});

test('switching accounts during upload cannot publish or submit the previous account files',async()=>{
 let release,signal;const pending=new Promise(resolve=>release=resolve);
 const calls=backend({fetch:(path,init)=>{if(path==='/api/image-assets/upload-policy'){signal=init.signal;return pending;}}});mount(<Harness/>);
 act(()=>state.send('describe',[image()],'chat'));await flush();act(()=>root.render(<Harness scope="second"/>));assert.equal(signal.aborted,true);
 await act(async()=>release(Response.json({assetId:'old-asset',uploadUrl:'https://oss.test/upload',fields:{key:'object'}})));await flush();
 assert.equal(executions(calls).length,0);assert.equal(state.conversations.length,0);assert.equal(state.busy,null);assert.ok(calls.every(call=>call.path!=='https://oss.test/upload'));
});

test('image creation admission accepts universal tokens while retaining debt and usage locks',async()=>{
 const {generationBlockReason}=await import('../src/lib/billing');
 assert.equal(generationBlockReason(wallet,'IMAGE'),null);
 assert.match(generationBlockReason({...wallet,arrears:true},'IMAGE'),/欠费/);
 assert.match(generationBlockReason({...wallet,activeUsageId:'pending'},'IMAGE'),/处理中|对账/);
});

test('image evidence citation displays extracted observations without requesting document source',async()=>{
 const ExecutionDetails=(await import('../src/components/ExecutionDetails')).default;
 const source={id:'image-1',kind:'IMAGE',documentId:null,chunkId:'vision-1',title:'photo.png',page:null,excerpt:'照片中有两只杯子。'};
 const calls=[];globalThis.fetch=async(url)=>{calls.push(String(url));return Response.json({});};
 mount(<ExecutionDetails msg={{id:'a',role:'assistant',createdAt:1,content:'two',execution:{...view({requestId:'r',question:'q',type:'DOCUMENT_QA'}),sources:[source]}}} baseUrl=""/>);
 act(()=>[...host.querySelectorAll('button')].find(button=>button.textContent.includes('[1]')).click());await flush();
 assert.equal(calls.length,0);assert.match(host.textContent,/图片附件识别结果（可能存在识别误差）/);assert.match(host.textContent,/照片中有两只杯子/);
});

test('unsupported image types are rejected before upload while explicit creation preserves BMP support',async()=>{
 const {validateAttachments}=await import('../src/lib/attachments');
 assert.match(validateAttachments([new File(['svg'],'vector.svg',{type:'image/svg+xml'})],'chat')??'',/格式|支持/);
 assert.match(validateAttachments([new File(['bmp'],'photo.bmp',{type:'image/bmp'})],'chat')??'',/格式|支持/);
 assert.equal(validateAttachments([new File(['bmp'],'photo.bmp',{type:'image/bmp'})],'image'),null);
});

test('chat accepts text, images, docs, image-only and doc-only with the expected durable execution kind',async()=>{
 const calls=backend();mount(<Harness/>);
 const cases=[{text:'hello',files:[],type:'CHAT'},{text:'look',files:[image()],type:'CHAT'},{text:'summarize',files:[documentFile()],type:'DOCUMENT_QA'},{text:'',files:[image()],type:'CHAT'},{text:'',files:[documentFile()],type:'DOCUMENT_QA'}];
 for(const example of cases){act(()=>state.newChat());act(()=>state.send(example.text,example.files,'chat'));await flush();await flush();assert.equal(executions(calls).at(-1).type,example.type);assert.ok(executions(calls).at(-1).question.length>0);}
 assert.equal(executions(calls).length,5);
});

test('document preparation waits for shared wallet processing and can be stopped before question dispatch',async()=>{
 const calls=backend({fetch:path=>path==='/api/billing/wallet'?Response.json({...wallet,activeUsageId:'background-summary'}):undefined});mount(<Harness/>);
 act(()=>state.send('',[documentFile()],'chat'));await flush();await flush();assert.equal(executions(calls).length,0);assert.ok(state.busy);assert.match(state.conversations[0].messages.at(-1).executionConnection,/额度|等待/);
 act(()=>state.stop());await flush();assert.equal(state.busy,null);assert.equal(executions(calls).length,0);
});


test('filtered citations retain canonical source IDs matching the answer instead of list positions',async()=>{
 const ExecutionDetails=(await import('../src/components/ExecutionDetails')).default;
 const sources=[{id:'S3',kind:'DOCUMENT',documentId:'d1',chunkId:'chunk-3',title:'report.txt',page:2,excerpt:'目标为 42。'},{id:'S8',kind:'IMAGE',documentId:null,chunkId:'vision-8',title:'photo.png',page:null,excerpt:'图片中有两只杯子。'},{id:'legacy-source',kind:'IMAGE',documentId:null,chunkId:'vision-legacy',title:'old.png',page:null,excerpt:'旧引用内容。'}];
 const calls=[];globalThis.fetch=async(url)=>{calls.push(String(url));return Response.json(sources[0]);};
 mount(<ExecutionDetails msg={{id:'a',role:'assistant',createdAt:1,content:'目标为 42 [S3]，图片中有两只杯子 [S8]。',execution:{...view({requestId:'r',question:'q',type:'DOCUMENT_QA'}),sources}}} baseUrl=""/>);
 const citationButtons=[...host.querySelectorAll('.execution-sources button')];
 assert.match(citationButtons[0].textContent,/^\[S3\]/);
 assert.match(citationButtons[1].textContent,/^\[S8\]/);
 assert.match(citationButtons[2].textContent,/^\[3\]/);
 act(()=>citationButtons[1].click());await flush();assert.equal(calls.length,0);assert.match(host.textContent,/图片中有两只杯子/);
 act(()=>citationButtons[0].click());await flush();assert.deepEqual(calls,['/api/documents/d1/sources/chunk-3']);assert.match(host.textContent,/目标为 42/);
});
