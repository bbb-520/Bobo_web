import { createServer } from 'node:http';
import { createReadStream, existsSync, promises as fs } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { createUploadLimiter, MAX_UPLOAD_BYTES } from './upload-stream.mjs';

const port = Number.parseInt(process.env.PORT ?? '5173', 10);
const backendUrl = (
  process.env.BACKEND_URL ?? 'http://localhost:18000'
).replace(/\/+$/, '');
const root = resolve(process.env.STATIC_DIR ?? 'dist');
const indexFile = join(root, 'index.html');
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function safeStaticPath(urlPath) {
  const candidate = normalize(
    join(root, decodeURIComponent(urlPath.replace(/^\/+/, ''))),
  );
  return candidate === root ||
    candidate.startsWith(`${root}\\`) ||
    candidate.startsWith(`${root}/`)
    ? candidate
    : null;
}

async function proxyApi(req, res) {
  // Closing an execution subscription only disconnects SSE; the stop API is explicit.
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableFinished) controller.abort();
  };
  res.once('close', onClose);
  const onAborted=()=>controller.abort();
  req.once('aborted',onAborted);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers))
    if (value && !['host', 'content-length', 'connection', 'transfer-encoding'].includes(key))
      headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  let upload;
  let uploadError;
  try {
    const hasBody=!['GET','HEAD'].includes(req.method);
    const multipart=/^multipart\/form-data/i.test(req.headers['content-type']??'');
    if(hasBody&&Number(req.headers['content-length'])>MAX_UPLOAD_BYTES+(multipart?1024*1024:0)) {
      req.resume();res.writeHead(413,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify({message:'上传超过 100 MiB 限制'}));return;
    }
    if(hasBody) {
      upload=createUploadLimiter(req.headers['content-type']);
      upload.on('error',error=>{uploadError=error;controller.abort();});
      req.on('error',error=>{upload.destroy(error);});
      req.pipe(upload);
    }
    const upstream = await fetch(`${backendUrl}${req.url}`, {
      method: req.method,
      headers,
      body:upload,
      ...(upload?{duplex:'half'}:{}),
      redirect: 'manual',
      signal: controller.signal,
    });
    res.writeHead(upstream.status, Object.fromEntries(upstream.headers));
    if (upstream.body)
      Readable.fromWeb(upstream.body)
        .on('error', () => res.destroy())
        .pipe(res);
    else res.end();
  } catch (error) {
    if(uploadError&&!res.destroyed) {
      req.unpipe(upload);req.resume();
      res.writeHead(uploadError.status??400,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify({message:uploadError.message}));return;
    }
    if (controller.signal.aborted || req.aborted || res.destroyed) return;
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        message: `无法连接后端 ${backendUrl}`,
        cause: error instanceof Error ? error.message : String(error),
      }),
    );
  } finally {req.off('aborted',onAborted);if(controller.signal.aborted){req.unpipe(upload);upload?.destroy();}}
}

const server = createServer(async (req, res) => {
  if (!req.url) return res.writeHead(400).end();
  if (req.url === '/health') {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    return res.end(
      JSON.stringify({
        status: 'UP',
        service: 'agent-web',
        backend: backendUrl,
      }),
    );
  }
  if (req.url === '/api' || req.url.startsWith('/api/'))
    return proxyApi(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD')
    return res.writeHead(405).end();
  const pathname = new URL(req.url, 'http://localhost').pathname;
  let file = safeStaticPath(pathname);
  if (!file || !existsSync(file) || !(await fs.stat(file)).isFile())
    file = indexFile;
  try {
    const stat = await fs.stat(file);
    res.writeHead(200, {
      'content-type':
        contentTypes[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': stat.size,
      'cache-control':
        file === indexFile ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end('Not Found');
  }
});
server.listen(port, '0.0.0.0', () =>
  console.log(`agent-web listening on :${port}, backend=${backendUrl}`),
);
