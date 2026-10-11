import assert from 'node:assert/strict';
import {test,before,afterEach} from 'node:test';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
let createRoot:any,AdminPanel:any,root:any,host:HTMLElement;
before(async()=>{
  const dom=new JSDOM('<body></body>',{url:'http://localhost'});
  for(const k of ['window','document','HTMLElement','Event'])Object.defineProperty(globalThis,k,{value:(dom.window as any)[k],configurable:true});
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  ({createRoot}=await import('react-dom/client'));AdminPanel=(await import('../src/components/AdminPanel')).default;
});
afterEach(()=>{if(root)act(()=>root.unmount());host?.remove();root=null;});
const flush=()=>act(async()=>{await new Promise(r=>setTimeout(r,0));});
function render(user:any,strict=false){if(!root){host=document.createElement('div');document.body.append(host);root=createRoot(host);}const panel=<AdminPanel key={user.userId} user={user} baseUrl="" onUser={()=>{}}/>;act(()=>root.render(strict?<React.StrictMode>{panel}</React.StrictMode>:panel));}
test('ordinary user has no management entry',async()=>{
  let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({});};
  render({userId:'ordinary',username:'alice',permissions:['chat:use']});await flush();
  assert.equal(host.textContent,'');assert.equal(calls,0);
});
test('account switch hides old users even when an aborted response arrives late',async()=>{
  let finish:any;
  globalThis.fetch=async()=>new Promise(resolve=>{finish=resolve;});
  render({userId:'super',username:'bbb',roles:['SUPER_ADMIN'],permissions:['user:read']});
  await flush();render({userId:'ordinary',username:'alice',permissions:['chat:use']});
  await act(async()=>{finish(Response.json({items:[{id:7,username:'secret-user',roles:[]}],total:1}));});
  assert.equal(host.textContent,'');
});
test('audit-only role can enter audit without requesting users',async()=>{
  const calls:string[]=[];
  globalThis.fetch=async(url)=>{calls.push(String(url));return Response.json({items:[],total:0});};
  render({userId:'auditor',username:'audit',roles:['AUDITOR'],permissions:['audit:read']});await flush();
  assert.match(host.textContent??'',/平台管理/);
  assert.deepEqual(calls,['/api/admin/audits?page=0&size=20']);
});
test('StrictMode cleanup does not cancel later permission refresh',async()=>{
  const calls:string[]=[];const user={userId:'admin',username:'bbb',roles:['ADMIN'],permissions:['user:read']};
  globalThis.fetch=async(url)=>{calls.push(String(url));return Response.json(String(url)==='/api/auth/me'?user:{items:[],total:0});};
  render(user,true);await flush();
  const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='刷新权限与数据')!;
  await act(async()=>{button.click();await new Promise(r=>setTimeout(r,0));});
  assert.equal(calls.filter(p=>p==='/api/auth/me').length,1);
});
