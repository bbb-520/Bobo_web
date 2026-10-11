import assert from 'node:assert/strict';
import {test,before,afterEach} from 'node:test';
import {registerHooks} from 'node:module';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
registerHooks({load(url,context,nextLoad){if(url.endsWith('.css'))return{format:'module',source:'export {};',shortCircuit:true};return nextLoad(url,context);}});
let DocumentPanel,ExecutionDetails,createRoot,root,host;
const response=value=>new Response(JSON.stringify(value));
const flush=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
before(async()=>{
 const dom=new JSDOM('<body></body>',{url:'http://localhost'});
 for(const key of ['window','document','HTMLElement','localStorage','Event'])globalThis[key]=dom.window[key];
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 ({createRoot}=await import('react-dom/client'));
 DocumentPanel=(await import('../src/components/DocumentPanel')).default;
 ExecutionDetails=(await import('../src/components/ExecutionDetails')).default;
});
afterEach(()=>{if(root){act(()=>root.unmount());root=null;}host?.remove();});
function mount(element){host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>root.render(element));}
function click(text){const button=[...host.querySelectorAll('button')].find(item=>item.textContent.includes(text));assert.ok(button,text);act(()=>button.click());}

test('execution displays actual model identity and does not leave stopped work running',()=>{
 const modelStatus={provider:'GPT',model:'gpt-4.1',state:'RUNNING',fallback:false,capability:'DOCUMENT_QA'};
 const view={executionId:'e1',requestId:'r1',type:'DOCUMENT_QA',status:'RUNNING',version:1,lastSeq:1,question:'goal',answer:'',sources:[],error:null,roundsUsed:0,roundLimit:4,tokensUsed:0,toolCalls:0,modelStatus};
 const msg={id:'m1',role:'assistant',createdAt:1,content:'',status:'streaming',execution:view};
 mount(<ExecutionDetails msg={msg} baseUrl=""/>);
 assert.match(host.textContent,/ChatGPT/);assert.match(host.textContent,/gpt-4.1/);assert.match(host.textContent,/处理中/);
 act(()=>root.render(<ExecutionDetails msg={{...msg,status:'stopped',execution:{...view,status:'STOPPED'}}} baseUrl=""/>));
 assert.match(host.textContent,/已停止/);assert.doesNotMatch(host.textContent,/处理中/);
});
const doc={documentId:'d1',filename:'report.txt',status:'READY',indexStatus:'READY',summaryStatus:'COMPLETED',chunkCount:12,completedChunks:12,error:null,indexVersion:1,updatedAt:'2026-10-08T00:00:00Z'};

test('document panel shows processing progress, loads whole summary, and pins selected document conversation',async()=>{
 let context;const requests=[];
 globalThis.fetch=async(url,init)=>{requests.push({url:String(url),init});return String(url).endsWith('/summary')?response({status:'COMPLETED',text:'全文尾部目标为 42。',coverage:{completed:12,total:12}}):String(url)==='/api/document-conversations'?response({conversationId:'dc1',documentIds:['d1'],indexVersions:{d1:1}}):response([doc,{...doc,documentId:'d2',filename:'indexing.pdf',indexStatus:'INDEXING',chunkCount:20,completedChunks:8}]);};
 mount(<DocumentPanel baseUrl="" accountScope="owner" signedIn busy={false} onContext={value=>context=value} onLogin={()=>{}}/>);
 await flush();click('文档资料');
 assert.match(host.textContent,/8\/20/);
 const checkboxes=host.querySelectorAll('input[type=checkbox]');assert.equal(checkboxes[1].disabled,true);
 click('查看概要');await flush();assert.match(host.textContent,/全文尾部目标为 42/);
 act(()=>checkboxes[0].click());click('使用选中的');await flush();
 assert.equal(context.conversationId,'dc1');assert.deepEqual(context.indexVersions,{d1:1});
 assert.deepEqual(JSON.parse(requests.find(item=>item.url==='/api/document-conversations').init.body),{documentIds:['d1']});
});

test('clicking a citation fetches source location and accurately labels unavailable page numbers',async()=>{
 const source={id:'s1',documentId:'d1',chunkId:'tail-12',title:'report.txt',page:null,excerpt:'最后一节：目标为 42。'};
 const requests=[];globalThis.fetch=async(url)=>{requests.push(String(url));return response(source);};
 const view={executionId:'e1',requestId:'r1',type:'DOCUMENT_QA',status:'COMPLETED',version:1,lastSeq:8,question:'goal',answer:'42',sources:[source],error:null,roundsUsed:2,roundLimit:4,tokensUsed:123,toolCalls:0};
 mount(<ExecutionDetails msg={{id:'m1',role:'assistant',createdAt:1,content:'42',execution:view}} baseUrl=""/>);
 click('[1]');await flush();
 assert.equal(requests[0],'/api/documents/d1/sources/tail-12');
 assert.match(host.textContent,/页码不可用，已定位到原文片段/);assert.match(host.textContent,/最后一节：目标为 42/);
 assert.doesNotMatch(host.textContent,/第 1 页/);
});
