import { memo } from 'react';
import type { ChatMsg } from '../types';
import Markdown from '../lib/markdown';
import { AgentOrb } from './Avatar';
import { IconUser } from './icons';
import { ImageJobCard } from './ImageJobCard';
import ThoughtLine from './ThoughtLine.jsx';
import ZineResultCard from './ZineResultCard';
import ExecutionDetails from './ExecutionDetails';
import ModelStatusBadge from './ModelStatusBadge';

export const MessageItem = memo(function MessageItem({ msg, baseUrl, signedIn, onOpenProfile, onRemix, onResume, onRetryAttachments }: {
  msg: ChatMsg;
  baseUrl: string;
  signedIn: boolean;
  onOpenProfile: () => void;
  onRemix?: (imageUrl: string) => void;
  onResume?:(id:string,instruction?:string)=>void;
  onRetryAttachments?:(id:string)=>void;
}) {
  const isUser = msg.role === 'user';
  const isStreaming = msg.status === 'streaming';

  return (
    <div className={`msg ${isUser ? 'user' : 'assistant'}`}>
      {!isUser ? (
        <div className="assistant-leading">
          <div className="avatar"><AgentOrb pulse={isStreaming && !msg.content} /></div>
          <ThoughtLine
            working={isStreaming}
            startedAt={msg.startedAt ?? msg.createdAt}
            finishedAt={msg.finishedAt}
            steps={['Reading the question', 'Searching your notes', 'Drafting an answer']}
            label="Thinking…"
            glyph="sparkle"
            fontSize={13}
            breathPeriod={1.6}
            breathDepth={0.45}
            settleDuration={350}
            settleBlur={2}
            collapsible
            collapseOnSettle
            showTimer={isStreaming || msg.finishedAt != null}
            doneLabel={msg.finishedAt != null ? 'Thought for' : '已完成'}
          />
        </div>
      ) : <div className="avatar av-user"><IconUser size={17} /></div>}
      <div className="msg-body">
        {isUser ? (
          <>
            {msg.attachments?.map((attachment) => (
              <div className="user-image-message" key={`${attachment.assetId}-${attachment.fileName}`}>
                {attachment.previewUrl ? <img src={attachment.previewUrl} alt="用户发送的图片" /> : <div className="user-image-placeholder">图片已上传</div>}
                <span>{attachment.fileName}</span>
              </div>
            ))}
            {msg.documentAttachments?.map((attachment,index)=><div className="user-document-message" key={attachment.requestId||index}>
              <strong>▤ {attachment.fileName}</strong><small>{attachment.error??({UPLOADING:'正在上传',UPLOADED:'已上传',PENDING:'等待处理',PARSING:'正在解析',EMBEDDING:'正在建立索引',WAITING_FOR_BUDGET:'等待额度',WAITING_FOR_RECONCILIATION:'等待用量对账',INDEXING:'正在建立索引',PROCESSING:'正在解析',READY:'索引已就绪',COMPLETED:'索引已就绪',FAILED:'处理失败'}[attachment.status]??attachment.status)}{attachment.status==='UPLOADING'&&attachment.percent!=null?` ${attachment.percent}%`:attachment.chunkCount?` · ${attachment.completedChunks??0}/${attachment.chunkCount} 片段`:''}</small>
            </div>)}
            {msg.attachmentPreparation&&<div className="msg-hint" role="status">{msg.attachmentPreparation.error??'正在准备附件…'}{msg.attachmentPreparation.state!=='preparing'&&onRetryAttachments&&<button type="button" onClick={()=>onRetryAttachments(msg.id)}>重试附件</button>}</div>}
            {msg.content && <div className="bubble">{msg.content}</div>}
          </>
        ) : (
          <>
            {!msg.execution && <ModelStatusBadge status={msg.modelStatus} taskStatus={msg.status}/>}
            {msg.content && <div className="bubble-plain"><Markdown content={msg.content} />{isStreaming && <span className="caret" />}</div>}
            {msg.sceneCard && (
              <div className="bubble-plain scene-card">
                <strong>图片理解</strong>
                <div>{msg.sceneCard.summary}</div>
                {msg.sceneCard.palette && <small>主色：{msg.sceneCard.palette}</small>}
                {msg.sceneCard.mood && <small>情绪：{msg.sceneCard.mood}</small>}
              </div>
            )}
            {msg.waitingForInstruction && <div className="msg-hint">已准备好，告诉我下一步想识别、生成或修改什么。</div>}
            {msg.error && <div className="msg-error">⚠ {msg.error}</div>}
            <ExecutionDetails msg={msg} baseUrl={baseUrl} onResume={onResume}/>
            {msg.zineRequestId && signedIn && <ZineResultCard baseUrl={baseUrl} requestId={msg.zineRequestId} initial={msg.zineResult} onRemix={onRemix}/>}
            {msg.imageJobs?.map((job) => <ImageJobCard key={job.jobId} job={job} baseUrl={baseUrl} signedIn={signedIn} onManage={onOpenProfile} onRemix={onRemix} />)}
          </>
        )}
      </div>
    </div>
  );
});
