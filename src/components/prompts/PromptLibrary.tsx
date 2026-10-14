import { useEffect,useMemo,useRef,useState } from 'react';
import type { AuthUser } from '../../lib/auth';
import { copyPrompt,filterGallery,loadCoverOverrides,loadGallery,promptTitle,type GalleryCatalog,type PromptEntry } from '../../lib/promptLibrary';
import { useVisualPrompts } from '../../hooks/useVisualPrompts';
import { usePromptSelection } from '../../hooks/usePromptSelection';
import PillNav from '../PillNav';
import boboMark from '../../assets/bobo-mark.svg';
import PromptCover from './PromptCover';
import PromptDetail from './PromptDetail';
import './prompt-library.css';

interface Props {baseUrl:string;user:AuthUser|null;suspended?:boolean;onClose:()=>void;onHome:()=>void;onSettings:()=>void;onProfile:()=>void;onLogin:()=>void;}
const CopyIcon=({done=false}:{done?:boolean})=><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{done?<path d="m5 12 4 4L19 6"/>:<><rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>}</svg>;

function PromptCard({entry,label,imageUrl,copied,onOpen,onCopy}:{entry:PromptEntry;label:string;imageUrl?:string;copied:boolean;onOpen:()=>void;onCopy:()=>void}) {
  const title=promptTitle(entry);
  return <article className="prompt-card" data-category={entry.category}>
    <button className="prompt-card-open" type="button" onClick={onOpen} aria-label={`查看 ${title}`}>
      <PromptCover entry={entry} imageUrl={imageUrl}/>
      <div className="prompt-card-caption"><span>{label}</span><h2>{title}</h2></div>
    </button>
    <button className="prompt-card-copy" type="button" title={copied?'已复制':'复制完整提示词'} aria-label={`${copied?'已复制':'复制'} ${title}`} onClick={onCopy}><CopyIcon done={copied}/></button>
  </article>;
}

function PrivateMemory({baseUrl,owner,query,onOpen,onCopy,copied}:{baseUrl:string;owner:string;query:string;onOpen:(entry:PromptEntry)=>void;onCopy:(entry:PromptEntry)=>void;copied:string}) {
  const memory=useVisualPrompts(baseUrl,owner,query);
  return <>
    <p className="prompt-private-note"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>只有你能看到这里的画面描述与创作要求。</p>
    {memory.items.length>0&&<div className="prompt-grid">{memory.items.map(entry=><PromptCard key={entry.id} entry={entry} label="我的视觉记忆" copied={copied===entry.id} onOpen={()=>onOpen(entry)} onCopy={()=>onCopy(entry)}/>)}</div>}
    {memory.loading&&!memory.items.length&&<div className="prompt-skeletons" aria-label="正在加载视觉记忆">{Array.from({length:8},(_,i)=><div key={i}/>)}</div>}
    {!memory.loading&&!memory.error&&!memory.items.length&&<div className="prompt-empty"><span aria-hidden="true">◌</span><h2>{query?'没有找到相关视觉记忆':'还没有视觉记忆'}</h2><p>{query?'换一个主体、配色或关键词试试。':'在图片聊天或创作中积累画面描述后，可以在这里再次找到。'}</p></div>}
    {memory.error&&<div className="prompt-error" role="alert"><p>{memory.error}</p><button type="button" onClick={()=>void memory.retry()} disabled={memory.loading}>重试加载</button></div>}
    {memory.hasMore&&!memory.error&&<div className="prompt-more"><button type="button" disabled={memory.loading} onClick={()=>void memory.loadMore()}>{memory.loading?'正在加载…':'加载更多'}</button></div>}
  </>;
}

