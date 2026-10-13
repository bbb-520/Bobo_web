import { useEffect, useRef, useState } from 'react';
import type { ChatMsg } from '../types';
import type { Source } from '../api/executions';
import { documentApi } from '../api/documents';
import './documents.css';
export default function ExecutionDetails({msg,baseUrl,onResume}:{msg:ChatMsg;baseUrl:string;onResume?:(id:string,instruction?:string)=>void}) {
  const view=msg.execution;
  const [source,setSource]=useState<Source|null>(null),[sourceError,setSourceError]=useState(''),[loading,setLoading]=useState(false),[instruction,setInstruction]=useState('');
  const sourceRequest=useRef<AbortController>();
  useEffect(()=>()=>sourceRequest.current?.abort(),[]);
  const openSource=async(item:Source)=>{
    sourceRequest.current?.abort();const controller=new AbortController();sourceRequest.current=controller;
    setSource(null);setLoading(true);setSourceError('');
    if(item.kind==='IMAGE'){setSource(item);setLoading(false);return;}
    if(!item.documentId){setSourceError('文档来源标识缺失');setLoading(false);return;}
    try{const actual=await documentApi(baseUrl).source(item.documentId,item.chunkId,controller.signal);if(!controller.signal.aborted)setSource(actual);}
    catch(cause){if(!controller.signal.aborted)setSourceError(cause instanceof Error?cause.message:'原文暂时无法读取，文档可能已删除或版本已变化');}
    finally{if(!controller.signal.aborted)setLoading(false);}
  };
  if(!view&&!msg.executionConnection)return null;
  const resumable=view&&['STOPPED','WAITING_FOR_BUDGET','WAITING_FOR_RECONCILIATION','NEEDS_INPUT','FAILED'].includes(view.status);
  return <div className="execution-details">
    {msg.executionConnection&&<p className="execution-connection">{msg.executionConnection}</p>}
    {view?.progress&&view.status==='RUNNING'&&<p>{view.progress}</p>}
    {view?.status==='WAITING_FOR_RECONCILIATION'&&<p>调用结果尚未确认。后台将在执行超时后解除账户占用；旧调用不会自动重发，你可以稍后发送新消息。</p>}
    {view?.status==='WAITING_FOR_BUDGET'&&<p>请确认余额和任务预算后继续。达到任务硬上限时，需要新建任务。</p>}
    {view&&view.sources.length>0&&<div className="execution-sources" aria-label="回答引用">{view.sources.map((item,index)=><button key={item.id||item.chunkId} onClick={()=>void openSource(item)}>[{/^S[1-9]\d*$/.test(item.id)?item.id:index+1}] {item.title||'文档原文'}{item.kind==='IMAGE'?' · 图片识别':item.page!=null?` · 第 ${item.page} 页`:' · 原文片段'}</button>)}</div>}
    {(loading||source||sourceError)&&<section className="source-viewer" aria-label="引用原文"><header><strong>{source?.title??'引用原文'}</strong><button aria-label="关闭原文" onClick={()=>{sourceRequest.current?.abort();setSource(null);setSourceError('');setLoading(false);}}>×</button></header>{loading?<p>正在读取原文…</p>:source?<><small>{source.kind==='IMAGE'?'图片附件识别结果（可能存在识别误差）':source.page!=null?`第 ${source.page} 页`:'页码不可用，已定位到原文片段'}</small><blockquote>{source.excerpt}</blockquote><small>片段 {source.chunkId}</small></>:<p role="alert">{sourceError}</p>}</section>}
    {(resumable||msg.executionConnection)&&onResume&&<div className="execution-resume">{view?.status==='NEEDS_INPUT'&&<input value={instruction} onChange={event=>setInstruction(event.target.value)} placeholder="补充本轮需要的信息" aria-label="补充信息"/>}<button disabled={view?.status==='NEEDS_INPUT'&&!instruction.trim()} onClick={()=>onResume(msg.id,instruction)}>{!view?'恢复请求':view.status==='RUNNING'||view.status==='QUEUED'?'重新连接':view.status==='WAITING_FOR_BUDGET'?'核对预算并继续':view.status==='WAITING_FOR_RECONCILIATION'?'查询回执并继续':'继续执行'}</button></div>}
  </div>;
}
