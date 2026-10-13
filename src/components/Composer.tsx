import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { IconSend, IconStop } from './icons';
import { billingWarningMessage, formatTokens, generationBlockReason, type Wallet } from '../lib/billing';
import { CHAT_ATTACHMENT_ACCEPT, IMAGE_CREATION_ACCEPT, isImageFile, validateAttachments } from '../lib/attachments';
import { CHAT_MODES, MODE_LABELS, resolveChatMode, type ChatMode, type ChatModeContext } from '../lib/chatModes';
interface Props {
  value:string;onChange:(v:string)=>void;onSend:(files?:File[],kind?:ChatMode)=>Promise<boolean>;
  wallet:Wallet|null;signedIn:boolean;onOpenAccount:()=>void;onStop:()=>void;running:boolean;
  context?:ChatModeContext;
}
export default function Composer({value,onChange,onSend,onStop,running,wallet,signedIn,onOpenAccount,context={}}:Props) {
  const taRef=useRef<HTMLTextAreaElement>(null),fileRef=useRef<HTMLInputElement>(null),composingRef=useRef(false),sendingRef=useRef(false);
  const [checking,setChecking]=useState(false),[kind,setKind]=useState<ChatMode>('chat'),[files,setFiles]=useState<File[]>([]),[previews,setPreviews]=useState<(string|null)[]>([]),[error,setError]=useState('');
  const route=resolveChatMode(value,files,kind,context),modeInfo=CHAT_MODES.find(mode=>mode.id===kind)!;
  useEffect(()=>{const urls=files.map(file=>isImageFile(file)?URL.createObjectURL(file):null);setPreviews(urls);return()=>urls.forEach(url=>url&&URL.revokeObjectURL(url));},[files]);
  const chooseFiles=(added:File[])=>{
    if(running||checking||!added.length)return;
    const next=[...files,...added],reason=validateAttachments(next,kind==='image'?'image':'chat');
    if(reason){setError(reason);return;}setError('');setFiles(next);
  };
  const blocked=signedIn?generationBlockReason(wallet,route.capability):null;
  const invalid=Boolean(route.error);
  const submit=async()=>{
    if(running||sendingRef.current||blocked||invalid||(!files.length&&!value.trim()))return;
    sendingRef.current=true;setChecking(true);
    try{if(await onSend(files.length?files:undefined,kind)){onChange('');setFiles([]);setError('');requestAnimationFrame(()=>{if(taRef.current)taRef.current.style.height='auto';});}}
    finally{sendingRef.current=false;setChecking(false);}
  };
  const onKeyDown=(event:KeyboardEvent<HTMLTextAreaElement>)=>{if(event.key==='Enter'&&!event.shiftKey&&!composingRef.current&&!event.nativeEvent.isComposing){event.preventDefault();void submit();}};
  return <div className="composer-wrap"><div className="composer-inner" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();chooseFiles(Array.from(event.dataTransfer.files));}}>
    <div className="composer-attachments">{files.map((file,index)=><div className="composer-attachment" key={`${file.name}-${index}`} title={file.name}>
      {previews[index]?<img src={previews[index]!} alt="待上传图片预览"/>:<span aria-hidden="true">▤</span>}<span>{file.name}</span><button type="button" disabled={running||checking} onClick={()=>{setFiles(items=>items.filter((_,i)=>i!==index));setError('');}} aria-label={`移除附件 ${file.name}`}>×</button>
    </div>)}</div>
    <div className="composer-mode"><label htmlFor="creation-mode">模式</label><select id="creation-mode" aria-describedby="creation-mode-description" value={kind} onChange={event=>{setKind(event.target.value as ChatMode);setError('');}} disabled={running||checking}>{CHAT_MODES.map(mode=><option key={mode.id} value={mode.id}>{mode.label}</option>)}</select>{route.automatic&&<span className="composer-mode-switch" role="status">本次自动使用：{MODE_LABELS[route.mode]}</span>}</div>
    <p id="creation-mode-description" className="composer-mode-description">{modeInfo.description}</p>
    {error&&<div className="composer-attachment-error" role="alert">{error}</div>}
    {route.error&&route.error!==error&&<div className="composer-attachment-error" role="status">{route.error}</div>}
    <textarea ref={taRef} rows={1} value={value} placeholder={running?'正在处理，可点击停止…':modeInfo.placeholder} onChange={event=>{onChange(event.target.value);event.target.style.height='auto';event.target.style.height=Math.min(event.target.scrollHeight,176)+'px';}} onKeyDown={onKeyDown} onCompositionStart={()=>{composingRef.current=true;}} onCompositionEnd={()=>{composingRef.current=false;}} onPaste={event=>chooseFiles(Array.from(event.clipboardData.files))} disabled={running||checking}/>
    <div className="composer-row"><div className="composer-hint"><button type="button" className="attach-btn" onClick={()=>fileRef.current?.click()} disabled={running||checking}>＋ 附件</button><span>Enter 发送 · Shift+Enter 换行</span></div>{running?<button className="send-btn stop" onClick={onStop} title="停止生成" aria-label="停止生成"><IconStop size={17}/></button>:<button className="send-btn" onClick={()=>void submit()} disabled={checking||Boolean(blocked)||invalid||(!files.length&&!value.trim())} title="发送" aria-label="发送"><IconSend size={17}/></button>}</div>
    <input ref={fileRef} className="visually-hidden" type="file" multiple={kind!=='image'} accept={kind==='image'?IMAGE_CREATION_ACCEPT:kind==='vision'?'image/jpeg,image/png,image/webp,image/gif':CHAT_ATTACHMENT_ACCEPT} onChange={event=>{chooseFiles(Array.from(event.target.files??[]));event.currentTarget.value='';}}/>
    <small className="composer-file-help">{kind==='image'?'支持纯文字生图，或一张参考图片（最多 20 MiB）。':kind==='text'?'本次仅使用文字上下文。':kind==='vision'?'最多 3 张图片，每张 20 MiB；不填写文字时自动描述图片。':'最多 8 个附件，其中图片最多 3 张、每张 20 MiB；文档每份 100 MiB。扫描 PDF 暂不支持 OCR。'}</small>
  </div>{signedIn&&<div className="composer-billing-note"><span>{blocked??(wallet&&billingWarningMessage(wallet))??(kind==='image'?`图片优先使用旧图片次数或通用免费 Token；实际用量未返回时按图片价格折算额度。`:(wallet?.freeTokens??0)>0?`通用免费额度剩余 ${formatTokens(wallet!.freeTokens!)} Token；文档索引和概要也消耗此额度。`:'按实际用量扣费；已受理请求停止等待后仍需结算。')}</span><button type="button" onClick={onOpenAccount}>账户 / 充值</button></div>}</div>;
}