export default function PromptLibrary({baseUrl,user,suspended=false,onClose,onHome,onSettings,onProfile,onLogin}:Props) {
  const [catalog,setCatalog]=useState<GalleryCatalog|null>(null),[catalogError,setCatalogError]=useState(''),[retry,setRetry]=useState(0);
  const [source,setSource]=useState<'gallery'|'visual-memory'>('gallery'),[query,setQuery]=useState(''),[category,setCategory]=useState('all'),[limit,setLimit]=useState(24);
  const [covers,setCovers]=useState<Record<string,string>>({}),[copied,setCopied]=useState('');
  const heading=useRef<HTMLHeadingElement>(null),closeRef=useRef(onClose);closeRef.current=onClose;
  const owner=user?`${baseUrl}:${user.userId??user.username}`:'';
  const {detail,revision,open,close:closeDetail}=usePromptSelection(owner);
  const identity=useRef('');identity.current=JSON.stringify([owner,revision]);
  useEffect(()=>setCopied(''),[owner]);
  useEffect(()=>{
    let valid=true;setCatalogError('');
    void loadGallery().then(value=>{if(valid)setCatalog(value);}).catch(()=>{if(valid)setCatalogError('提示词目录暂时无法读取，请重试。');});
    return()=>{valid=false;};
  },[retry]);
  useEffect(()=>{
    const controller=new AbortController();const timer=window.setTimeout(()=>controller.abort(),8000);
    void loadCoverOverrides(controller.signal).then(value=>{if(!controller.signal.aborted)setCovers(value);});
    return()=>{controller.abort();window.clearTimeout(timer);};
  },[]);
  useEffect(()=>{heading.current?.focus();},[]);
  useEffect(()=>{if(!copied)return;const timer=window.setTimeout(()=>setCopied(''),2400);return()=>window.clearTimeout(timer);},[copied]);
  useEffect(()=>{
    const close=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!detail&&!suspended){event.preventDefault();closeRef.current();}};
    document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close);
  },[detail,suspended]);
  const results=useMemo(()=>catalog?filterGallery(catalog,query,category):[],[catalog,query,category]);
  const labels=new Map(catalog?.categories.map(item=>[item.id,item.label])??[]);
  const switchSource=(value:typeof source)=>{setSource(value);setQuery('');setCategory('all');setLimit(24);closeDetail();};
  const copy=async(entry:PromptEntry)=>{
    const capturedOwner=identity.current;
    const ok=await copyPrompt(entry);
    if(entry.source==='visual-memory'&&capturedOwner!==identity.current)return;
    if(ok)setCopied(entry.id);else open(entry,true);
  };
  return <section className="prompt-library" aria-label="提示词知识库" aria-hidden={suspended||undefined}>
    <header className="prompt-library-header" aria-hidden={detail?true:undefined}>
      <button className="prompt-library-back" type="button" onClick={onClose} aria-label="返回聊天"><span aria-hidden="true">‹</span><img src={boboMark} alt=""/><span>bobo</span></button>
      <PillNav logo={boboMark} logoAlt="bobo" items={[
        {label:'首页',href:'#start',onClick:onHome},{label:'提示词',href:'#prompts',onClick:()=>{}},{label:'设置',href:'#settings',onClick:onSettings},
        {label:user?.username??'登录',href:'#profile',onClick:user?onProfile:onLogin},
      ]} activeHref="#prompts" baseColor="#17171a" pillColor="#fbfbfc" pillTextColor="#17171a" hoveredPillTextColor="#ffffff" initialLoadAnimation={false}/>
    </header>
    <main className="prompt-library-content" aria-hidden={detail?true:undefined}>
      <div className="prompt-library-intro"><div><h1 ref={heading} tabIndex={-1}>提示词</h1><p>找到喜欢的风格，复制提示词开始创作。</p></div>
        <label className="prompt-search"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input type="search" aria-label="搜索提示词" placeholder="搜索风格、主题或关键词" maxLength={160} value={query} onChange={event=>{setQuery(event.target.value);setLimit(24);}}/>{query&&<button type="button" aria-label="清空搜索" onClick={()=>{setQuery('');setLimit(24);}}>×</button>}</label>
      </div>
      <div className="prompt-source-tabs" role="tablist" aria-label="提示词来源"><button role="tab" type="button" aria-selected={source==='gallery'} onClick={()=>switchSource('gallery')}>精选画廊{catalog&&<span>{catalog.prompts.length}</span>}</button><button role="tab" type="button" aria-selected={source==='visual-memory'} onClick={()=>switchSource('visual-memory')}>我的视觉记忆</button></div>
      {source==='gallery'?<>
        <div className="prompt-filters"><div className="prompt-category-chips"><button type="button" className={category==='all'?'is-selected':''} aria-pressed={category==='all'} onClick={()=>{setCategory('all');setLimit(24);}}>全部</button>
          {(catalog?.categories??[]).filter(item=>['photography','typography-and-posters','anime-and-manga','product-and-food','architecture-and-interior'].includes(item.id)).map(item=><button key={item.id} type="button" className={category===item.id?'is-selected':''} aria-pressed={category===item.id} onClick={()=>{setCategory(item.id);setLimit(24);}}>{item.label}</button>)}</div>
          <label className="prompt-category-select"><span className="visually-hidden">全部分类</span><select aria-label="全部分类" value={category} onChange={event=>{setCategory(event.target.value);setLimit(24);}}><option value="all">全部分类</option>{catalog?.categories.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        </div>
        {!catalog&&!catalogError&&<div className="prompt-skeletons" aria-label="正在加载提示词">{Array.from({length:8},(_,i)=><div key={i}/>)}</div>}
        {catalogError&&<div className="prompt-error" role="alert"><p>{catalogError}</p><button type="button" onClick={()=>setRetry(value=>value+1)}>重试加载</button></div>}
        {catalog&&results.length>0&&<><div className="prompt-result-count">{query||category!=='all'?`${results.length} 段相关提示词`:'看看哪一种画面让你停下来'}</div><div className="prompt-grid">{results.slice(0,limit).map(entry=><PromptCard key={entry.id} entry={entry} label={labels.get(entry.category)??entry.category} imageUrl={covers[entry.id]} copied={copied===entry.id} onOpen={()=>open(entry)} onCopy={()=>void copy(entry)}/>)}</div></>}
        {catalog&&!results.length&&<div className="prompt-empty"><span aria-hidden="true">⌕</span><h2>没有找到相关提示词</h2><p>换个关键词，或看看其他风格。</p><button type="button" onClick={()=>{setQuery('');setCategory('all');}}>清空筛选</button></div>}
        {results.length>limit&&<div className="prompt-more"><button type="button" onClick={()=>setLimit(value=>value+24)}>加载更多</button><span>已显示 {Math.min(limit,results.length)} / {results.length}</span></div>}
        <p className="prompt-library-footnote">封面暂为风格示意，提示词保留完整原文。浏览与复制不消耗免费额度。</p>
      </>:user?<PrivateMemory key={owner} baseUrl={baseUrl} owner={owner} query={query} copied={copied} onOpen={open} onCopy={entry=>void copy(entry)}/>:<div className="prompt-empty"><span aria-hidden="true">◌</span><h2>把自己的画面灵感留在这里</h2><p>登录后可查看仅自己可见的视觉记忆。</p><button className="prompt-copy-primary" type="button" onClick={onLogin}>登录后查看</button></div>}
    </main>
    {copied&&<div className="prompt-copy-feedback" role="status">完整提示词已复制</div>}
    {detail&&<PromptDetail key={detail.entry.id+detail.owner} entry={detail.entry} categoryLabel={labels.get(detail.entry.category)??'我的视觉记忆'} imageUrl={detail.entry.source==='gallery'?covers[detail.entry.id]:undefined} manual={detail.manual} onClose={closeDetail}/>}
  </section>;
}
