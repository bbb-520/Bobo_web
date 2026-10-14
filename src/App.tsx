import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import './components/admin-panel.css';
import { useConversations } from './hooks/useConversations';
import { useSettings } from './hooks/useSettings';
import { useToasts } from './hooks/useToasts';
import { useBilling } from './hooks/useBilling';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import SettingsSheet from './components/SettingsSheet';
import StartPage from './components/StartPage';
import SetupGuide from './components/SetupGuide';
import OnboardingBubbles from './components/OnboardingBubbles';
import UserProfileSheet from './components/UserProfileSheet';
import { getMe, type AuthUser } from './lib/auth';
import { billingWarningMessage, isInArrears } from './lib/billing';
import { isExecutionActive } from './api/executions';
import { resolveChatMode, type ChatMode } from './lib/chatModes';
const BoboWorld = lazy(() => import('./components/BoboWorld'));
const AboutBobo = lazy(() => import('./components/AboutBobo'));
const PromptLibrary = lazy(() => import('./components/prompts/PromptLibrary'));
type Page = 'start' | 'chat' | 'settings' | 'about' | 'world' | 'profile' | 'prompts';
function pageFromHash(): Page {
  const hash = window.location.hash.replace(/^#/, '');
  return ['chat', 'settings', 'about', 'world', 'profile', 'prompts'].includes(hash)
    ? (hash as Page)
    : 'start';
}
export default function App() {
  const [navOpen, setNavOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(288);
  const [page, setPage] = useState<Page>(pageFromHash);
  const underlyingPage = useRef<Page>('chat');
  const currentPage = useRef(page);
  const promptTrigger = useRef<HTMLElement | null>(null);
  const navigatePage = (next: Page) => {
    if (next === 'prompts' && currentPage.current !== 'prompts') {
      underlyingPage.current = currentPage.current;
      promptTrigger.current = document.activeElement as HTMLElement | null;
    }
    currentPage.current = next;
    setPage(next);
  };
  const renderPage = page === 'prompts' ? underlyingPage.current : page;
  useEffect(() => {
    if (page !== 'prompts' && promptTrigger.current?.isConnected) {
      promptTrigger.current.focus();
      promptTrigger.current = null;
    }
  }, [page]);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const { toasts, push, dismissToast } = useToasts();
  const { settings, updateSettings } = useSettings();
  const generationLock = useRef(false);
  const authRevision = useRef(0);
  const authRequest = useRef<AbortController | null>(null);
  const updateUser = (next: AuthUser | null) => {
    authRevision.current++;
    authRequest.current?.abort();
    setUser(next);
    setAuthChecking(false);
  };
  useEffect(() => {
    const changed = () => navigatePage(pageFromHash());
    window.addEventListener('popstate', changed);
    window.addEventListener('hashchange', changed);
    return () => {
      window.removeEventListener('popstate', changed);
      window.removeEventListener('hashchange', changed);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);
  useEffect(() => {
    const request = new AbortController();
    authRequest.current = request;
    authRevision.current++;
    setUser(null);
    setAuthChecking(true);
    getMe(settings.baseUrl, request.signal)
      .then((next) => {
        if (!request.signal.aborted) setUser(next);
      })
      .catch(() => {
        if (!request.signal.aborted) setUser(null);
      })
      .finally(() => {
        if (!request.signal.aborted) setAuthChecking(false);
      });
    return () => request.abort();
  }, [settings.baseUrl]);
  const goto = (next: Page) => {
    window.history.pushState(
      null,
      '',
      `${window.location.pathname}${window.location.search}${next === 'start' ? '' : `#${next}`}`,
    );
    navigatePage(next);
  };
  const openChat = () => {
    goto('chat');
    if (!user) setLoginOpen(true);
  };
  const billing = useBilling(settings.baseUrl, user?.userId, {
    onWarning: (wallet) =>
      push(
        billingWarningMessage(wallet) ?? '余额即将用完，请及时充值',
        isInArrears(wallet) ? 'err' : 'info',
        { label: '去充值', on: () => goto('profile') },
      ),
    onUnauthenticated: () => {
      updateUser(null);
      push('登录已过期，请重新登录', 'err', {
        label: '登录',
        on: () => setLoginOpen(true),
      });
    },
  });
  const chat = useConversations({
    settings,
    accountScope: `${settings.baseUrl}:${user?.userId ?? user?.username ?? 'guest'}`,
    notify: push,
    openSettings: () => goto('profile'),
  });
  const inArrears = isInArrears(billing.wallet);
  useEffect(() => {
    if (inArrears && chat.busy) chat.stop();
  }, [inArrears, chat.busy?.msgId]);
  const activeConv =
    chat.conversations.find((c) => c.id === chat.activeId) ?? null;
  const title =
    activeConv?.title === '新对话' && activeConv.messages.length === 0
      ? 'bobo'
      : (activeConv?.title ?? 'bobo');
  const send = async (
    q: string,
    files?: File[],
    kind: ChatMode = 'chat',
  ): Promise<boolean> => {
    if (!user) {
      setLoginOpen(true);
      return false;
    }
    if (generationLock.current || chat.busy) return false;
    const version = authRevision.current;
    generationLock.current = true;
    try {
      const route=resolveChatMode(q,files??[],kind,{hasImages:Boolean(activeConv?.imageAttachments?.length),imageCount:activeConv?.imageAttachments?.length,hasDocuments:Boolean(activeConv?.documentConversationId)});
      if(route.error){push(route.error,'err');return false;}
      await billing.check(
        route.capability,
      );
      if (version !== authRevision.current) return false;
      return chat.send(q, files, kind) !== false;
    } catch (cause) {
      push(
        cause instanceof Error ? cause.message : '暂时无法确认额度，请刷新账户',
        'err',
        { label: '查看账户', on: () => goto('profile') },
      );
      return false;
    } finally {
      generationLock.current = false;
    }
  };
  const remixImage = async (imageUrl: string) => {
    const version = authRevision.current;
    try {
      const target = new URL(imageUrl, window.location.origin);
      if (!['http:', 'https:'].includes(target.protocol))
        throw new Error('图片地址不受支持');
      const response = await fetch(target.toString());
      if (!response.ok) throw new Error('生成图片暂时无法读取');
      const blob = await response.blob();
      if (version !== authRevision.current) return;
      await send(
        '请基于这张已生成图片继续二次创作。',
        [new File([blob], 'generated-remix.png', {
          type: blob.type || 'image/png',
        })],
        'image',
      );
    } catch (cause) {
      push(
        cause instanceof Error ? cause.message : '生成图片暂时无法读取',
        'err',
      );
    }
  };
  const resumeExecution = async (msgId: string, instruction?: string) => {
    if (!user) { setLoginOpen(true); return; }
    if (generationLock.current || chat.busy) return;
    const version = authRevision.current;
    generationLock.current = true;
    try {
      const execution = chat.conversations.flatMap(c => c.messages).find(m => m.id === msgId)?.execution;
      await billing.check('CHAT', { reconnectOnly: Boolean(execution && isExecutionActive(execution)) });
      if (version === authRevision.current) chat.resumeExecution(msgId, instruction);
    } catch (cause) {
      push(cause instanceof Error ? cause.message : '暂时无法确认额度，请刷新账户', 'err',
        { label: '查看账户', on: () => goto('profile') });
    } finally { generationLock.current = false; }
  };
  return (
    <>
      <div style={{ height: '100%' }} hidden={page === 'prompts'}>
      {renderPage === 'start' ? (
        <StartPage
          active={page !== 'prompts'}
          onOpenPrompts={() => goto('prompts')}
          onStart={openChat}
          onOpenAbout={() => goto('about')}
          onOpenWorld={() => goto('world')}
        />
      ) : renderPage === 'about' ? (
        <Suspense
          fallback={<div className="world-view-loading" aria-hidden="true" />}
        >
          <AboutBobo
            onBack={() => goto('start')}
            onStart={openChat}
            baseUrl={settings.baseUrl}
          />
        </Suspense>
      ) : renderPage === 'world' ? (
        <Suspense
          fallback={<div className="world-loading" aria-label="加载中" />}
        >
          <BoboWorld
            onBack={() => goto('start')}
            onStart={openChat}
            baseUrl={settings.baseUrl}
          />
        </Suspense>
      ) : renderPage === 'settings' ? (
        <SettingsSheet
          settings={settings}
          onChange={updateSettings}
          onClose={() => goto('chat')}
          user={user}
          onLoggedOut={() => {
            updateUser(null);
            goto('start');
          }}
        />
      ) : renderPage === 'profile' ? (
        <UserProfileSheet
          user={user}
          baseUrl={settings.baseUrl}
          wallet={billing.wallet}
          walletError={billing.error}
          connected={billing.connected}
          onUser={updateUser}
          onRefresh={billing.refresh}
          onClose={() => goto('chat')}
        />
      ) : (
        <div className={`app${navOpen ? ' nav-open' : ''}`}>
          <div className="sidebar-mask" onClick={() => setNavOpen(false)} />
          <Sidebar
            conversations={chat.visibleConversations}
            hasMore={chat.hasMoreHistory}
            loadingMore={chat.historyLoading}
            syncError={chat.syncError}
            onLoadEarlier={()=>void chat.loadEarlier()}
            onRetrySync={()=>void chat.retryCloudSync()}
            activeId={chat.activeId}
            width={sidebarWidth}
            onSelect={(id) => {
              chat.select(id);
              setNavOpen(false);
            }}
            onNew={() => {
              chat.newChat();
              setNavOpen(false);
            }}
            onDelete={chat.removeConversation}
            onOpenSettings={() => goto('settings')}
            onWidthChange={setSidebarWidth}
            onGoHome={() => goto('start')}
          />
          <ChatArea
            onOpenPrompts={() => goto('prompts')}
            context={{hasImages:Boolean(activeConv?.imageAttachments?.length),imageCount:activeConv?.imageAttachments?.length,hasDocuments:Boolean(activeConv?.documentConversationId)}}
            key={`${user?.userId ?? user?.username ?? 'guest'}:${chat.activeId ?? 'new'}`}
            onRetryAttachments={chat.retryAttachments}
            title={title}
            messages={activeConv?.messages ?? []}
            busy={chat.busy !== null}
            baseUrl={settings.baseUrl}
            signedIn={Boolean(user)}
            onSend={send}
            onResume={(id, instruction) => void resumeExecution(id, instruction)}
            onStop={chat.stop}
            onClear={chat.clearContext}
            onOpenSettings={() => goto('settings')}
            onOpenLogin={() => setLoginOpen(true)}
            onGoHome={() => goto('start')}
            onOpenProfile={() => goto('profile')}
            user={user}
            wallet={billing.wallet}
            onToggleNav={() => setNavOpen((v) => !v)}
            onRemix={(url) => void remixImage(url)}
          />
        </div>
      )}
      </div>
      {page === 'prompts' && <Suspense fallback={<div className="world-loading" aria-label="正在加载提示词" />}>
        <PromptLibrary baseUrl={settings.baseUrl} user={user} suspended={loginOpen}
          onClose={() => goto(underlyingPage.current)} onHome={() => goto('start')}
          onSettings={() => goto('settings')} onProfile={() => goto('profile')}
          onLogin={() => setLoginOpen(true)} />
      </Suspense>}
      {loginOpen && (
        <SetupGuide
          baseUrl={settings.baseUrl}
          onLoggedIn={(next) => {
            updateUser(next);
            setLoginOpen(false);
            if (currentPage.current !== 'prompts') goto('chat');
          }}
          onClose={() => setLoginOpen(false)}
        />
      )}
      {page === 'chat' && user && !authChecking && (
        <OnboardingBubbles
          key={user.userId ?? user.username}
          scope={user.userId ?? user.username}
          onOpenProfile={() => goto('profile')}
        />
      )}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast${toast.kind === 'err' ? ' err' : ''}`}
          >
            <span>{toast.text}</span>
            {toast.actionLabel && (
              <button
                onClick={() => {
                  toast.onAction?.();
                  dismissToast(toast.id);
                }}
              >
                {toast.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
