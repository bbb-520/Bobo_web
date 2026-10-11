import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {csrfFetch} from '../src/lib/http.ts';
const original=globalThis.fetch;afterEach(()=>globalThis.fetch=original);
test('unsafe JSON, multipart and SSE requests carry the server CSRF token',async()=>{
  const calls=[];
  globalThis.fetch=async(url,init)=>{
    calls.push([url,init]);
    if(String(url).endsWith('/api/auth/csrf'))return Response.json({token:'server-token',headerName:'X-XSRF-TOKEN'});
    assert.equal(new Headers(init.headers).get('X-XSRF-TOKEN'),'server-token');
    assert.equal(init.credentials,'include');return Response.json({ok:true});
  };
  await csrfFetch('','/api/chat',{method:'POST',headers:{Accept:'text/event-stream'},body:'{}'});
  await csrfFetch('','/api/documents',{method:'POST',body:new FormData()});
  assert.equal(calls.filter(([url])=>url==='/api/auth/csrf').length,2);
});
test('failed CSRF initialization never sends a mutation and GET needs no token',async()=>{
  const calls=[];globalThis.fetch=async(url)=>{calls.push(url);return new Response('',{status:503});};
  await assert.rejects(()=>csrfFetch('','/api/admin/users/1/status',{method:'PUT'}));
  assert.deepEqual(calls,['/api/auth/csrf']);calls.length=0;
  await csrfFetch('','/api/chat',{method:'GET'});assert.deepEqual(calls,['/api/chat']);
});
test('account cancellation during CSRF handshake prevents mutation dispatch',async()=>{
  let complete;const calls=[];const controller=new AbortController();
  globalThis.fetch=async(url)=>{calls.push(url);return new Promise(resolve=>complete=resolve);};
  const pending=csrfFetch('','/api/chat',{method:'POST',signal:controller.signal});
  controller.abort();await assert.rejects(()=>pending);
  complete(Response.json({token:'old',headerName:'X-XSRF-TOKEN'}));
  await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(calls,['/api/auth/csrf']);
});
test('progress document upload carries CSRF and leaves multipart boundary to the browser',async()=>{
  const {uploadDocument}=await import('../src/api/documents.ts');
  const saved=globalThis.XMLHttpRequest;let sent;
  class Xhr {
    upload={};headers=new Headers();status=200;responseText='{"documentId":"progress"}';
    open(method,url){this.method=method;this.url=url;}
    setRequestHeader(k,v){this.headers.set(k,v);}
    send(body){sent=this;this.body=body;queueMicrotask(()=>{this.onload();this.onloadend();});}
    abort(){this.onabort();this.onloadend();}
  }
  globalThis.XMLHttpRequest=Xhr;
  globalThis.fetch=async()=>Response.json({token:'xhr-token',headerName:'X-XSRF-TOKEN'});
  try{
    await uploadDocument(new File(['data'],'report.txt'),'upload-progress','',undefined,()=>{});
    assert.equal(sent.headers.get('X-XSRF-TOKEN'),'xhr-token');
    assert.equal(sent.headers.get('X-Request-ID'),'upload-progress');
    assert.equal(sent.headers.get('Content-Type'),null);
    assert.equal(sent.body.get('file').name,'report.txt');
  }finally{globalThis.XMLHttpRequest=saved;}
});
