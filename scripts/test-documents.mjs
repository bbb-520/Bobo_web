import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
let documents;
try {documents=await import('../src/api/documents.ts');}catch{}
test('document upload preserves multipart filename and request ID and rejects over 100 MiB before dispatch',async()=>{
  assert.ok(documents,'document upload API is implemented');
  const calls=[];const original=fetch;
  globalThis.fetch=async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify({documentId:'d1'}));};
  try {
    await documents.uploadDocument(new File(['tail'],'report.txt',{type:'text/plain'}),'r-upload','',new AbortController().signal);
    assert.equal(calls[0].url,'/api/documents');
    assert.equal(new Headers(calls[0].init.headers).get('X-Request-ID'),'r-upload');
    assert.equal(calls[0].init.body.get('file').name,'report.txt');
    assert.equal(new Headers(calls[0].init.headers).get('Content-Type'),null,'browser must supply multipart boundary');
    await assert.rejects(documents.uploadDocument({size:100*1024*1024+1},'r2',''),/100 MiB/);
    assert.equal(calls.length,1);
  }finally{globalThis.fetch=original;}
});
test('source lookup encodes document and chunk location without inventing pages',async()=>{
  assert.ok(documents,'source location API is implemented');
  const calls=[];const original=fetch;
  globalThis.fetch=async(url)=>{calls.push(url);return new Response(JSON.stringify({documentId:'d/1',chunkId:'c 2',page:null,excerpt:'tail evidence'}));};
  try{const source=await documents.documentApi('').source('d/1','c 2');assert.equal(calls[0],'/api/documents/d%2F1/sources/c%202');assert.equal(source.page,null);assert.equal(source.excerpt,'tail evidence');}finally{globalThis.fetch=original;}
});
test('multipart file bytes enforce the limit independently from boundary overhead',async()=>{
  const {createUploadLimiter}=await import('../upload-stream.mjs');
  const allowed=createUploadLimiter('multipart/form-data; boundary=unit',8);
  const output=[];allowed.on('data',chunk=>output.push(chunk));
  const prefix='--unit\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n\r\n';
  const ending='\r\n--unit--\r\n';
  const ended=once(allowed,'end');for(const c of prefix+'12345678'+ending)allowed.write(c);allowed.end();await ended;
  assert.equal(Buffer.concat(output).toString(),prefix+'12345678'+ending);
  const denied=createUploadLimiter('multipart/form-data; boundary=unit',8);denied.resume();
  const failed=once(denied,'error');denied.end(prefix+'123456789'+ending);
  assert.equal((await failed)[0].status,413);
});
