import { useEffect, useRef, useState } from 'react';
import type {
  ChatEvent,
  ChatMsg,
  Conversation,
  EndReason,
  ImageAttachment,
  ImageJobEventData,
  ImageJobRef,
  SceneCardEventData,
  SessionInfoData,
  Settings,
  ToolCallFailedData,
  ToolCallItem,
  ToolCallResultData,
  ToolCallStartedData,
} from '../types';
import { EVENT } from '../types';
import {
  streamChat,
  fetchConversationImageJobs,
  fetchImageJob,
  uploadImageAsset,
} from '../lib/api';
import { ImageJobNotFoundError, reconcileImageJobs } from '../lib/imageJobPolling';
import { generateImage } from '../lib/zine';
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
import { readModelStatus, providerLabel } from '../lib/modelStatus';
import { loadExecutionRecovery, saveExecutionRecovery, type ExecutionRecovery } from '../lib/executionRecovery';
import { cancellableDelay, observeExecution, reconnectDelay } from '../lib/executionRunner';
import type { DocumentConversation } from '../api/documents';

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

/** DATA 增量用 rAF 节流提交，避免逐条高频 setState。 */
const RAF =
  typeof requestAnimationFrame !== 'undefined'
    ? requestAnimationFrame
    : (cb: () => void) => window.setTimeout(cb, 16);
