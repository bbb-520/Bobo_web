import assert from 'node:assert/strict';
import {test,before,afterEach} from 'node:test';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
let createRoot:any,root:any,host:any;
before(async()=>{
 const dom=new JSDOM('<body/>',{url:'https://local.test'});
 for(const key of ['window','document','HTMLElement','HTMLTextAreaElement','localStorage','sessionStorage','Event','KeyboardEvent'])globalThis[key]=dom.window[key];
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 ({createRoot}=await import('react-dom/client'));
});
afterEach(()=>{if(root)act(()=>root.unmount());root=null;host?.remove();});
function render(element:any){if(!root){host=document.createElement('div');document.body.append(host);root=createRoot(host);}act(()=>root.render(element));}
const flush=()=>act(async()=>{await new Promise(done=>setTimeout(done,250));});
const entry={id:'p1',title:'Full prompt',category:'photography',source:'gallery',content:'  Line one\n{ "keep": "格式" }\n\nLast line  ',tags:[],size:'1024x1536',quality:'',sourceRepository:'https://github.com/wuyoscar/GPT-Image2-Skill'};

test('private detail is discarded on logout and never resurrects when the same owner signs in again',async()=>{
 const {usePromptSelection}=await import('../src/hooks/usePromptSelection');let state:any;
 function Harness({owner}:{owner:string}){state=usePromptSelection(owner);return <div>{state.detail?.entry.content??''}</div>;}
 render(<Harness owner="owner-a"/>);act(()=>state.open({...entry,id:'memory:1',source:'visual-memory'}));assert.equal(host.textContent,entry.content);
 render(<Harness owner=""/>);assert.equal(host.textContent,'');render(<Harness owner="owner-b"/>);assert.equal(host.textContent,'');
 render(<Harness owner="owner-a"/>);assert.equal(host.textContent,'');
 act(()=>state.open(entry));render(<Harness owner="owner-b"/>);assert.equal(host.textContent,entry.content);
});

test('gallery filtering supports body, Chinese category keywords and combined category filtering',async()=>{
 const {filterGallery}=await import('../src/lib/promptLibrary');
 const catalog={source:{},categories:[{id:'photography',label:'摄影人像',keywords:['摄影','胶片']},{id:'posters',label:'海报字体',keywords:['海报','复古']}],prompts:[{...entry,content:'RAW subway photo'},{...entry,id:'poster',category:'posters',content:'Design a poster'}]};
 assert.deepEqual(filterGallery(catalog,'subway','all').map(p=>p.id),['p1']);
 assert.deepEqual(filterGallery(catalog,'复古海报','all').map(p=>p.id),['poster']);
 assert.deepEqual(filterGallery(catalog,'复古海报','photography').map(p=>p.id),[]);
});
test('cover configuration rejects active schemes and network-path URLs while allowing owned replacements',async()=>{
 const {safeCoverUrl}=await import('../src/lib/promptLibrary');
 for(const url of ['javascript:alert(1)','data:text/html,x','//evil.test/x','https://a:b@evil.test/x','/../secret'])assert.equal(safeCoverUrl(url),null);
 assert.equal(safeCoverUrl('/prompt-library/covers/a.webp'),'/prompt-library/covers/a.webp');
 assert.equal(safeCoverUrl('https://images.example/a.png'),'https://images.example/a.png');
});
test('detail copy preserves all whitespace and the dialog traps focus and closes on Escape',async()=>{
 const {default:PromptDetail}=await import('../src/components/prompts/PromptDetail');let copied='',closed=0;
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{copied=value;}}});
 const trigger=document.createElement('button');document.body.append(trigger);trigger.focus();
 render(<PromptDetail entry={entry} categoryLabel="摄影人像" onClose={()=>closed++}/>);
 const button=[...host.querySelectorAll('button')].find((item:any)=>item.textContent==='复制提示词') as HTMLButtonElement;
 await act(async()=>button.click());assert.equal(copied,entry.content);assert.match(host.textContent,/已复制/);
 const first=host.querySelector('button') as HTMLButtonElement;first.focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
 assert.notEqual(document.activeElement,trigger);assert.ok(host.contains(document.activeElement));
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(closed,1);
 act(()=>root.unmount());root=null;assert.equal(document.activeElement,trigger);trigger.remove();
});
test('denied clipboard offers the complete selectable text without claiming success',async()=>{
 const {default:PromptDetail}=await import('../src/components/prompts/PromptDetail');
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied');}}});
 render(<PromptDetail entry={entry} categoryLabel="摄影人像" onClose={()=>{}}/>);
 await act(async()=>[...host.querySelectorAll('button')].find((item:any)=>item.textContent==='复制提示词').click());
 const textarea=host.querySelector('textarea');assert.equal(textarea?.value,entry.content);assert.ok(!host.textContent.includes('已复制'));
});
test('private memory query has no owner parameter or paid request and stale owner responses are fenced',async()=>{
 const {useVisualPrompts}=await import('../src/hooks/useVisualPrompts');let state:any,finish:any;const calls:any[]=[];
 globalThis.fetch=async(url:any,init:any)=>{calls.push([String(url),init]);if(calls.length===1)return new Promise(resolve=>finish=()=>resolve(Response.json({items:[{...entry,id:'memory:1',source:'visual-memory',category:'visual-memory',title:'old owner private'}],nextCursor:null})));return Response.json({items:[],nextCursor:null});};
 function Harness({owner}:{owner:string}){state=useVisualPrompts('',owner,'');return <div>{state.items.map((item:any)=>item.title).join(',')}</div>;}
 render(<Harness owner="owner-a"/>);await flush();render(<Harness owner="owner-b"/>);assert.equal(host.textContent,'');await flush();await act(async()=>finish());await flush();
 assert.equal(host.textContent,'');assert.equal(state.items.length,0);assert.ok(calls.every(([url,init])=>!url.includes('owner-')&&(init?.method??'GET')==='GET'));
});
test('signed-out library never queries private memory and an error can retry without losing a loaded page',async()=>{
 const {useVisualPrompts}=await import('../src/hooks/useVisualPrompts');let state:any,calls=0,fail=false;
 globalThis.fetch=async()=>{calls++;if(fail){fail=false;return Response.json({message:'offline'},{status:503});}return Response.json({items:[{...entry,id:'memory:'+calls,source:'visual-memory',category:'visual-memory'}],nextCursor:calls===1?'cursor2':null});};
 function Harness({owner}:{owner:string}){state=useVisualPrompts('',owner,'');return null;}
 render(<Harness owner=""/>);await flush();assert.equal(calls,0);
 render(<Harness owner="owner"/>);await flush();assert.equal(state.items.length,1);fail=true;
 await act(async()=>state.loadMore());assert.equal(state.items.length,1);assert.ok(state.error);
 await act(async()=>state.retry());assert.equal(state.items.length,2);assert.equal(state.error,'');
});
