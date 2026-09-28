import { memo } from 'react';
import type { ChatMsg } from '../types';
import Markdown from '../lib/markdown';
import { AgentOrb } from './Avatar';
import { IconUser } from './icons';
import { ImageJobCard } from './ImageJobCard';
import ThoughtLine from './ThoughtLine.jsx';

export const MessageItem = memo(function MessageItem({ msg, baseUrl, signedIn, onOpenProfile }: {
  msg: ChatMsg;
  baseUrl: string;
  signedIn: boolean;
  onOpenProfile: () => void;
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
            steps={['Reading the question', 'Searching your notes', 'Drafting an answer']}
            label="Thinking…"
            doneLabel="Thought for"
            glyph="sparkle"
            fontSize={16}
            breathPeriod={1.6}
            breathDepth={0.45}
            settleDuration={350}
            settleBlur={2}
            collapsible
            collapseOnSettle
            showTimer
            onSettle={(seconds: number) => console.log(`thought for ${seconds}s`)}
          />
        </div>
      ) : <div className="avatar av-user"><IconUser size={17} /></div>}
      <div className="msg-body">
        {isUser ? (
          <>
            {msg.attachments?.map((attachment) => (
              <div className="user-image-message" key={attachment.assetId}>
                {attachment.previewUrl ? <img src={attachment.previewUrl} alt="用户发送的图片" /> : <div className="user-image-placeholder">图片已上传</div>}
                <span>{attachment.fileName}</span>
              </div>
            ))}
            {msg.content && <div className="bubble">{msg.content}</div>}
          </>
        ) : (
          <>
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
            {msg.imageJobs?.map((job) => <ImageJobCard key={job.jobId} job={job} baseUrl={baseUrl} signedIn={signedIn} onManage={onOpenProfile} />)}
          </>
        )}
      </div>
    </div>
  );
});
