import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { IconPlus, IconSend, IconStop } from './icons';
import { billingWarningMessage, formatTokens, generationBlockReason, type Wallet } from '../lib/billing';
import { CHAT_ATTACHMENT_ACCEPT, IMAGE_CREATION_ACCEPT, isImageFile, validateAttachments } from '../lib/attachments';
import { CHAT_MODES, MODE_LABELS, needsImageIntent, resolveChatMode, type ChatMode, type ChatModeContext } from '../lib/chatModes';
interface Props {
  value:string;onChange:(v:string)=>void;onSend:(files?:File[],kind?:ChatMode)=>Promise<boolean>;
  wallet:Wallet|null;signedIn:boolean;onOpenAccount:()=>void;onStop:()=>void;running:boolean;
  context?:ChatModeContext;
}
export default function Composer({value,onChange,onSend,onStop,running,wallet,signedIn,onOpenAccount,context={}}:Props) {
  const taRef=useRef<HTMLTextAreaElement>(null),fileRef=useRef<HTMLInputElement>(null),composingRef=useRef(false),sendingRef=useRef(false);
  const helpRef=useRef<HTMLDivElement>(null),helpButtonRef=useRef<HTMLButtonElement>(null),modeId=useId(),helpId=useId();
  const [helpOpen,setHelpOpen]=useState(false);
  const [checking,setChecking]=useState(false),[kind,setKind]=useState<ChatMode>('chat'),[files,setFiles]=useState<File[]>([]),[previews,setPreviews]=useState<(string|null)[]>([]),[error,setError]=useState('');
  const classifying=needsImageIntent(value,files,kind,context);
  const route=resolveChatMode(value,files,kind,{...context,...(classifying?{imageIntent:'DESCRIBE' as const}:{})}),modeInfo=CHAT_MODES.find(mode=>mode.id===kind)!;
  const fileHelp=kind==='image'?'支持纯文字生图，或一张参考图片（最多 20 MiB）。':kind==='text'?'本次仅使用文字上下文。':kind==='vision'?'最多 3 张图片，每张 20 MiB；不填写文字时自动描述图片。':'最多 8 个附件，其中图片最多 3 张、每张 20 MiB；文档每份 100 MiB。扫描 PDF 暂不支持 OCR。';
  useEffect(()=>{
    if(!helpOpen)return;
    const outside=(event:PointerEvent)=>{if(!helpRef.current?.contains(event.target as Node))setHelpOpen(false);};
    const escape=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape'){setHelpOpen(false);helpButtonRef.current?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[helpOpen]);
  useEffect(()=>{const urls=files.map(file=>isImageFile(file)?URL.createObjectURL(file):null);setPreviews(urls);return()=>urls.forEach(url=>url&&URL.revokeObjectURL(url));},[files]);
  const chooseFiles=(added:File[])=>{
    if(running||checking||!added.length)return;
    const next=[...files,...added],reason=validateAttachments(next,kind==='image'?'image':'chat');
    if(reason){setError(reason);return;}setError('');setFiles(next);
  };
  const blocked=signedIn?generationBlockReason(wallet,classifying?'CHAT':route.capability):null;
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
    <p id={`${modeId}-description`} className="visually-hidden">{modeInfo.description}</p>
    <textarea ref={taRef} rows={1} value={value} aria-label="消息输入框" aria-describedby={`${modeId}-description`} placeholder={running?'正在处理…':modeInfo.placeholder} onChange={event=>{onChange(event.target.value);event.target.style.height='auto';event.target.style.height=Math.min(event.target.scrollHeight,176)+'px';}} onKeyDown={onKeyDown} onCompositionStart={()=>{composingRef.current=true;}} onCompositionEnd={()=>{composingRef.current=false;}} onPaste={event=>chooseFiles(Array.from(event.clipboardData.files))} disabled={running||checking}/>
    {route.automatic&&<div className="composer-mode-switch" role="status">本次使用{MODE_LABELS[route.mode]}<span>自动识别</span></div>}
    {error&&<div className="composer-attachment-error" role="alert">{error}</div>}
    {route.error&&route.error!==error&&<div className="composer-attachment-error" role="status">{route.error}</div>}
    <div className="composer-row">
      <div className="composer-tools">
        <button type="button" className="attach-btn" onClick={()=>fileRef.current?.click()} disabled={running||checking} aria-label="添加附件" title="添加图片或文件"><IconPlus size={19}/></button>
        <div className="composer-mode"><label htmlFor={modeId} className="visually-hidden">聊天模式</label><select id={modeId} aria-describedby={`${modeId}-description`} value={kind} onChange={event=>{setKind(event.target.value as ChatMode);setError('');}} disabled={running||checking}>{CHAT_MODES.map(mode=><option key={mode.id} value={mode.id}>{mode.label}</option>)}</select></div>
      </div>
      <div className="composer-actions">
        <span className="composer-key-hint" aria-hidden="true">Enter 发送</span>
        <div className="composer-help-anchor" ref={helpRef}>
          <button type="button" ref={helpButtonRef} className="composer-help-button" aria-label="输入说明" title="模式、附件与快捷键" aria-expanded={helpOpen} aria-controls={helpOpen?helpId:undefined} onClick={()=>setHelpOpen(open=>!open)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .3c0 1.7-2.5 2-2.5 3.7"/><circle cx="12" cy="16.5" r=".8" fill="currentColor" stroke="none"/></svg></button>
          {helpOpen&&<div id={helpId} className="composer-help-panel" role="region" aria-label="输入说明内容"><strong>{modeInfo.label}</strong><p>{modeInfo.description}</p><p>{fileHelp}</p><div className="composer-help-shortcuts"><span><kbd>Enter</kbd> 发送</span><span><kbd>Shift + Enter</kbd> 换行</span></div></div>}
        </div>
        {running?<button className="send-btn stop" onClick={onStop} title="停止生成" aria-label="停止生成"><IconStop size={17}/></button>:<button className="send-btn" onClick={()=>void submit()} disabled={checking||Boolean(blocked)||invalid||(!files.length&&!value.trim())} title="发送" aria-label="发送"><IconSend size={17}/></button>}
      </div>
    </div>
    <input ref={fileRef} className="visually-hidden" type="file" multiple={kind!=='image'} accept={kind==='image'?IMAGE_CREATION_ACCEPT:kind==='vision'?'image/jpeg,image/png,image/webp,image/gif':CHAT_ATTACHMENT_ACCEPT} onChange={event=>{chooseFiles(Array.from(event.target.files??[]));event.currentTarget.value='';}}/>
  </div>{signedIn&&<div className="composer-billing-note"><span>{blocked??(wallet&&billingWarningMessage(wallet))??(kind==='image'?`图片优先使用旧图片次数或通用免费 Token；实际用量未返回时按图片价格折算额度。`:(wallet?.freeTokens??0)>0?`通用免费额度剩余 ${formatTokens(wallet!.freeTokens!)} Token；文档索引和概要也消耗此额度。`:'按实际用量扣费；已受理请求停止等待后仍需结算。')}</span><button type="button" onClick={onOpenAccount}>账户 / 充值</button></div>}</div>;
}
