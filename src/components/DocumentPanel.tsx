import { useEffect, useRef, useState } from 'react';
import { documentApi, uploadDocument, type DocumentConversation, type DocumentSummary, type DocumentView } from '../api/documents';
import { uid } from '../lib/storage';
import Markdown from '../lib/markdown';
import './documents.css';

const ready=(doc:DocumentView)=>['READY','COMPLETED','SUCCEEDED','INDEXED'].includes(doc.indexStatus);
const statusLabel=(status:string)=>({UPLOADED:'已上传',PENDING:'等待处理',QUEUED:'排队中',PROCESSING:'处理中',INDEXING:'正在建立索引',READY:'已就绪',COMPLETED:'已完成',SUCCEEDED:'已完成',FAILED:'处理失败',DELETED:'已删除'}[status]??status);
export default function DocumentPanel({baseUrl,accountScope,signedIn,busy,contextId,documentIds,onContext,onLogin}:{
  baseUrl:string;accountScope:string;signedIn:boolean;busy:boolean;contextId?:string;documentIds?:string[];onContext:(value:DocumentConversation|null)=>void;onLogin:()=>void;
}) {
  const [open,setOpen]=useState(false),[documents,setDocuments]=useState<DocumentView[]>([]),[selected,setSelected]=useState<string[]>(documentIds??[]),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const [upload,setUpload]=useState<{file:File;requestId:string;percent:number;active:boolean;error?:string}|null>(null);
  const [summary,setSummary]=useState<{id:string;filename:string;value?:DocumentSummary}|null>(null);
  const input=useRef<HTMLInputElement>(null),uploadController=useRef<AbortController>(),epoch=useRef(0),refreshRevision=useRef(0);
  const api=documentApi(baseUrl);
  const refresh=async(signal?:AbortSignal)=>{
    const revision=++refreshRevision.current,current=epoch.current;
    try{const items=await api.list(signal);if(current===epoch.current&&revision===refreshRevision.current&&!signal?.aborted){setDocuments(items);setError('');}}
    catch(cause){if(current===epoch.current&&!signal?.aborted)setError(cause instanceof Error?cause.message:'文档列表暂时无法读取');}
  };
  useEffect(()=>{
    epoch.current++;refreshRevision.current++;setDocuments([]);setUpload(null);setSummary(null);setError('');setLoading(false);setSelected(documentIds??[]);
    uploadController.current?.abort();
    if(!signedIn)return;
    const controller=new AbortController();void refresh(controller.signal);
    const timer=window.setInterval(()=>void refresh(controller.signal),4000);
    return()=>{epoch.current++;controller.abort();uploadController.current?.abort();window.clearInterval(timer);};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[accountScope,baseUrl,signedIn]);
  useEffect(()=>{setSelected(documentIds??[]);setSummary(null);},[contextId,documentIds]);
  useEffect(()=>{
    if(!contextId||!signedIn)return;
    const controller=new AbortController();const current=epoch.current;
    void api.conversation(contextId,controller.signal).catch(cause=>{if(!controller.signal.aborted&&current===epoch.current)setError(cause instanceof Error?cause.message:'文档会话暂时无法恢复');});
    return()=>controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[contextId,accountScope,signedIn]);
  useEffect(()=>{
    if(!summary||!signedIn)return;
    const controller=new AbortController(),id=summary.id;
    const read=()=>void api.summary(id,controller.signal).then(value=>{if(!controller.signal.aborted)setSummary(current=>current?.id===id?{...current,value}:current);}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'概要暂时无法读取');});
    read();const timer=window.setInterval(read,4000);return()=>{controller.abort();window.clearInterval(timer);};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[summary?.id,accountScope,signedIn]);
  const startUpload=async(file:File,requestId=uid())=>{
    if(!signedIn){onLogin();return;}
    if(file.size>100*1024*1024||!file.size){setError(file.size?'文件超过 100 MiB 限制':'请选择有内容的文档');return;}
    uploadController.current?.abort();const controller=new AbortController();uploadController.current=controller;const current=epoch.current;
    setUpload({file,requestId,percent:0,active:true});setOpen(true);setError('');
    try {
      const doc=await uploadDocument(file,requestId,baseUrl,controller.signal,percent=>{if(current===epoch.current)setUpload(item=>item?.requestId===requestId?{...item,percent}:item);});
      if(current!==epoch.current||controller.signal.aborted)return;
      setDocuments(items=>[doc,...items.filter(item=>item.documentId!==doc.documentId)]);setUpload(null);void refresh();
    } catch(cause) {
      if(current!==epoch.current)return;
      setUpload(item=>item?.requestId===requestId?{...item,active:false,error:controller.signal.aborted?'上传已取消':cause instanceof Error?cause.message:'上传失败'}:item);
    }
  };
  const apply=async()=>{
    if(busy||loading)return;setLoading(true);setError('');const current=epoch.current;
    try{const context=selected.length?await api.createConversation(selected):null;if(current===epoch.current)onContext(context);}
    catch(cause){if(current===epoch.current)setError(cause instanceof Error?cause.message:'文档会话创建失败');}
    finally{if(current===epoch.current)setLoading(false);}
  };
  const actOnDocument=async(doc:DocumentView,action:'retry'|'remove')=>{
    const current=epoch.current;setError('');
    try{if(action==='retry')await api.retry(doc.documentId);else await api.remove(doc.documentId);if(current===epoch.current){if(action==='remove')setSelected(items=>items.filter(id=>id!==doc.documentId));await refresh();}}
    catch(cause){if(current===epoch.current)setError(cause instanceof Error?cause.message:'操作失败');}
  };
  return <aside className="document-panel" aria-label="文档资料">
    <div className="document-toolbar">
      <button type="button" className="document-toggle" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>文档资料 {documents.length>0&&<span>{documents.length}</span>}</button>
      <span className="document-context">{contextId?`正在依据 ${documentIds?.length??0} 份文档回答`:'上传文档，查看概要并连续追问'}</span>
      <button type="button" className="document-upload" onClick={()=>signedIn?input.current?.click():onLogin()} disabled={upload?.active}>＋ 上传文档</button>
      <input ref={input} type="file" className="visually-hidden" accept=".pdf,.doc,.docx,.txt,.md,.csv,.xls,.xlsx,.ppt,.pptx,.json,.html,.htm,.markdown,.rtf,.odt" onChange={event=>{const file=event.target.files?.[0];event.currentTarget.value='';if(file)void startUpload(file);}}/>
    </div>
    {open&&<div className="document-body">
      {!signedIn?<button onClick={onLogin}>登录后上传与阅读文档</button>:<>
        <p className="document-help">支持 PDF、Office、TXT、Markdown、CSV、JSON、HTML、RTF、ODT，每份最多 100 MiB。索引与概要共用免费 Token，扫描 PDF 暂无 OCR。索引就绪后可继续提问。</p>
        {upload&&<div className="document-upload-progress" role="status"><span>{upload.file.name}</span><progress value={upload.percent} max={100}/><span>{upload.active?`${upload.percent}%${upload.percent===100?'，正在确认上传…':''}`:upload.error}</span>{upload.active?<button onClick={()=>uploadController.current?.abort()}>取消上传</button>:<><button onClick={()=>void startUpload(upload.file,upload.requestId)}>重新上传</button><button onClick={()=>setUpload(null)}>关闭</button></>}</div>}
        {documents.length===0&&!upload&&<p className="document-empty">还没有文档，上传后可查看处理进度。</p>}
        <ul className="document-list">{documents.map(doc=><li key={doc.documentId}>
          <label><input type="checkbox" checked={selected.includes(doc.documentId)} disabled={busy||!ready(doc)} onChange={event=>setSelected(items=>event.target.checked?[...items,doc.documentId]:items.filter(id=>id!==doc.documentId))}/><span>{doc.filename}<small>{statusLabel(doc.indexStatus)}{doc.chunkCount>0&&` · ${doc.completedChunks}/${doc.chunkCount} 片段`} · 概要{statusLabel(doc.summaryStatus)}{doc.indexVersion>0&&` · 版本 ${doc.indexVersion}`}</small></span></label>
          <div className="document-row-actions"><button onClick={()=>setSummary({id:doc.documentId,filename:doc.filename})}>查看概要</button>{doc.error&&<button onClick={()=>void actOnDocument(doc,'retry')}>重试处理</button>}<button disabled={busy||loading} onClick={()=>void actOnDocument(doc,'remove')}>删除</button></div>
          {!ready(doc)&&doc.chunkCount>0&&<progress value={doc.completedChunks} max={doc.chunkCount} aria-label={`${doc.filename} 索引进度`}/>} {doc.error&&<p className="document-error">{doc.error}</p>}
        </li>)}</ul>
        <div className="document-selection"><button className="document-primary" disabled={busy||loading||!selected.length||selected.some(id=>!documents.some(doc=>doc.documentId===id&&ready(doc)))} onClick={()=>void apply()}>{loading?'正在准备…':`使用选中的 ${selected.length} 份文档`}</button>{contextId&&<button disabled={busy||loading} onClick={()=>{setSelected([]);onContext(null);}}>退出文档问答</button>}</div>
        {summary&&<section className="document-summary" aria-label="全文概要"><header><strong>{summary.filename} · 全文概要</strong><button onClick={()=>setSummary(null)} aria-label="关闭概要">×</button></header>{summary.value?<><small>概要{statusLabel(summary.value.status)}{typeof summary.value.coverage==='number'?` · 覆盖率 ${Math.round(summary.value.coverage*100)}%`:''}</small>{summary.value.text?<Markdown content={summary.value.text}/>:<p>概要仍在处理中，完成后会自动更新。</p>}{summary.value.coverage!=null&&typeof summary.value.coverage==='object'&&<details><summary>查看覆盖范围</summary><pre>{JSON.stringify(summary.value.coverage,null,2)}</pre></details>}</>:<p>正在读取概要…</p>}</section>}
      </>}
      {error&&<div className="document-error" role="alert">{error}<button onClick={()=>void refresh()}>刷新文档</button></div>}
    </div>}
  </aside>;
}
