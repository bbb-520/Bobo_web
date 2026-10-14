import { useEffect,useRef,useState } from 'react';
import { copyPrompt,promptTitle,safeCoverUrl,type PromptEntry } from '../../lib/promptLibrary';
import PromptCover from './PromptCover';

export default function PromptDetail({entry,categoryLabel,imageUrl,onClose,manual=false}:{entry:PromptEntry;categoryLabel:string;imageUrl?:string;onClose:()=>void;manual?:boolean}) {
  const dialog=useRef<HTMLDivElement>(null),text=useRef<HTMLTextAreaElement>(null),closing=useRef(onClose);
  closing.current=onClose;const [copyState,setCopyState]=useState<'idle'|'copied'|'manual'>(manual?'manual':'idle');
  const [copying,setCopying]=useState(false);
  useEffect(()=>{
    const prior=document.activeElement as HTMLElement|null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closing.current();return;}
      if(event.key!=='Tab')return;
      const items=[...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],textarea,[tabindex="0"]')??[])];
      const first=items[0],last=items[items.length-1];if(!first)return;
      if(event.shiftKey&&(document.activeElement===first||!dialog.current?.contains(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!dialog.current?.contains(document.activeElement))){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',keydown);
    return()=>{document.removeEventListener('keydown',keydown);if(prior?.isConnected)prior.focus();};
  },[]);
  useEffect(()=>{if(copyState==='manual'){text.current?.focus();text.current?.select();}},[copyState]);
  const copy=async()=>{if(copying)return;setCopying(true);setCopyState(await copyPrompt(entry)?'copied':'manual');setCopying(false);};
  const provenance=safeCoverUrl(entry.sourceRepository);
  const original=entry.sourceAttribution?.match(/^\[([^\]]+)\]\((https:\/\/[^)]+)\)$/);
  const originalUrl=original?safeCoverUrl(original[2]):null;
  const title=promptTitle(entry);
  return <div className="prompt-detail-backdrop" onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div className="prompt-detail" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="prompt-detail-title" data-prompt-id={entry.id}>
      <button className="prompt-detail-close" type="button" aria-label="关闭提示词详情" onClick={onClose}>×</button>
      <div className="prompt-detail-image"><PromptCover entry={entry} imageUrl={imageUrl}/></div>
      <div className="prompt-detail-panel">
        <div className="prompt-detail-scroll">
          <span className="prompt-source-label">{entry.source==='visual-memory'?'我的视觉记忆 · 仅自己可见':categoryLabel}</span>
          <h2 id="prompt-detail-title">{title}</h2>
          {entry.source==='visual-memory'&&<p className="prompt-memory-explanation">来自你的图片分析和创作要求，可复制后继续修改。</p>}
          <pre className="prompt-detail-text">{entry.content}</pre>
          {(entry.size||entry.quality||entry.tags?.length||entry.subjects?.length)&&<div className="prompt-detail-meta">
            {entry.size&&<span>尺寸 {entry.size}</span>}{entry.quality&&<span>质量 {entry.quality}</span>}
            {(entry.tags?.length?entry.tags:entry.subjects??[]).map((tag,index)=><span key={`${tag}-${index}`}>{tag}</span>)}
          </div>}
          {entry.source==='gallery'&&<div className="prompt-provenance"><span>{entry.author?`作者 ${entry.author}`:'收录于 GPT-Image2-Skill'}</span>{originalUrl?<a href={originalUrl} target="_blank" rel="noreferrer">原始出处 · {original?.[1]}</a>:entry.sourceAttribution&&<span>原始出处 {entry.sourceAttribution}</span>}{provenance&&<a href={provenance} target="_blank" rel="noreferrer">画廊来源</a>}<span>{entry.attribution||'MIT License'}</span></div>}
          {copyState==='manual'&&<div className="prompt-manual-copy" role="status"><p>浏览器未允许自动复制，请选中下方全文手动复制。</p><textarea ref={text} readOnly aria-label="可手动复制的完整提示词" value={entry.content}/></div>}
        </div>
        <footer className="prompt-detail-footer"><span>{copyState==='copied'?'完整提示词已复制':'复制后，回到聊天开始创作'}</span><button className="prompt-copy-primary" type="button" disabled={copying} onClick={()=>void copy()}>{copyState==='copied'?'已复制':copying?'正在复制…':'复制提示词'}</button></footer>
      </div>
    </div>
  </div>;
}