const CAF =
  typeof cancelAnimationFrame !== 'undefined'
    ? cancelAnimationFrame
    : (id: number) => window.clearTimeout(id);

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
  const attachmentPreviewRef = useRef(new Map<string, string>());

  const restoreAttachmentPreviews = (items: Conversation[]) =>
    items.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => {
        if (!message.attachments?.length) return message;
        const previewUrl = attachmentPreviewRef.current.get(message.id);
        if (!previewUrl) return message;
        const attachments = message.attachments.map((attachment) =>
          attachment.previewUrl ? attachment : { ...attachment, previewUrl },
        );
        return { ...message, attachments };
      }),
    }));

  const releaseAttachmentPreviews = (messages: ChatMsg[]) => {
    messages.forEach((message) => {
      const previewUrl = attachmentPreviewRef.current.get(message.id);
      if (!previewUrl) return;
      URL.revokeObjectURL(previewUrl);
      attachmentPreviewRef.current.delete(message.id);
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
    attachmentPreviewRef.current.forEach((previewUrl) => URL.revokeObjectURL(previewUrl));
    attachmentPreviewRef.current.clear();
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
    imagePollersRef.current.clear();
    saveConversations(listRef.current.map(c => ({ ...c, messages:c.messages.map(m => m.status==='streaming'&&!m.execution ? {...m,status:'stopped' as const,endReason:'aborted' as const,finishedAt:Date.now()} : m) })), scope);
    attachmentPreviewRef.current.forEach(url => URL.revokeObjectURL(url));
    attachmentPreviewRef.current.clear();
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
    setConversations((ls) => ls.map((c) => c.id !== convId ? c : {
      ...c,
      messages: c.messages.map((m) => m.id !== msgId ? m : {
        ...m,
        imageJobs: [...(m.imageJobs ?? []).filter((item) => item.jobId !== job.jobId), job],
      }),
    }));
  };

  const removeImageJob = (convId: string, msgId: string, jobId: string) => {
    setConversations((ls) => ls.map((c) => c.id !== convId ? c : {
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
    if (jobs === null || epoch!==scopeEpoch.current) return;
    setConversations((ls) => ls.map((c) => {
      if (c.id !== convId) return c;
      return reconcileImageJobs(c, jobs);
    }));
    const assistantId = listRef.current.find((c) => c.id === convId)?.messages.filter((m) => m.role === 'assistant').at(-1)?.id;
    if (assistantId) jobs.filter((job) => job.status === 'QUEUED' || job.status === 'PROCESSING').forEach((job) => watchImageJob(convId, assistantId, job.jobId));
  };

  const mutateExecutionConversations=(fn:(items:Conversation[])=>Conversation[])=>{
    const next=fn(listRef.current);listRef.current=next;setConversations(next);saveConversations(next,ownerRef.current);
  };
  const persistRecovery=()=>saveExecutionRecovery(ownerRef.current,recoveryRef.current);
  const patchExecution=(entry:ExecutionRecovery,view?:ExecutionView,connection='')=>{
    mutateExecutionConversations(items=>items.map(c=>c.id!==entry.convId?c:{...c,updatedAt:Date.now(),messages:c.messages.map(m=>m.id!==entry.msgId?m:{
      ...m,...(view?{execution:view,content:view.answer,status:isExecutionActive(view)?'streaming' as const:view.status==='FAILED'?'error' as const:view.status==='COMPLETED'?'done' as const:'stopped' as const,error:view.error??undefined,finishedAt:isExecutionActive(view)?undefined:Date.now()}:{}),executionConnection:connection,
    })}));
  };
  const observeDurable=(entry:ExecutionRecovery,initial?:ExecutionView,recover=true)=>{
    if(executionObservers.current.has(entry.msgId))return;
    const epoch=scopeEpoch.current,controller=new AbortController(),api=executionApi(settingsRef.current.baseUrl);
    executionObservers.current.set(entry.msgId,controller);
    const valid=()=>epoch===scopeEpoch.current&&!controller.signal.aborted;
    const publish=(view:ExecutionView)=>{
      if(!valid())return;
      entry.executionId=view.executionId;entry.lastSeq=view.lastSeq;persistRecovery();patchExecution(entry,view);
      if(isExecutionActive(view)) {
        busyRef.current={convId:entry.convId,msgId:entry.msgId};setBusy(busyRef.current);
      }
    };
    const stopRequest=()=>{
      if(!valid())return;
      entry.stopRequested=true;persistRecovery();patchExecution(entry,undefined,'正在请求停止…');
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
        if(!view||!valid())return;
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
          mutateExecutionConversations(items=>items.map(c=>c.id!==entry.convId?c:{...c,messages:c.messages.map(m=>m.id!==entry.msgId?m:{...m,status:'stopped'})}));
          // Keep the original request ID for uncertain create/resume outcomes.
        }
      } finally {
        if(epoch===scopeEpoch.current) {
          executionObservers.current.delete(entry.msgId);
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

  const sendTextExecution=(text:string)=>{
    let conv=listRef.current.find(c=>c.id===activeRef.current);
    const now=Date.now();
    if(!conv) {conv={id:uid(),title:deriveTitle(text),messages:[],createdAt:now,updatedAt:now};applyActive(conv.id);activeRef.current=conv.id;}
    const user:ChatMsg={id:uid(),role:'user',content:text,createdAt:now};
    const assistant:ChatMsg={id:uid(),role:'assistant',content:'',createdAt:now+1,startedAt:now,status:'streaming',executionConnection:'正在提交…'};
    const next={...conv,title:conv.title==='新对话'?deriveTitle(text):conv.title,messages:[...conv.messages,user,assistant],updatedAt:now};
    mutateExecutionConversations(items=>items.some(c=>c.id===next.id)?items.map(c=>c.id===next.id?next:c):[next,...items]);
    const entry:ExecutionRecovery={convId:next.id,msgId:assistant.id,lastSeq:0,request:{requestId:uid(),type:conv.documentConversationId?'DOCUMENT_QA':'CHAT',question:text,...(conv.documentConversationId?{documentConversationId:conv.documentConversationId}:{conversationId:conv.id})}};
    recoveryRef.current.push(entry);persistRecovery();observeDurable(entry,undefined,false);
  };

  const resumeExecution=(msgId:string,instruction?:string)=>{
    if(busyRef.current)return;
    const conv=listRef.current.find(c=>c.messages.some(m=>m.id===msgId));const message=conv?.messages.find(m=>m.id===msgId);const view=message?.execution;
    let entry=recoveryRef.current.find(item=>item.msgId===msgId);
    if(!entry&&conv&&view)entry={convId:conv.id,msgId,executionId:view.executionId,lastSeq:view.lastSeq,request:{requestId:view.requestId,type:view.type,question:view.question,...(conv.documentConversationId?{documentConversationId:conv.documentConversationId}:{conversationId:conv.id})}};
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

  /* ---------- 发送（SSE 状态机） ---------- */
  const send = (raw: string, file?: File, kind:'image'|'chat'='image') => {
    const text = raw.trim();
    if ((!text && !file) || busyRef.current) return;
    if(!file){sendTextExecution(text);return;}

    let convId = activeRef.current ?? '';
    const exists = listRef.current.some((c) => c.id === convId);
    if (!exists) {
      convId = uid();
      applyActive(convId);
    }

    const now = Date.now();
    const localPreviewUrl = file ? URL.createObjectURL(file) : undefined;
    const userMsg: ChatMsg = {
      id: uid(),
      role: 'user',
      content: text,
      createdAt: now,
      attachments: file ? [{ assetId: 'pending', fileName: file.name, mimeType: file.type, fileSize: file.size, previewUrl: localPreviewUrl }] : undefined,
    };
    const asstMsg: ChatMsg = {
      id: uid(),
      role: 'assistant',
      content: '',
      status: 'streaming',
      createdAt: now + 1,
      startedAt: now,
    };
    if (localPreviewUrl) attachmentPreviewRef.current.set(userMsg.id, localPreviewUrl);

    // 注入用户消息 + 空助手消息（同时承担新会话的首次创建）
    setConversations((ls) => {
      const has = ls.some((c) => c.id === convId);
      const conv: Conversation = {
        id: convId,
        title: deriveTitle(text || '图片创作'),
        messages: [userMsg, asstMsg],
        createdAt: now,
        updatedAt: now,
      };
      return has
        ? ls.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  title: c.title === '新对话' ? deriveTitle(text || '图片创作') : c.title,
                  messages: [...c.messages, userMsg, asstMsg],
                  updatedAt: now,
                }
              : c,
          )
        : [conv, ...ls];
    });

    const epoch = scopeEpoch.current;
    const convId2 = convId;
    const asstId = asstMsg.id;
    const controller = new AbortController();

    let settled = false;
    let stopRequested = false;
    let sawStop = false;

    /** 定向更新当前助手消息（其它消息/会话保持引用不变，利于 memo） */
    const patchAsst = (fn: (m: ChatMsg) => ChatMsg) =>
      setConversations((ls) => epoch!==scopeEpoch.current ? ls :
        ls.map((c) =>
          c.id !== convId2
            ? c
            : { ...c, messages: c.messages.map((m) => (m.id === asstId ? fn(m) : m)) },
        ),
      );

    const patchUser = (attachment: ImageAttachment) =>
      setConversations((ls) => epoch!==scopeEpoch.current ? ls : ls.map((c) => c.id !== convId2 ? c : {
        ...c,
        messages: c.messages.map((m) => {
          if (m.id !== userMsg.id) return m;
          const previewUrl = m.attachments?.[0]?.previewUrl
            ?? attachment.previewUrl
            ?? attachmentPreviewRef.current.get(m.id);
          if (previewUrl) attachmentPreviewRef.current.set(m.id, previewUrl);
          return {
            ...m,
            attachments: [{ ...attachment, ...(previewUrl ? { previewUrl } : {}) }],
          };
        }),
      }));

    /* --- DATA 增量：缓冲区 + rAF 节流提交 --- */
    let textBuf = '';
    let rafId: number | null = null;
    const commitText = (delta: string) => patchAsst((m) => ({ ...m, content: m.content + delta }));
    const flushText = () => {
      if (rafId != null) {
        CAF(rafId);
        rafId = null;
      }
      if (textBuf) {
        const d = textBuf;
        textBuf = '';
        commitText(d);
      }
    };
    const pushText = (delta: string) => {
      textBuf += delta;
      if (rafId == null) {
        rafId = RAF(() => {
          rafId = null;
          const d = textBuf;
          textBuf = '';
          if (d) commitText(d);
        });
      }
    };

    /* --- 直播字段写入 --- */
    const addToolStarted = (d: ToolCallStartedData) =>
      patchAsst((m) => ({
        ...m,
        toolCalls: [
          ...(m.toolCalls ?? []),
          {
            localId: uid(),
            toolCallId: d.toolCallId || '',
            toolName: d.toolName,
            argumentsRaw: d.arguments,
            status: 'running' as const,
          } satisfies ToolCallItem,
        ],
      }));

    /** 更新最后一张匹配条件的工具卡片（RESULT/FAILED 只带 toolName，按最近一张 running 匹配） */
    const updateToolBy = (
      find: (t: ToolCallItem) => boolean,
      patch: (t: ToolCallItem) => ToolCallItem,
    ) =>
      patchAsst((m) => {
        const calls = m.toolCalls ?? [];
        let idx = -1;
        for (let i = calls.length - 1; i >= 0; i--) {
          if (find(calls[i])) {
            idx = i;
            break;
          }
        }
        if (idx < 0) return m;
        const next = calls.slice();
        next[idx] = patch(next[idx]);
        return { ...m, toolCalls: next };
      });

    const finishToolResult = (d: ToolCallResultData) =>
      updateToolBy(
        (t) => t.status === 'running' && t.toolName === d.toolName,
        (t) => ({ ...t, status: 'ok' as const, result: d.result }),
      );

    const finishToolFailed = (d: ToolCallFailedData) =>
      updateToolBy(
        (t) => t.status === 'running' && t.toolName === d.toolName,
        (t) => ({ ...t, status: 'failed' as const, error: d.error }),
      );

    const setSessionInfo = (d: SessionInfoData | null) => {
      // 防御：SESSION_INFO 的 eventData 理论上是对象，跨端异常时按 null 处理
      if (d && typeof d.conversationId === 'string' && d.conversationId) {
        patchAsst((m) => (m.conversationId ? m : { ...m, conversationId: d.conversationId }));
      }
    };

    /**
     * 统一收尾：刷新文本缓冲 → 更新状态/结束原因 → 中断仍在运行的卡片 → 复位按钮。
     * 1002(STOP) 与 1004(ERROR) 均为终结信号，其余路径也走这里。
     */
    const finish = (
      status: ChatMsg['status'],
      opts: { error?: string; endReason: EndReason } = { endReason: 'stop' },
    ) => {
      if (settled) return;
      settled = true;
      flushText();
      if(epoch!==scopeEpoch.current)return;
      patchAsst((m) => {
        const calls = m.toolCalls ?? [];
        const hasRunning = calls.some((t) => t.status === 'running');
        return {
          ...m,
          status,
          finishedAt: Date.now(),
          error: opts.error,
          endReason: opts.endReason,
          toolCalls: hasRunning
            ? calls.map((t) => (t.status === 'running' ? { ...t, status: 'stopped' as const } : t))
            : calls,
        };
      });
      setConversations((ls) =>
        ls.map((c) => (c.id === convId2 ? { ...c, updatedAt: Date.now() } : c)),
      );
      busyRef.current = null;
      setBusy(null);
      activeRunRef.current = null;
      if (activeRef.current !== convId2) {
        notifyRef.current(status === 'error' ? `「${deriveTitle(text, 10)}」回答出错` : '后台会话已结束');
      }
    };

    /**
     * 停止本次生成：
     * 直接中断浏览器流；后端会按连接异常保存已生成的部分消息。
     */
    const requestStop = () => {
      if (settled || stopRequested) return;
      stopRequested = true;
      controller.abort();
    };

    activeRunRef.current = { convId: convId2, msgId: asstId, requestStop };
    busyRef.current = { convId: convId2, msgId: asstId };
    setBusy({ convId: convId2, msgId: asstId });

    /** 后端事件分派。思考过程和工具事件只用于兼容旧协议，不渲染到界面。 */
    const onLiveEvent = (e: ChatEvent) => {
      if(epoch!==scopeEpoch.current)return;
      switch (e.eventType) {
        case EVENT.DATA:
          if (typeof e.eventData === 'string' && e.eventData) pushText(e.eventData);
          break;
        case EVENT.ANSWER_REPLACE: {
          const data=e.eventData as {payload?:{text?:unknown}} | null;
          if(typeof data?.payload?.text==='string'){
            if(rafId!=null){CAF(rafId);rafId=null;}
            textBuf='';patchAsst(m=>({...m,content:data.payload!.text as string}));
          }
          break;
        }
        case EVENT.MODEL_STATUS: {
          const data=e.eventData as {generationVersion?:number;payload?:unknown} | null;
          const status=readModelStatus(data?.payload);
          if(status&&Number.isInteger(data?.generationVersion))patchAsst(m=>
            (m.modelStatus?.generationVersion??0)>(data!.generationVersion as number)?m:
              {...m,modelStatus:{...status,generationVersion:data!.generationVersion}});
          break;
        }
        case EVENT.FALLBACK_STARTED: {
          const data=e.eventData as {payload?:unknown}|null;
          const status=readModelStatus(data?.payload);
          notifyRef.current(status?`${providerLabel(status.provider)}兜底模型正在接手`:'主回答服务暂时不可用，备用模型正在接手');
          break;
        }
        case EVENT.REASONING: {
          // 思考过程只兼容旧协议，产品界面不保存也不展示。
          break;
        }
        case EVENT.TOOL_CALL_STARTED: {
          const d = e.eventData as ToolCallStartedData | null;
          if (d && typeof d.toolName === 'string') addToolStarted(d);
          break;
        }
        case EVENT.TOOL_CALL_RESULT: {
          const d = e.eventData as ToolCallResultData | null;
          if (d && typeof d.toolName === 'string' && typeof d.result === 'string')
            finishToolResult(d);
          break;
        }
        case EVENT.TOOL_CALL_FAILED: {
          const d = e.eventData as ToolCallFailedData | null;
          if (d && typeof d.toolName === 'string' && typeof d.error === 'string')
            finishToolFailed(d);
          break;
        }
        case EVENT.USAGE:
          break;
        case EVENT.SESSION_INFO:
          setSessionInfo(e.eventData as SessionInfoData);
          break;
        case EVENT.IMAGE_JOB: {
          const d = e.eventData as ImageJobEventData | null;
          if (d && typeof d.jobId === 'string' && d.jobId) {
            const job: ImageJobRef = { jobId: d.jobId, status: d.status, mode: d.mode, createdAt: d.createdAt };
            patchJob(convId2, asstId, job);
            watchImageJob(convId2, asstId, d.jobId);
          }
          break;
        }
        case EVENT.SCENE_CARD: {
          const d = e.eventData as SceneCardEventData | null;
          if (d && typeof d.summary === 'string') patchAsst((m) => ({ ...m, sceneCard: d }));
          break;
        }
        case EVENT.WAITING_FOR_INSTRUCTION:
          patchAsst((m) => ({ ...m, waitingForInstruction: true }));
          break;
        case EVENT.STOP:
          sawStop = true;
          finish(stopRequested ? 'stopped' : 'done', {
            endReason: stopRequested ? 'stopped_by_user' : 'stop',
          });
          break;
        case EVENT.ERROR: {
          const text =
            typeof e.eventData === 'string' && e.eventData ? e.eventData : '未知错误';
          finish('error', { error: text, endReason: 'error' });
          break;
        }
        default:
          // 未知 / 预留事件（如 1003 PARAM）：安全忽略，不中断流
          break;
      }
    };

    const run = (async () => {
      if (file && kind === 'image') {
        try {
          const result = await generateImage(settingsRef.current.baseUrl,file,text,controller.signal);
          patchAsst(m => ({...m,zineRequestId:result.requestId,zineResult:result,content:'图片创作已完成。'}));
          finish('done',{endReason:'stop'});
        } catch(cause) {
          if(epoch!==scopeEpoch.current)return;
          const message = controller.signal.aborted ? '已停止等待。已受理的消费可能需要对账，请到用户页查看余额和生成回执。' : cause instanceof Error ? cause.message : '生成结果暂时无法读取，请到用户页恢复回执';
          finish(controller.signal.aborted?'stopped':'error',{error:message,endReason:controller.signal.aborted?'stopped_by_user':'error'});
          notifyRef.current(message,'err',{label:'查看账户',on:()=>openSettingsRef.current()});
        }
        return;
      }
      let uploadedAttachment: ImageAttachment | undefined;
      if (file) {
        try {
          uploadedAttachment = await uploadImageAsset(file, settingsRef.current.baseUrl, controller.signal);
          patchUser({ ...uploadedAttachment, previewUrl: localPreviewUrl });
        } catch (error) {
          const message = error instanceof Error ? error.message : '照片上传失败';
          finish('error', { error: message, endReason: 'error' });
          return;
        }
      }

      if(epoch!==scopeEpoch.current||controller.signal.aborted){finish('stopped',{endReason:'aborted'});return;}
      const res = await streamChat({
        question: text,
        sessionId: convId2, // 会话 id 即后端 sessionId，对话/停止/历史/清空统一携带
        baseUrl: settingsRef.current.baseUrl,
        attachments: uploadedAttachment ? [uploadedAttachment] : undefined,
        signal: controller.signal,
        onEvent: onLiveEvent,
      });

      if (epoch===scopeEpoch.current && !settled) {
        if (res.kind === 'error') {
          // 请求前就失败（HTTP 非 200 / 网络不可达）
          finish('error', { error: res.message, endReason: 'error' });
          notifyRef.current(res.message ?? '连接后端失败', 'err', {
            label: '查看账户',
            on: () => openSettingsRef.current(),
          });
        } else if (res.kind === 'timeout') {
          // 流空闲超时（60s 无数据，本地兜底断连）
          finish('stopped', { endReason: 'aborted' });
          notifyRef.current(res.message ?? '连接空闲超时，已自动中断', 'err');
        } else if (sawStop) {
          finish(stopRequested ? 'stopped' : 'done', {
            endReason: stopRequested ? 'stopped_by_user' : 'stop',
          });
        } else {
          // 流关闭但既无 1002 也无 1004：连接异常中断
          const userStopped = stopRequested;
          finish('stopped', { endReason: userStopped ? 'stopped_by_user' : 'aborted' });
          if (!userStopped) notifyRef.current('连接中断，已保留已生成的部分内容', 'err');
        }
      }
    })();
    void run;
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
    setConversations((ls) => [c, ...ls]);
    applyActive(c.id);
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
    mutateExecutionConversations(ls=>ls.map(c=>c.id===conv.id?{...c,id:nextId,messages:[],documentConversationId:undefined,documentIds:undefined,indexVersions:undefined,updatedAt:Date.now()}:c));
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
  };
}
