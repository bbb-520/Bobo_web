import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const bundle=await build({entryPoints:['src/components/photo-archive.ts'],bundle:true,write:false,format:'esm',loader:{'.jpg':'dataurl'}});
const {fetchPhotoArchive}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
test('author album loads the OSS manifest and uses the same-origin image route',async () => {
  globalThis.fetch=async ()=>Response.json([{filename:'a b.jpg',size:123}]);
  const photos=await fetchPhotoArchive();
  assert.equal(photos.length,1);
  assert.equal(photos[0].filename,'a b.jpg');
  assert.equal(photos[0].src,'/api/photo-archive/a%20b.jpg');
});
test('an unavailable OSS album reports the failure instead of substituting unrelated photos',async () => {
  globalThis.fetch=async ()=>Response.json({message:'OSS 相册暂不可用'},{status:503});
  await assert.rejects(fetchPhotoArchive(),/OSS 相册暂不可用/);
});
