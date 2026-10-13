import { useEffect, useRef, useState } from 'react';
import type {
  ChatMsg,
  Conversation,
  ImageJobRef,
  Settings,
} from '../types';
import {
  fetchConversationImageJobs,
  fetchImageJob,
  uploadImageAsset,
} from '../lib/api';
import { ImageJobNotFoundError, reconcileImageJobs } from '../lib/imageJobPolling';
import { imageCreationApi } from '../lib/imageCreation';
import { ApiError } from '../lib/http';
import { resolveChatMode, type ChatMode, type ChatModeContext } from '../lib/chatModes';
import {
  deriveTitle,
  loadActiveSessionId,
  loadConversations,
  saveActiveSessionId,
  saveConversations,
  uid,
} from '../lib/storage';
import type { PushToast } from './useToasts';
import { executionApi, ExecutionApiError, isExecutionActive, type ExecutionView } from '../api/executions';
import { loadExecutionRecovery, saveExecutionRecovery, type ExecutionRecovery } from '../lib/executionRecovery';
import { cancellableDelay, observeExecution, reconnectDelay } from '../lib/executionRunner';
import { documentApi, uploadDocument, type DocumentConversation, type DocumentView } from '../api/documents';
import { attachmentQuestion, imageReference, isImageFile } from '../lib/attachments';
import { getWallet, isInArrears } from '../lib/billing';

interface BusyInfo {
  convId: string;
  msgId: string;
}

/** 当前进行中的一次生成：停止时中断浏览器 SSE 流，并保留已生成内容。 */
interface ActiveRun {
  convId: string;
  msgId: string;
  requestStop: () => void;
  disconnect?: () => void;
}

interface UseConversationsOptions {
  settings: Settings;
  accountScope?: string;
  notify: PushToast;
  openSettings: () => void;
}

/**
 * 会话状态中枢：会话列表（localStorage 持久化）、当前选中会话、单在途请求 busy 标记，
 * 以及全部会话动作（发送/停止/选择/新建/删除/清空）。
 *
 * 核心不变量：一个会话 = 一个 sessionId（uuid），
 * 只在「新建对话」时更换，刷新后自动恢复上次会话，同一时刻只允许一个在途请求。
 */
