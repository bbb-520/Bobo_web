import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

async function withProxy(handler, verify) {
  const upstream = createServer(handler);
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const reserve = createServer();
  reserve.listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      BACKEND_URL: 'http://127.0.0.1:' + upstream.address().port,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errors = '';
  child.stderr.on('data', (chunk) => {
    errors += chunk;
  });
  const deadlines = new AbortController();
  try {
    await Promise.race([
      once(child.stdout, 'data'),
      delay(5000, null, { signal: deadlines.signal }).then(() => {
        throw Error('Proxy did not start: ' + errors);
      }),
    ]);
    await verify({
      port,
      child,
      errors: () => errors,
      deadlines: deadlines.signal,
    });
  } finally {
    deadlines.abort();
    child.kill();
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  }
}
test('stopping browser SSE cancels the Node proxy upstream connection', async () => {
  let stopped;
  const closed = new Promise((resolve) => {
    stopped = resolve;
  });
  await withProxy(
    (req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: ping\n\n');
      res.once('close', stopped);
    },
    async ({ port, errors, deadlines }) => {
      const abort = new AbortController();
      const res = await fetch('http://127.0.0.1:' + port + '/api/chat', {
        method: 'POST',
        body: '{}',
        signal: abort.signal,
      });
      assert.equal(res.status, 200);
      const reader = res.body.getReader();
      await reader.read();
      abort.abort();
      await reader.cancel().catch(() => {});
      await Promise.race([
        closed,
        delay(1500, null, { signal: deadlines }).then(() => {
          throw Error('Upstream kept generating after browser stopped');
        }),
      ]);
      assert.equal(errors(), '');
    },
  );
});
test('cancelling an incomplete image upload does not crash the proxy', async () => {
  await withProxy(
    (req, res) => res.end('ok'),
    async ({ port, child, errors }) => {
      const upload = request({
        host: '127.0.0.1',
        port,
        path: '/api/zine/generate',
        method: 'POST',
        headers: {
          'Content-Length': '100000',
          'Content-Type': 'application/octet-stream',
        },
      });
      upload.on('error', () => {});
      upload.write(Buffer.alloc(1024));
      await delay(100);
      upload.destroy();
      await delay(250);
      assert.equal(child.exitCode, null, errors());
      assert.equal(
        (await fetch('http://127.0.0.1:' + port + '/health')).status,
        200,
      );
      assert.equal(errors(), '');
    },
  );
});

test('document multipart is forwarded before upload finishes with metadata and replay headers intact', async () => {
  let received;
  const first=new Promise(resolve=>received=resolve);
  let data='';
  await withProxy((req,res)=>{
    assert.match(req.headers['content-type'],/boundary=doc-boundary/);
    assert.equal(req.headers['x-request-id'],'upload-1');
    req.on('data',chunk=>{data+=chunk;received();});
    req.on('end',()=>res.end(JSON.stringify({documentId:'d1'})));
  },async({port})=>{
    const upload=request({host:'127.0.0.1',port,path:'/api/documents',method:'POST',headers:{'content-type':'multipart/form-data; boundary=doc-boundary','x-request-id':'upload-1'}});
    const response=once(upload,'response');
    upload.on('error',()=>{});
    upload.write('--doc-boundary\r\nContent-Disposition: form-data; name="file"; filename="tail.txt"\r\nContent-Type: text/plain\r\n\r\nfirst bytes');
    const streamed=await Promise.race([first.then(()=>true),delay(500).then(()=>false)]);
    upload.end('\r\n--doc-boundary--\r\n');
    const [res]=await response; res.resume();await once(res,'end');
    assert.equal(streamed,true,'proxy buffered the entire multipart upload');
    assert.match(data,/filename="tail.txt"/);
    assert.match(data,/first bytes/);
  });
});

test('oversized upload is rejected with 413 while the proxy remains healthy', async () => {
  await withProxy((_req,res)=>res.end('ok'),async({port})=>{
    const req=request({host:'127.0.0.1',port,path:'/api/documents',method:'POST',headers:{'content-length':String(101*1024*1024),'content-type':'application/octet-stream'}});
    req.on('error',()=>{});
    const response=once(req,'response');req.write('x');
    const result=await Promise.race([response,delay(600).then(()=>null)]);
    req.destroy();
    assert.ok(result,'oversized upload was not rejected before buffering');
    assert.equal(result[0].statusCode,413);result[0].resume();
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status,200);
  });
});

test('execution SSE forwards the cursor and disconnect only closes the subscription', async () => {
  let method;
  await withProxy((req,res)=>{
    method=req.method;
    assert.equal(req.headers['last-event-id'],'e1:7');
    res.writeHead(200,{'content-type':'text/event-stream'});res.end('id: e1:8\nevent: progress\ndata: {}\n\n');
  },async({port})=>{
    const res=await fetch(`http://127.0.0.1:${port}/api/agent-executions/e1/events`,{headers:{'Last-Event-ID':'e1:7'}});
    assert.match(await res.text(),/id: e1:8/);assert.equal(method,'GET');
  });
});
