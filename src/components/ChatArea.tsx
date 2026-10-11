import { useEffect, useRef, useState } from 'react';
import type { ChatMsg } from '../types';
import { MessageItem } from './MessageItem';
import EmptyState from './EmptyState';
import Composer from './Composer';
import { IconBroom, IconMenu } from './icons';
import PillNav from './PillNav';
import type { AuthUser } from '../lib/auth';
import type { Wallet } from '../lib/billing';
import boboMark from '../assets/bobo-mark.svg';
import DocumentPanel from './DocumentPanel';
import type { DocumentConversation } from '../api/documents';

interface Props {
  title: string;
  messages: ChatMsg[];
  busy: boolean;
  baseUrl: string;
  signedIn: boolean;
  onSend: (q: string, file?: File, kind?:'image'|'chat') => Promise<boolean>;
  wallet: Wallet|null;
  onStop: () => void;
  onClear: () => void;
  onOpenSettings: () => void;
  onOpenLogin: () => void;
  onGoHome: () => void;
  onOpenProfile: () => void;
  user: AuthUser | null;
  onToggleNav: () => void;
  onRemix?: (imageUrl: string) => void;
  accountScope:string;
  documentContextId?:string;
  documentIds?:string[];
  onDocumentContext:(value:DocumentConversation|null)=>void;
  onResume:(msgId:string,instruction?:string)=>void;
}

export default function ChatArea({
  title,
  messages,
  busy,
  baseUrl,
  signedIn,
  wallet,
  onSend,
  onStop,
  onClear,
  onOpenSettings,
  onOpenLogin,
  onGoHome,
  onOpenProfile,
  user,
  onToggleNav,
  onRemix,
  accountScope,
  documentContextId,
  documentIds,
  onDocumentContext,
  onResume,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [draft, setDraft] = useState('');

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  };

  const isEmpty = messages.length === 0;

  // 有新 token / 消息变化时自动吸底
  useEffect(() => {
    const el = scrollRef.current;
    if (el && (stickRef.current || !busy)) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, busy]);

  const sendText = (q: string) => {
    setDraft(q);
    stickRef.current = true;
  };

  return (
    <section className="main">
      <header className="topbar">
        <button className="icon-btn light menu-btn" onClick={onToggleNav} aria-label="打开菜单">
          <IconMenu size={18} />
        </button>
        <div className="topbar-title">
          <span>{title}</span>
        </div>
        <button
          className="icon-btn light"
          onClick={onClear}
          title="清空当前会话"
          aria-label="清空上下文"
          disabled={isEmpty || busy}
          style={isEmpty || busy ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
        >
          <IconBroom size={16} />
        </button>
        <PillNav
          logo={boboMark}
          logoAlt="bobo"
          items={[
            { label: '首页', href: '#start', onClick: onGoHome },
            { label: '设置', href: '#settings', onClick: onOpenSettings },
            { label: user ? user.username : '登录', href: '#profile', onClick: user ? onOpenProfile : onOpenLogin },
          ]}
          activeHref="#profile"
          ease="power2.out"
          baseColor="#17171a"
          pillColor="#fbfbfc"
          hoveredPillTextColor="#ffffff"
          pillTextColor="#17171a"
          initialLoadAnimation={false}
        />
      </header>

      <DocumentPanel baseUrl={baseUrl} accountScope={accountScope} signedIn={signedIn} busy={busy} contextId={documentContextId} documentIds={documentIds} onContext={onDocumentContext} onLogin={onOpenLogin}/>

      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="chat-inner">
          {isEmpty ? (
            <EmptyState onAsk={sendText} />
          ) : (
            messages.map((m) => <MessageItem key={m.id} msg={m} baseUrl={baseUrl} signedIn={signedIn} onOpenProfile={onOpenProfile} onRemix={onRemix} onResume={busy?undefined:onResume} />)
          )}
        </div>
      </div>

      <Composer
        value={draft}
        onChange={setDraft}
        onSend={async(file,kind) => {
          const t = draft.trim();
          if ((!t && !file) || busy) return false;
          const accepted = await onSend(t || '请根据这张照片进行一次有创意的二次生成。', file,kind);
          if (accepted) { setDraft(''); stickRef.current = true; }
          return accepted;
        }}
        wallet={wallet} signedIn={signedIn} onOpenAccount={onOpenProfile}
        onStop={onStop}
        running={busy}
      />
    </section>
  );
}
