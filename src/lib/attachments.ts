import type { ImageAttachment } from '../types';
export const DOCUMENT_ACCEPT='.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.markdown,.csv,.json,.html,.htm,.rtf,.odt';
export const IMAGE_CHAT_ACCEPT='image/jpeg,image/png,image/webp,image/gif';
export const IMAGE_CREATION_ACCEPT=IMAGE_CHAT_ACCEPT+',image/bmp,image/tiff';
export const CHAT_ATTACHMENT_ACCEPT=`${IMAGE_CHAT_ACCEPT},${DOCUMENT_ACCEPT}`;
const documents=new Set(DOCUMENT_ACCEPT.split(','));
export const isImageFile=(file:File)=>file.type.startsWith('image/');
export function validateAttachments(files:File[],kind:'chat'|'image'='chat'):string|null {
  if(kind==='image'&&(files.length>1||files.some(file=>!isImageFile(file))))return '图片生成最多支持一张参考图片，不支持文档附件。';
  if(files.length>8)return '每条消息最多添加 8 个附件。';
  if(files.filter(isImageFile).length>3)return '每条消息最多添加 3 张图片。';
  for(const file of files) {
    const image=isImageFile(file),extension='.'+(file.name.split('.').at(-1)?.toLowerCase()??'');
    if(image&&!(kind==='image'?IMAGE_CREATION_ACCEPT:IMAGE_CHAT_ACCEPT).split(',').includes(file.type.toLowerCase()))return `${file.name}：不支持此图片格式，聊天支持 JPEG、PNG、WebP、GIF。`;
    if(!image&&!documents.has(extension))return `${file.name}：不支持此文档格式。`;
    if(!file.size)return `${file.name}：请选择有内容的文件。`;
    if(file.size>(image?20:100)*1024*1024)return `${file.name}：${image?'图片最多 20':'文档最多 100'} MiB。`;
  }
  return null;
}
export const attachmentQuestion=(text:string,files:File[],kind:'chat'|'image'='chat')=>text.trim()||(kind==='image'?'请根据这张照片进行一次有创意的二次生成。':files.some(file=>!isImageFile(file))?'请概述这些文档的主要内容。'+(files.some(isImageFile)?'请结合图片进行说明。':''):'请描述这些图片的内容。');
export const imageReference=({assetId,fileName,mimeType,fileSize}:ImageAttachment):ImageAttachment=>({assetId,fileName,mimeType,fileSize});