export function useConversations({ settings, accountScope = 'guest', notify, openSettings }: UseConversationsOptions) {
  const [scope, setScope] = useState(accountScope || 'guest');
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations(accountScope || 'guest'));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyInfo | null>(null);

  // 最新值镜像：供异步闭包 / mount 期 effect 读取，避免 stale closure
  const listRef = useRef(conversations);
  const busyRef = useRef<BusyInfo | null>(null);
  const activeRef = useRef<string | null>(null);
  const settingsRef = useRef(settings);
  const notifyRef = useRef(notify);
  const openSettingsRef = useRef(openSettings);
  const activeRunRef = useRef<ActiveRun | null>(null);
  const imagePollersRef = useRef(new Map<string, number>());
  const imageRequestsRef = useRef(new Map<string, AbortController>());
  const ownerRef = useRef(accountScope || 'guest');
  const scopeEpoch = useRef(0);
  const executionObservers = useRef(new Map<string,AbortController>());
  const recoveryRef=useRef<ExecutionRecovery[]>(loadExecutionRecovery(accountScope||'guest'));
  if (ownerRef.current !== (accountScope || 'guest')) {
    ownerRef.current = accountScope || 'guest';
    scopeEpoch.current++;
  }
  /**
   * Object URLs are intentionally not persisted to localStorage, but they must
   * survive the attachment replacement that happens after the upload API
   * returns. Keep them keyed by message id so a late async update cannot turn
   * an already visible image into a blank placeholder.
   */
  const attachmentPreviewRef = useRef(new Map<string, string[]>());
  const pendingFilesRef=useRef(new Map<string,File[]>());

  const restoreAttachmentPreviews = (items: Conversation[]) =>
    items.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => {
        if (!message.attachments?.length) return message;
        const previewUrl = attachmentPreviewRef.current.get(message.id);
        if (!previewUrl) return message;
        const attachments = message.attachments.map((attachment,index) =>
          attachment.previewUrl ? attachment : { ...attachment, previewUrl:previewUrl[index] },
        );
        return { ...message, attachments };
      }),
    }));

  const releaseAttachmentPreviews = (messages: ChatMsg[]) => {
    messages.forEach((message) => {
      const previewUrl = attachmentPreviewRef.current.get(message.id);
      if (!previewUrl) return;
      previewUrl.forEach(url=>URL.revokeObjectURL(url));
      attachmentPreviewRef.current.delete(message.id);
      pendingFilesRef.current.delete(message.id);
    });
  };

  useEffect(() => {
    listRef.current = conversations;
  }, [conversations]);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(() => {
    activeRef.current = activeId;
  }, [activeId]);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);
  useEffect(() => {
    openSettingsRef.current = openSettings;
  }, [openSettings]);

  useEffect(() => () => {
    scopeEpoch.current++;
    if(activeRunRef.current?.disconnect)activeRunRef.current.disconnect();else activeRunRef.current?.requestStop();
    executionObservers.current.forEach(controller=>controller.abort());
    executionObservers.current.clear();
    imagePollersRef.current.forEach((timer) => window.clearInterval(timer));
    imagePollersRef.current.clear();
    imageRequestsRef.current.forEach(controller=>controller.abort());
    imageRequestsRef.current.clear();
    attachmentPreviewRef.current.forEach(urls=>urls.forEach(url=>URL.revokeObjectURL(url)));
    attachmentPreviewRef.current.clear();
    pendingFilesRef.current.clear();
  }, []);

  /* ---------- 会话列表持久化（首帧跳过，后续防抖 260ms） ---------- */
  const persistReadyRef = useRef(false);
  useEffect(() => {
    if (!persistReadyRef.current) {
      persistReadyRef.current = true;
      return;
    }
    const t = setTimeout(() => saveConversations(conversations, scope), 260);
    return () => clearTimeout(t);
  }, [conversations, scope]);

  useEffect(() => {
    const nextScope = accountScope || 'guest';
    if (nextScope === scope) return;
    if(activeRunRef.current?.disconnect)activeRunRef.current.disconnect();else activeRunRef.current?.requestStop();
    executionObservers.current.forEach(controller=>controller.abort());
    executionObservers.current.clear();
    activeRunRef.current = null;
    busyRef.current = null;
    setBusy(null);
    imagePollersRef.current.forEach(timer => window.clearInterval(timer));
    imageRequestsRef.current.forEach(controller=>controller.abort());
    imageRequestsRef.current.clear();
    imagePollersRef.current.clear();
    saveConversations(listRef.current.map(c => ({ ...c, messages:c.messages.map(m => m.status==='streaming'&&!m.execution ? {...m,status:'stopped' as const,endReason:'aborted' as const,finishedAt:Date.now()} : m) })), scope);
    attachmentPreviewRef.current.forEach(urls=>urls.forEach(url=>URL.revokeObjectURL(url)));
    attachmentPreviewRef.current.clear();
    pendingFilesRef.current.clear();
    const nextConversations = restoreAttachmentPreviews(loadConversations(nextScope));
    listRef.current = nextConversations;
    activeRef.current = null;
    setScope(nextScope);
    recoveryRef.current=loadExecutionRecovery(nextScope);
    setConversations(nextConversations);
    setActiveId(null);
    const last = loadActiveSessionId(nextScope);
    if (last && nextConversations.some((c) => c.id === last)) {
      setActiveId(last);
    }
  }, [accountScope, scope]);

  /** 切换当前会话并记住。 */
  const applyActive = (id: string) => {
    setActiveId(id);
    saveActiveSessionId(id, scope);
  };

  /* ---------- 启动：自动恢复上次会话 ---------- */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const last = loadActiveSessionId(scope);
    if (!last || last.startsWith('seed')) return;
    if (!listRef.current.some((c) => c.id === last)) return;
    applyActive(last);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  /* 图片任务状态从后端刷新，会话消息由 localStorage 持久化。 */
  useEffect(() => {
    if (!activeId) return;
    void hydrateImageJobs(activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const patchJob = (convId: string, msgId: string, job: ImageJobRef) => {
    mutateExecutionConversations((ls) => ls.map((c) => c.id !== convId ? c : {
      ...c,
      messages: c.messages.map((m) => m.id !== msgId ? m : {
        ...m,
        imageJobs: [...(m.imageJobs ?? []).filter((item) => item.jobId !== job.jobId), job],
        ...(m.imageRequest?{imageRequest:{...m.imageRequest,state:'accepted' as const},status:job.status==='FAILED'?'error' as const:'done' as const,
          content:job.status==='FAILED'?'图片生成未完成。':job.status==='SUCCEEDED'?'图片已生成。':'图片任务已受理，完成后会显示在这里。',error:job.status==='FAILED'?job.error??'图片生成失败':undefined,finishedAt:m.finishedAt??Date.now()}:{}),
      }),
    }));
  };

  const removeImageJob = (convId: string, msgId: string, jobId: string) => {
    mutateExecutionConversations((ls) => ls.map((c) => c.id !== convId ? c : {
      ...c,
      messages: c.messages.map((m) => m.id !== msgId ? m : {
        ...m,
        imageJobs: (m.imageJobs ?? []).filter((item) => item.jobId !== jobId),
      }),
    }));
  };

  const watchImageJob = (convId: string, msgId: string, jobId: string) => {
    if (imagePollersRef.current.has(jobId)) return;
    const epoch = scopeEpoch.current;
    let polling = false;
    const stopPolling = () => {
      const timer = imagePollersRef.current.get(jobId);
      if (timer) window.clearInterval(timer);
      imagePollersRef.current.delete(jobId);
    };
    const tick = async () => {
      if(epoch!==scopeEpoch.current||polling)return;
      polling=true;
      try {
        const job = await fetchImageJob(jobId, settingsRef.current.baseUrl);
        if (!job || epoch!==scopeEpoch.current) return;
        patchJob(convId, msgId, job);
        if (job.status === 'SUCCEEDED' || job.status === 'FAILED' || job.status === 'CANCELED' || job.status === 'EXPIRED') {
          stopPolling();
          if (job.status === 'SUCCEEDED') notifyRef.current('图片已生成，结果已回到当前对话');
        }
      } catch (error) {
        if (epoch!==scopeEpoch.current || !(error instanceof ImageJobNotFoundError)) return;
        stopPolling();
        removeImageJob(convId, msgId, jobId);
        notifyRef.current('图片任务已失效，请重新上传图片');
      } finally { polling=false; }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 3500);
    imagePollersRef.current.set(jobId, timer);
  };

  const hydrateImageJobs = async (convId: string) => {
    const epoch = scopeEpoch.current;
    const jobs = await fetchConversationImageJobs(convId, settingsRef.current.baseUrl);
    // null means the refresh failed; retain local cards and retry on the next session refresh.
    if (epoch!==scopeEpoch.current) return;
    if(jobs!==null)mutateExecutionConversations((ls) => ls.map((c) => {
      if (c.id !== convId) return c;
      return reconcileImageJobs(c, jobs);
    }));
    const conversation=listRef.current.find(c=>c.id===convId);
    for(const message of conversation?.messages??[]) {
      for(const job of message.imageJobs??[]) {
        if(job.status==='QUEUED'||job.status==='PROCESSING')watchImageJob(convId,message.id,job.jobId);
      }
    }
    for(const message of conversation?.messages??[]) {
      const request=message.imageRequest;
      if(!request||request.state==='accepted'||request.state==='failed')continue;
      if(request.state==='uploading') {
        mutateExecutionConversations(items=>items.map(c=>c.id!==convId?c:{...c,messages:c.messages.map(m=>m.id!==message.id?m:{...m,status:'stopped',imageRequest:{...request,state:'failed'},error:'参考图片上传已中断，请重新选择图片并发送。',finishedAt:m.finishedAt??Date.now()})}));
      } else submitImageRequest(convId,message.id,request,true);
    }
  };

  const imageContext=(conversation?:Conversation):ChatModeContext=>({hasImages:Boolean(conversation?.imageAttachments?.length),imageCount:conversation?.imageAttachments?.length,hasDocuments:Boolean(conversation?.documentConversationId)});

  /** Persist first; a lost response is recovered with the same request ID, never a new paid job. */
  const submitImageRequest=(convId:string,msgId:string,initial:NonNullable<ChatMsg['imageRequest']>,recover=false,source?:File,userId?:string)=>{
    if(imageRequestsRef.current.has(msgId))return;
    const epoch=scopeEpoch.current,controller=new AbortController(),api=imageCreationApi(settingsRef.current.baseUrl);
    imageRequestsRef.current.set(msgId,controller);
    const valid=()=>epoch===scopeEpoch.current&&!controller.signal.aborted;
    let request={...initial};
    const patch=(changes:Partial<ChatMsg>)=>{if(epoch===scopeEpoch.current)mutateExecutionConversations(items=>items.map(c=>c.id!==convId?c:{...c,messages:c.messages.map(m=>m.id===msgId?{...m,...changes}:m)}));};
    const release=()=>{if(epoch===scopeEpoch.current&&busyRef.current?.msgId===msgId){busyRef.current=null;setBusy(null);activeRunRef.current=null;}};
    const submissionTimer=window.setTimeout(()=>{
      if(!valid())return;
      const uploading=request.state==='uploading';controller.abort();
      patch({status:'stopped',imageRequest:{...request,state:uploading?'failed':'submitting'},error:uploading?'图片上传等待超时，请重新选择图片并发送。':'图片任务受理等待超时，刷新后会核对同一请求，请勿重复提交。',finishedAt:Date.now()});
      if(imageRequestsRef.current.get(msgId)===controller)imageRequestsRef.current.delete(msgId);
      release();
    },120000);
    if(!recover) {
      busyRef.current={convId,msgId};setBusy(busyRef.current);
      activeRunRef.current={convId,msgId,disconnect:()=>controller.abort(),requestStop:()=>{
        window.clearTimeout(submissionTimer);
        request={...request,state:'stopped',stopRequested:true};controller.abort();
        patch({imageRequest:request,status:'stopped',error:'已停止等待。已受理的图片任务仍会继续，可刷新查看结果。',finishedAt:Date.now()});release();
      }};
    }
    void(async()=>{
      try {
        if(source) {
          const asset=await uploadImageAsset(source,settingsRef.current.baseUrl,controller.signal);
          if(!valid())return;
          request={...request,attachments:[imageReference(asset)],state:'submitting'};
          mutateExecutionConversations(items=>items.map(c=>c.id!==convId?c:{...c,messages:c.messages.map(m=>m.id===userId?{...m,attachments:[{...asset,previewUrl:m.attachments?.[0]?.previewUrl}]}:m)}));
          patch({imageRequest:request});
        }
        for(let attempt=0;attempt<3&&valid();attempt++) {
          try {
            let job:ImageJobRef|undefined;
            if(recover||attempt>0) {
              try {job=await api.byRequest(request.requestId,controller.signal);}
              catch(cause){if(!(cause instanceof ApiError)||cause.status!==404)throw cause;}
            }
            if(!valid())return;
            if(!job&&request.stopRequested){patch({status:'stopped',imageRequest:request,finishedAt:Date.now()});return;}
            if(!job)job=await api.create({requestId:request.requestId,conversationId:request.conversationId,prompt:request.prompt,attachments:request.attachments},controller.signal);
            if(!valid())return;
            if(!job||typeof job.jobId!=='string')throw new Error('图片任务受理信息不完整');
            patch({imageRequest:{...request,state:'accepted'},status:'done',error:undefined,content:'图片任务已受理，完成后会显示在这里。',finishedAt:Date.now()});
            patchJob(convId,msgId,job);release();
            if(job.status==='QUEUED'||job.status==='PROCESSING')watchImageJob(convId,msgId,job.jobId);
            return;
          } catch(cause) {
            if(!valid())return;
            if(cause instanceof ApiError&&[400,401,402,403,404,409,413,422].includes(cause.status))throw cause;
            patch({status:'stopped',imageRequest:{...request,state:'submitting'},error:'正在确认图片任务是否受理，刷新后会按同一请求恢复。',finishedAt:Date.now()});release();
            if(attempt===2)throw cause;
            await cancellableDelay(1000*(attempt+1),controller.signal);
          }
        }
      } catch(cause) {
        if(!valid())return;
        const uploadFailed=request.state==='uploading';
        const definite=uploadFailed||cause instanceof ApiError&&[400,401,402,403,404,409,413,422].includes(cause.status);
        const message=uploadFailed?'参考图片上传失败，请重新选择图片并发送。':definite&&cause instanceof Error?cause.message:'图片任务状态暂时无法确认，刷新页面将继续核对同一请求，请勿重复提交。';
        patch({status:definite?'error':'stopped',imageRequest:{...request,state:definite?'failed':'submitting'},error:message,finishedAt:Date.now()});notifyRef.current(message,'err');
      } finally {
        window.clearTimeout(submissionTimer);
        if(imageRequestsRef.current.get(msgId)===controller)imageRequestsRef.current.delete(msgId);
        if(userId)pendingFilesRef.current.delete(userId);release();
      }
    })();
  };

  const mutateExecutionConversations=(fn:(items:Conversation[])=>Conversation[])=>{
    const next=fn(listRef.current);listRef.current=next;setConversations(next);saveConversations(next,ownerRef.current);
  };
  const persistRecovery=()=>saveExecutionRecovery(ownerRef.current,recoveryRef.current);
  const patchExecution=(entry:ExecutionRecovery,view?:ExecutionView,connection='')=>{
    mutateExecutionConversations(items=>items.map(c=>c.id!==entry.convId?c:{...c,updatedAt:Date.now(),messages:c.messages.map(m=>m.id!==entry.msgId?m:{
      ...m,...(view?{execution:view,content:view.answer,status:isExecutionActive(view)?'streaming' as const:view.status==='FAILED'?'error' as const:view.status==='COMPLETED'?'done' as const:'stopped' as const,error:view.error??undefined,finishedAt:isExecutionActive(view)?undefined:(m.finishedAt ?? Date.now())}:{}),executionConnection:connection,
    })}));
  };
  const observeDurable=(entry:ExecutionRecovery,initial?:ExecutionView,recover=true)=>{
    if(executionObservers.current.has(entry.msgId))return;
    const epoch=scopeEpoch.current,controller=new AbortController(),api=executionApi(settingsRef.current.baseUrl);
    executionObservers.current.set(entry.msgId,controller);
    const valid=()=>epoch===scopeEpoch.current&&!controller.signal.aborted;
    const releaseLocal=(message:string)=>{
      if(!valid())return;
      controller.abort();
      if(executionObservers.current.get(entry.msgId)===controller)executionObservers.current.delete(entry.msgId);
      patchExecution(entry,undefined,message);
      mutateExecutionConversations(items=>items.map(c=>c.id!==entry.convId?c:{...c,messages:c.messages.map(m=>m.id!==entry.msgId?m:{...m,status:'stopped',finishedAt:m.finishedAt??Date.now()})}));
      if(busyRef.current?.msgId===entry.msgId){busyRef.current=null;setBusy(null);activeRunRef.current=null;}
    };
    let observationTimer=0;
    const touchObservation=()=>{
      window.clearTimeout(observationTimer);
      observationTimer=window.setTimeout(()=>releaseLocal('状态同步等待超时，已解除本页等待。请求记录已保留，可稍后恢复状态或发送新消息。'),300000);
    };
    touchObservation();
    const publish=(view:ExecutionView)=>{
      if(!valid())return;
      touchObservation();
      entry.executionId=view.executionId;entry.lastSeq=view.lastSeq;persistRecovery();patchExecution(entry,view);
      if(isExecutionActive(view)) {
        busyRef.current={convId:entry.convId,msgId:entry.msgId};setBusy(busyRef.current);
      }
    };
    const stopRequest=()=>{
      if(!valid())return;
      entry.stopRequested=true;persistRecovery();patchExecution(entry,undefined,'正在请求停止…');
      if(!entry.executionId){releaseLocal('已停止本页等待。请求记录已保留，恢复状态后会继续请求停止。');return;}
      if(entry.executionId)void api.stop(entry.executionId,controller.signal).then(publish).catch(error=>{
        if(valid()){patchExecution(entry,undefined,'停止请求暂未确认，正在同步状态。');notifyRef.current(error instanceof Error?error.message:'停止请求失败','err');}
      });
    };
    activeRunRef.current={convId:entry.convId,msgId:entry.msgId,requestStop:stopRequest,disconnect:()=>controller.abort()};
    busyRef.current={convId:entry.convId,msgId:entry.msgId};setBusy(busyRef.current);
    void(async()=>{
      let view=initial,attempt=0;
      try {
        while(valid()&&!view) {
          try {
            if(entry.executionId)view=await api.get(entry.executionId,controller.signal);
            else if(recover) {
              try {view=await api.find(entry.request.requestId,controller.signal);}
              catch(error){if(error instanceof ExecutionApiError&&error.status===404)view=await api.create(entry.request,controller.signal);else throw error;}
            } else {recover=true;view=await api.create(entry.request,controller.signal);}
          } catch(error) {
            if(!valid())return;
            if(error instanceof ExecutionApiError&&[400,401,402,403,404,409,413,422].includes(error.status))throw error;
            patchExecution(entry,undefined,'请求正在恢复，请勿重复发送。');
            await cancellableDelay(reconnectDelay(attempt++),controller.signal);
          }
        }
        if(!view||!valid()){
          // Creation may complete after local stop. Stop that exact execution without touching a newer run.
          if(view&&entry.stopRequested&&epoch===scopeEpoch.current) {
            entry.executionId=view.executionId;persistRecovery();
            void api.stop(view.executionId).then(stopped=>{if(epoch===scopeEpoch.current)patchExecution(entry,stopped);}).catch(()=>{});
          }
          return;
        }
        if(entry.resumeRequest) {view=await api.resume(view.executionId,entry.resumeRequest,controller.signal);entry.resumeRequest=undefined;}
        publish(view);
        if(entry.stopRequested&&isExecutionActive(view)) {
          // A stop intent survives reload and ambiguous HTTP results; repeating stop is safe.
          try {view=await api.stop(view.executionId,controller.signal);publish(view);} catch { /* Poll the authoritative state below. */ }
        }
        const final=await observeExecution(view,{api:{...api,get:async(id,signal)=>{
          const current=await api.get(id,signal);
          if(entry.stopRequested&&isExecutionActive(current))return api.stop(id,signal);
          return current;
        }},signal:controller.signal,onSnapshot:publish,onConnection:message=>{if(valid())patchExecution(entry,undefined,message);}});
        if(valid()&&final&&!isExecutionActive(final)) {recoveryRef.current=recoveryRef.current.filter(item=>item.msgId!==entry.msgId);persistRecovery();}
      } catch(error) {
        if(valid()) {
          const message=error instanceof Error?error.message:'执行状态暂时无法读取';
          patchExecution(entry,undefined,message);notifyRef.current(message,'err');
          mutateExecutionConversations(items=>items.map(c=>c.id!==entry.convId?c:{...c,messages:c.messages.map(m=>m.id!==entry.msgId?m:{...m,status:'stopped',finishedAt:m.finishedAt ?? Date.now()})}));
          // Keep the original request ID for uncertain create/resume outcomes.
        }
      } finally {
        window.clearTimeout(observationTimer);
        if(epoch===scopeEpoch.current) {
          if(executionObservers.current.get(entry.msgId)===controller)executionObservers.current.delete(entry.msgId);
          if(busyRef.current?.msgId===entry.msgId){busyRef.current=null;setBusy(null);activeRunRef.current=null;}
        }
      }
    })();
  };

  useEffect(()=>{
    if(scope!==ownerRef.current)return;
    recoveryRef.current=loadExecutionRecovery(scope);
    recoveryRef.current.forEach(entry=>{
      if(listRef.current.some(c=>c.id===entry.convId&&c.messages.some(m=>m.id===entry.msgId)))observeDurable(entry);
    });
    // Restoring subscribes to durable work; cleanup must never call /stop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[scope]);

  const sendTextExecution=(text:string,selected:ChatMode='chat')=>{
    let conv=listRef.current.find(c=>c.id===activeRef.current);
    const now=Date.now();
    if(!conv) {conv={id:uid(),title:deriveTitle(text),messages:[],createdAt:now,updatedAt:now};applyActive(conv.id);activeRef.current=conv.id;}
    const route=resolveChatMode(text,[],selected,imageContext(conv));
    const user:ChatMsg={id:uid(),role:'user',content:text,createdAt:now,selectedMode:selected};
    const assistant:ChatMsg={id:uid(),role:'assistant',content:'',createdAt:now+1,startedAt:now,status:'streaming',executionConnection:'正在提交…',mode:route.mode,automaticMode:route.automatic};
    const next={...conv,title:conv.title==='新对话'?deriveTitle(text):conv.title,messages:[...conv.messages,user,assistant],updatedAt:now};
    mutateExecutionConversations(items=>items.some(c=>c.id===next.id)?items.map(c=>c.id===next.id?next:c):[next,...items]);
    const scoped=route.useDocuments?conv.documentConversationId:undefined;
    const entry:ExecutionRecovery={convId:next.id,msgId:assistant.id,lastSeq:0,request:{requestId:uid(),type:scoped?'DOCUMENT_QA':'CHAT',question:text,...(route.useImages&&conv.imageAttachments?.length?{attachments:conv.imageAttachments.map(imageReference)}:{}),...(scoped?{documentConversationId:scoped}:{conversationId:conv.id})}};
    recoveryRef.current.push(entry);persistRecovery();observeDurable(entry,undefined,false);
  };

  const resumeExecution=(msgId:string,instruction?:string)=>{
    if(busyRef.current)return;
    const conv=listRef.current.find(c=>c.messages.some(m=>m.id===msgId));const message=conv?.messages.find(m=>m.id===msgId);const view=message?.execution;
    let entry=recoveryRef.current.find(item=>item.msgId===msgId);
    if(!entry&&conv&&view)entry={convId:conv.id,msgId,executionId:view.executionId,lastSeq:view.lastSeq,request:{requestId:view.requestId,type:view.type,question:view.question,...(conv.imageAttachments?.length?{attachments:conv.imageAttachments.map(imageReference)}:{}),...(conv.documentConversationId?{documentConversationId:conv.documentConversationId}:{conversationId:conv.id})}};
    if(!entry)return;
    entry.stopRequested=false;
    if(view&&!isExecutionActive(view))entry.resumeRequest??={requestId:uid(),expectedVersion:view.version,additionalRounds:4,...(instruction?.trim()?{instruction:instruction.trim()}: {})};
    if(!recoveryRef.current.some(item=>item.msgId===msgId))recoveryRef.current.push(entry);
    persistRecovery();observeDurable(entry,view);
  };

  const setDocumentContext=(context:DocumentConversation|null)=>{
    if(busyRef.current)return;
    let conv=listRef.current.find(c=>c.id===activeRef.current);
    if(!conv){const now=Date.now();conv={id:uid(),title:'新对话',messages:[],createdAt:now,updatedAt:now};applyActive(conv.id);activeRef.current=conv.id;}
    const next={...conv,documentConversationId:context?.conversationId,documentIds:context?.documentIds,indexVersions:context?.indexVersions};
    mutateExecutionConversations(items=>items.some(c=>c.id===next.id)?items.map(c=>c.id===next.id?next:c):[next,...items]);
  };

  /* Attachments are prepared under the same account epoch as durable work. */
  const insertTurn=(text:string,files:File[],creation=false,selected:ChatMode='chat')=>{
    let conv=listRef.current.find(c=>c.id===activeRef.current);
    const now=Date.now();
    if(!conv){conv={id:uid(),title:deriveTitle(text),messages:[],createdAt:now,updatedAt:now};applyActive(conv.id);activeRef.current=conv.id;}
    const route=resolveChatMode(text,files,selected,imageContext(conv));
    const assistant:ChatMsg={id:uid(),role:'assistant',content:'',createdAt:now+1,startedAt:now,status:'streaming',executionConnection:creation?undefined:'正在上传附件…',mode:route.mode,automaticMode:route.automatic};
    const user:ChatMsg={id:uid(),role:'user',content:text,createdAt:now,selectedMode:selected};
    const urls:string[]=[];
    user.attachments=files.filter(isImageFile).map(file=>{const previewUrl=URL.createObjectURL(file);urls.push(previewUrl);return {assetId:'pending-'+uid(),fileName:file.name,mimeType:file.type,fileSize:file.size,previewUrl};});
    user.documentAttachments=files.filter(file=>!isImageFile(file)).map(file=>({requestId:uid(),fileName:file.name,mimeType:file.type,fileSize:file.size,status:'UPLOADING',percent:0}));
    if(!creation)user.attachmentPreparation={state:'preparing',assistantId:assistant.id};
    if(urls.length)attachmentPreviewRef.current.set(user.id,urls);
    pendingFilesRef.current.set(user.id,files);
    const next={...conv,title:conv.title==='新对话'?deriveTitle(text):conv.title,messages:[...conv.messages,user,assistant],updatedAt:now};
    mutateExecutionConversations(items=>items.some(c=>c.id===next.id)?items.map(c=>c.id===next.id?next:c):[next,...items]);
    return {convId:conv.id,user,assistant};
  };

  const prepareAttachments=(convId:string,userId:string,assistantId:string,retry=false)=>{
    const epoch=scopeEpoch.current,controller=new AbortController(),api=documentApi(settingsRef.current.baseUrl);
    const valid=()=>epoch===scopeEpoch.current&&!controller.signal.aborted;
    let transferred=false;
    let preparationTimer:number|undefined;
    const patchUser=(fn:(message:ChatMsg)=>ChatMsg)=>{if(valid())mutateExecutionConversations(items=>items.map(c=>c.id!==convId?c:{...c,messages:c.messages.map(m=>m.id===userId?fn(m):m)}));};
    const progress=(message:string)=>{if(valid())mutateExecutionConversations(items=>items.map(c=>c.id!==convId?c:{...c,messages:c.messages.map(m=>m.id===assistantId?{...m,executionConnection:message}:m)}));};
    const failed=(message:string,stopped=false)=>{
      if(epoch!==scopeEpoch.current)return;
      mutateExecutionConversations(items=>items.map(c=>c.id!==convId?c:{...c,messages:c.messages.map(m=>m.id===userId?{...m,attachmentPreparation:{state:stopped?'stopped':'failed',assistantId,error:message}}:m.id===assistantId?{...m,status:stopped?'stopped':'error',error:message,executionConnection:undefined,finishedAt:Date.now()}:m)}));
      if(busyRef.current?.msgId===assistantId){busyRef.current=null;setBusy(null);activeRunRef.current=null;}
    };
    busyRef.current={convId,msgId:assistantId};setBusy(busyRef.current);
    activeRunRef.current={convId,msgId:assistantId,disconnect:()=>controller.abort(),requestStop:()=>{controller.abort();failed('附件准备已停止，已上传文档可重试；未上传文件需重新选择。',true);}};
    patchUser(m=>({...m,attachmentPreparation:{state:'preparing',assistantId}}));
    preparationTimer=window.setTimeout(()=>{
      if(!valid()||transferred)return;
      const message='附件处理等待超时，已上传内容已保留。可重试附件或发送新消息。';
      controller.abort();failed(message);notifyRef.current(message,'err');
    },600000);
    void(async()=>{
      try {
        const current=listRef.current.find(c=>c.id===convId)!.messages.find(m=>m.id===userId)!;
        const files=pendingFilesRef.current.get(userId)??[],imageFiles=files.filter(isImageFile),docFiles=files.filter(file=>!isImageFile(file));
        const images=[...(current.attachments??[])];
        for(let i=0;i<images.length;i++) {
          if(!images[i].assetId.startsWith('pending-'))continue;
          if(!imageFiles[i])throw new Error('图片尚未上传，请重新选择文件并发送。');
          progress(`正在上传图片 ${i+1}/${images.length}…`);
          const uploaded=await uploadImageAsset(imageFiles[i],settingsRef.current.baseUrl,controller.signal);
          if(!valid())return;
          images[i]={...uploaded,previewUrl:images[i].previewUrl};patchUser(m=>({...m,attachments:[...images]}));
        }
        const documents=[...(current.documentAttachments??[])];
        const updateDocument=(i:number,doc:DocumentView)=>{
          documents[i]={...documents[i],documentId:doc.documentId,status:doc.indexStatus==='PENDING'?doc.status:doc.indexStatus,completedChunks:doc.completedChunks,chunkCount:doc.chunkCount,error:doc.error??undefined};
          patchUser(m=>({...m,documentAttachments:[...documents]}));
        };
        for(let i=0;i<documents.length;i++) {
          let doc:DocumentView;
          if(documents[i].documentId) {
            doc=await api.get(documents[i].documentId!,controller.signal);if(!valid())return;
            if(retry&&['FAILED','PAUSED','WAITING_FOR_BUDGET','WAITING_FOR_RECONCILIATION'].some(status=>status===doc.indexStatus||status===doc.status))doc=await api.retry(doc.documentId,controller.signal);
          } else {
            if(!docFiles[i])throw new Error('文档尚未上传，请重新选择文件并发送。');
            progress(`正在上传文档 ${i+1}/${documents.length}…`);
            doc=await uploadDocument(docFiles[i],documents[i].requestId,settingsRef.current.baseUrl,controller.signal,percent=>{if(valid()){documents[i]={...documents[i],percent};patchUser(m=>({...m,documentAttachments:[...documents]}));}});
          }
          if(!valid())return;updateDocument(i,doc);
          let polled=false;
          while(!['READY','COMPLETED','SUCCEEDED','INDEXED'].includes(doc.indexStatus)) {
            if(['FAILED','DELETED','PAUSED','WAITING_FOR_BUDGET','WAITING_FOR_RECONCILIATION'].some(status=>status===doc.indexStatus||status===doc.status))throw new Error(doc.error||`${doc.filename} 处理未完成（${doc.indexStatus}），可点击消息中的“重试附件”。`);
            progress(`正在解析并建立索引：${doc.filename} · ${doc.completedChunks}/${doc.chunkCount} 片段；索引与概要共用免费 Token。`);
            if(polled)await cancellableDelay(1500,controller.signal);polled=true;
            doc=await api.get(doc.documentId,controller.signal);if(!valid())return;updateDocument(i,doc);
          }
        }
        if(!valid())return;
        const conversation=listRef.current.find(c=>c.id===convId)!;
        let context:DocumentConversation|undefined;
        if(documents.length) {
          const ids=[...new Set([...(conversation.documentIds??[]),...documents.map(doc=>doc.documentId!)])];
          progress('正在准备文档问答上下文…');context=await api.createConversation(ids,controller.signal);if(!valid())return;
          // Background document summary/index calls use the same wallet lock.
          const walletDeadline=Date.now()+210000;
          let wallet=await getWallet(settingsRef.current.baseUrl,controller.signal);
          while(valid()&&(wallet.activeUsageId||wallet.blocked)&&!isInArrears(wallet)) {
            if(Date.now()>=walletDeadline)throw new Error('账户调用尚未恢复，已停止等待。已上传文档已保留，可稍后重试附件或发送新消息。');
            progress('文档处理仍占用账户额度，正在等待可用后发起问答…');await cancellableDelay(1500,controller.signal);wallet=await getWallet(settingsRef.current.baseUrl,controller.signal);
          }
          if(isInArrears(wallet))throw new Error('账户已欠费，请充值后重试文档问答。');
        }
        if(!valid())return;
        const route=resolveChatMode(current.content,files,current.selectedMode??'chat',imageContext(conversation));
        const refs=images.length?images.map(imageReference):route.useImages?conversation.imageAttachments:undefined;
        mutateExecutionConversations(items=>items.map(c=>c.id!==convId?c:{...c,...(context?{documentConversationId:context.conversationId,documentIds:context.documentIds,indexVersions:context.indexVersions}:{}),imageAttachments:refs,messages:c.messages.map(m=>m.id===userId?{...m,attachmentPreparation:undefined}:m.id===assistantId?{...m,status:'streaming',error:undefined,executionConnection:'正在提交…'}:m)}));
        const scoped=context?.conversationId??(route.useDocuments?conversation.documentConversationId:undefined);
        const entry:ExecutionRecovery={convId,msgId:assistantId,lastSeq:0,request:{requestId:uid(),type:scoped?'DOCUMENT_QA':'CHAT',question:current.content,...(scoped?{documentConversationId:scoped}:{conversationId:convId}),...(refs?.length?{attachments:refs.map(imageReference)}:{})}};
        recoveryRef.current.push(entry);persistRecovery();pendingFilesRef.current.delete(userId);transferred=true;observeDurable(entry,undefined,false);
      } catch(cause) {
        if(valid()){const message=cause instanceof Error?cause.message:'附件准备失败，请重试';failed(message);notifyRef.current(message,'err');}
      } finally {
        if(preparationTimer!==undefined)window.clearTimeout(preparationTimer);
        if(!transferred&&epoch===scopeEpoch.current&&busyRef.current?.msgId===assistantId){busyRef.current=null;setBusy(null);activeRunRef.current=null;}
      }
    })();
  };

  const retryAttachments=(userId:string)=>{
    if(busyRef.current)return;
    const conv=listRef.current.find(c=>c.messages.some(m=>m.id===userId)),message=conv?.messages.find(m=>m.id===userId);
    if(conv&&message?.attachmentPreparation)prepareAttachments(conv.id,userId,message.attachmentPreparation.assistantId,true);
  };

  const send=(raw:string,input?:File|File[],kind:ChatMode='chat')=>{
    const files=Array.isArray(input)?input:input?[input]:[];
    if((!raw.trim()&&!files.length)||busyRef.current)return false;
    const conversation=listRef.current.find(c=>c.id===activeRef.current),route=resolveChatMode(raw,files,kind,imageContext(conversation));
    if(route.error){notifyRef.current(route.error,'err');return false;}
    const text=attachmentQuestion(raw,files,route.kind);
    if(route.mode!=='image'&&!files.length){sendTextExecution(text,kind);return true;}
    const turn=insertTurn(text,files,route.mode==='image',kind);
    if(route.mode!=='image'){prepareAttachments(turn.convId,turn.user.id,turn.assistant.id);return true;}
    const request:NonNullable<ChatMsg['imageRequest']>={requestId:uid(),conversationId:turn.convId,prompt:text,
      attachments:route.referenceFromContext?conversation?.imageAttachments?.map(imageReference):undefined,state:files.length?'uploading':'submitting'};
    mutateExecutionConversations(items=>items.map(c=>c.id!==turn.convId?c:{...c,messages:c.messages.map(m=>m.id===turn.assistant.id?{...m,imageRequest:request}:m)}));
    submitImageRequest(turn.convId,turn.assistant.id,request,false,files[0],turn.user.id);
    return true;
  };

  /* ---------- 停止 ---------- */
  const stop = () => {
    activeRunRef.current?.requestStop();
  };

  /* ---------- 会话管理 ---------- */
  const select = (id: string) => {
    applyActive(id);
  };

  const newChat = () => {
    if (busyRef.current) return;
    const c: Conversation = {
      id: uid(),
      title: '新对话',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    mutateExecutionConversations(ls=>[c,...ls]);
    applyActive(c.id);activeRef.current=c.id;
  };

  const removeConversation = (id: string) => {
    if (busyRef.current?.convId === id) {
      notifyRef.current('回答进行中，请先停止再删除', 'err');
      return;
    }
    const removed = listRef.current.find((conversation) => conversation.id === id);
    if (removed) releaseAttachmentPreviews(removed.messages);
    setConversations((ls) => ls.filter((c) => c.id !== id));
    recoveryRef.current=recoveryRef.current.filter(entry=>entry.convId!==id);persistRecovery();
    if (activeRef.current === id) {
      setActiveId(null);
      saveActiveSessionId(null, scope);
    }
  };

  const clearContext = () => {
    const conv = listRef.current.find((c) => c.id === activeRef.current);
    if (!conv || busyRef.current) return;
    releaseAttachmentPreviews(conv.messages);
    const nextId=uid();
    mutateExecutionConversations(ls=>ls.map(c=>c.id===conv.id?{...c,id:nextId,messages:[],imageAttachments:undefined,documentConversationId:undefined,documentIds:undefined,indexVersions:undefined,updatedAt:Date.now()}:c));
    recoveryRef.current=recoveryRef.current.filter(entry=>entry.convId!==conv.id);persistRecovery();
    applyActive(nextId);activeRef.current=nextId;
    notifyRef.current('已清空当前会话');
  };

  return {
    conversations,
    activeId,
    busy,
    send,
    stop,
    select,
    newChat,
    removeConversation,
    clearContext,
    resumeExecution,
    setDocumentContext,
    retryAttachments,
  };
}
