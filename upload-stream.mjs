import { Transform } from 'node:stream';
export const MAX_UPLOAD_BYTES=100*1024*1024;

/** Transparent bounded multipart inspection: only headers and a boundary tail are held. */
export function createUploadLimiter(contentType='',limit=MAX_UPLOAD_BYTES) {
  const match=/multipart\/form-data\s*;.*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary=match?.[1]??match?.[2];
  if(boundary&&(!/^[\x20-\x7e]{1,200}$/.test(boundary)))throw new Error('Invalid multipart boundary');
  let total=0,pending=Buffer.alloc(0),state='start',partBytes=0,isFile=false;
  const opening=boundary?Buffer.from(`--${boundary}\r\n`):null;
  const divider=boundary?Buffer.from(`\r\n--${boundary}`):null;
  const fail=(message,status=413)=>Object.assign(new Error(message),{status});
  const count=bytes=>{partBytes+=bytes;if(partBytes>(isFile?limit:65536))throw fail(isFile?'文件超过 100 MiB 限制':'表单字段过大');};
  const inspect=chunk=>{
    pending=Buffer.concat([pending,chunk]);
    while(true) {
      if(state==='end'){pending=Buffer.alloc(0);return;}
      if(state==='start') {if(pending.length<opening.length)return;if(!pending.subarray(0,opening.length).equals(opening))throw fail('无效的 multipart 请求',400);pending=pending.subarray(opening.length);state='headers';}
      if(state==='headers') {
        const end=pending.indexOf('\r\n\r\n');
        if(end<0){if(pending.length>16384)throw fail('上传元数据过大');return;}
        if(end>16384)throw fail('上传元数据过大');
        const headers=pending.subarray(0,end).toString('latin1');
        isFile=/content-disposition:[^\r\n]*\bfilename\*?=/i.test(headers);
        partBytes=0;pending=pending.subarray(end+4);state='body';
      }
      if(state==='body') {
        const end=pending.indexOf(divider);
        if(end<0) {const consumed=Math.max(0,pending.length-divider.length-2);count(consumed);pending=pending.subarray(consumed);return;}
        count(end);pending=pending.subarray(end+divider.length);state='boundary';
      }
      if(state==='boundary') {
        if(pending.length<2)return;
        const suffix=pending.subarray(0,2).toString();pending=pending.subarray(2);
        if(suffix==='--'){state='end';continue;}
        if(suffix!=='\r\n')throw fail('无效的 multipart 边界',400);
        state='headers';
      }
    }
  };
  return new Transform({
    transform(chunk,_encoding,callback) {
      try {
        total+=chunk.length;
        if(total>limit+(boundary?1024*1024:0))throw fail('上传超过 100 MiB 限制');
        if(boundary)inspect(chunk);
        callback(null,chunk);
      } catch(error){callback(error);}
    },
    flush(callback) {callback(boundary&&state!=='end'?fail('上传未完成',400):null);},
  });
}
