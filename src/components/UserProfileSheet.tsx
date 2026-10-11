import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthUser } from '../lib/auth';
import {
  BoboApiError,
  deleteBoboItem,
  fetchMyBoboItems,
  patchBoboItem,
  type BoboMineItem,
} from '../lib/api';
import AccountPanel from './AccountPanel';
import type { Wallet } from '../lib/billing';
import { IconClose } from './icons';
import AccordionGallery from './AccordionGallery';

const PAGE_SIZE = 24;
type Draft = { caption: string; anonymous: boolean; visibility: 'PUBLIC' | 'PRIVATE' };

interface Props { user: AuthUser | null; baseUrl: string; onClose: () => void; wallet:Wallet|null; walletError:string; connected:boolean; onUser:(user:AuthUser)=>void; onRefresh:()=>Promise<unknown>; }

export default function UserProfileSheet({ user, baseUrl, onClose, wallet, walletError, connected, onUser, onRefresh }: Props) {
  const [items, setItems] = useState<BoboMineItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [publicCount, setPublicCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [preview, setPreview] = useState<BoboMineItem | null>(null);
  const [brokenIds, setBrokenIds] = useState<Set<string>>(() => new Set());
  const requestRef = useRef<AbortController | null>(null);
  const [selectedId, setSelectedId] = useState('');

  const load = useCallback(async (nextCursor: string | null = null, replace = true) => {
    if (!user) { setItems([]); setPublicCount(0); setLoading(false); return; }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (replace) setLoading(true);
    else setLoadingMore(true);
    setError('');
    try {
      const page = await fetchMyBoboItems(baseUrl, PAGE_SIZE, nextCursor, controller.signal);
      if (controller.signal.aborted) return;
      setItems((previous) => replace ? page.items : [...previous, ...page.items.filter((item) => !previous.some((old) => old.itemId === item.itemId))]);
      if (replace && page.items[0]) setSelectedId(page.items[0].itemId);
      setCursor(page.nextCursor);
      setPublicCount(page.publicCount);
      setDrafts((previous) => {
        const next = replace ? {} : { ...previous };
        for (const item of page.items) next[item.itemId] = { caption: item.caption ?? '', anonymous: item.anonymous, visibility: item.visibility };
        return next;
      });
      setBrokenIds(new Set());
    } catch (cause) {
      if (!controller.signal.aborted) {
        console.error('[bobo-world] failed to load the current user’s works', cause);
        setError(cause instanceof Error ? cause.message : '作品读取失败');
      }
    } finally {
      if (!controller.signal.aborted) { setLoading(false); setLoadingMore(false); }
    }
  }, [baseUrl, user]);

  useEffect(() => {
    void load(null, true);
    return () => requestRef.current?.abort();
  }, [load]);

  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreview(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [preview]);

  const updateDraft = (itemId: string, changes: Partial<Draft>) => {
    setDrafts((previous) => ({ ...previous, [itemId]: { ...previous[itemId], ...changes } }));
  };

  const save = async (item: BoboMineItem) => {
    const draft = drafts[item.itemId];
    if (!draft) return;
    if (draft.visibility === 'PUBLIC' && item.visibility !== 'PUBLIC'
      && !window.confirm('公开后，所有访客都可以看到这张图片和文案。继续公开吗？')) return;
    setBusyId(item.itemId);
    setFeedback((previous) => ({ ...previous, [item.itemId]: '' }));
    try {
      const updated = await patchBoboItem(baseUrl, item.itemId, { ...draft, version: item.version });
      console.info('[bobo-world] profile item saved', { itemId: item.itemId, version: updated.version, visibility: updated.visibility });
      setItems((previous) => previous.map((current) => current.itemId === item.itemId ? updated : current));
      setDrafts((previous) => ({ ...previous, [item.itemId]: { caption: updated.caption ?? '', anonymous: updated.anonymous, visibility: updated.visibility } }));
      setPublicCount((count) => count + (updated.visibility === 'PUBLIC' && item.visibility !== 'PUBLIC' ? 1 : 0)
        - (updated.visibility !== 'PUBLIC' && item.visibility === 'PUBLIC' ? 1 : 0));
      setFeedback((previous) => ({ ...previous, [item.itemId]: '已保存' }));
    } catch (cause) {
      console.warn('[bobo-world] profile item save failed', { itemId: item.itemId, status: cause instanceof BoboApiError ? cause.status : undefined }, cause);
      const message = cause instanceof Error ? cause.message : '保存失败';
      setFeedback((previous) => ({ ...previous, [item.itemId]: cause instanceof BoboApiError && cause.status === 409
        ? '作品已在其他位置更新，正在刷新当前内容。' : message }));
      if (cause instanceof BoboApiError && cause.status === 409) void load(null, true);
    } finally { setBusyId(''); }
  };

  const remove = async (item: BoboMineItem) => {
    if (!window.confirm('删除后作品会立即从星图隐藏，并安排清理图片。确定删除吗？')) return;
    setBusyId(item.itemId);
    try {
      await deleteBoboItem(baseUrl, item.itemId);
      console.info('[bobo-world] profile item deleted', { itemId: item.itemId });
      setItems((previous) => previous.filter((current) => current.itemId !== item.itemId));
      if (selectedId === item.itemId) setSelectedId(items.find((current) => current.itemId !== item.itemId)?.itemId ?? '');
      setPublicCount((count) => Math.max(0, count - (item.visibility === 'PUBLIC' && item.status === 'ACTIVE' ? 1 : 0)));
      setFeedback((previous) => ({ ...previous, [item.itemId]: '' }));
    } catch (cause) {
      console.warn('[bobo-world] profile item delete failed', { itemId: item.itemId }, cause);
      setFeedback((previous) => ({ ...previous, [item.itemId]: cause instanceof Error ? cause.message : '删除失败' }));
    } finally { setBusyId(''); }
  };

  return (
    <div className="profile-mask profile-route" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="profile-page profile-world-page" aria-label="我的 Bobo's World" onMouseDown={(event) => event.stopPropagation()}>
        <div className="sheet-head"><div><span className="profile-kicker">MY BOBO’S WORLD</span><h2>{user?.username ?? '未登录'}</h2></div>
          <button className="icon-btn light" onClick={onClose} aria-label="关闭"><IconClose size={18} /></button></div>
        <p className="profile-sub">管理邮箱、创作余额和你主动发布的作品。公开作品：{publicCount} 张</p>

        {user && <AccountPanel key={`${baseUrl}:${user.userId ?? user.username}`} user={user} baseUrl={baseUrl} wallet={wallet} walletError={walletError} connected={connected} onUser={onUser} onRefresh={onRefresh}/>}

        {!user ? <div className="bobo-profile-state">登录后可以查看和管理你的作品。</div> : loading ?
          <div className="bobo-profile-state" role="status">正在读取你的作品…</div> : error ?
          <div className="bobo-profile-state" role="alert"><p>{error}</p><button type="button" onClick={() => void load(null, true)}>重试</button></div> : items.length === 0 ?
          <div className="bobo-profile-state">这里还没有作品。选择“先识图再创作”生成图片后，可在结果卡片中选择“加入 Bobo’s World”。</div> :
          <div className="bobo-profile-editor">
            <AccordionGallery items={items.filter((item) => item.imageUrl).map((item) => ({ id: item.itemId, image: item.imageUrl!, label: item.caption || item.prompt || '未命名作品', alt: 'Bobo’s World 作品' }))} defaultIndex={Math.max(0, items.findIndex((item) => item.itemId === selectedId))} trigger="hover" onActiveChange={(index: number) => setSelectedId(items.filter((item) => item.imageUrl)[index]?.itemId ?? selectedId)} />
            {(() => { const item = items.find((candidate) => candidate.itemId === selectedId) ?? items[0]; if (!item) return null; const draft = drafts[item.itemId] ?? { caption: item.caption ?? '', anonymous: item.anonymous, visibility: item.visibility }; const busy = busyId === item.itemId; return <article className="bobo-profile-item bobo-profile-selected" key={item.itemId}>
              <div className="bobo-profile-selected-heading"><span>当前作品</span><strong>{item.prompt || '未命名创作'}</strong></div>
              <div className="bobo-profile-fields">
                <div className="bobo-profile-prompt"><span>用户提示词</span><p>{item.prompt || '未记录提示词'}</p></div>
                <label>文案<textarea maxLength={500} value={draft.caption} onChange={(event) => updateDraft(item.itemId, { caption: event.target.value })} placeholder="写一句作品说明（可选）" /></label>
                <div className="bobo-profile-controls"><label className="bobo-profile-check"><input type="checkbox" checked={draft.anonymous} onChange={(event) => updateDraft(item.itemId, { anonymous: event.target.checked })} />匿名展示</label><label>可见性<select value={draft.visibility} onChange={(event) => updateDraft(item.itemId, { visibility: event.target.value as Draft['visibility'] })}><option value="PUBLIC">公开</option><option value="PRIVATE">仅自己</option></select></label><span className="bobo-profile-status">{item.status === 'HIDDEN' ? '审核隐藏' : item.visibility === 'PUBLIC' ? '星图可见' : '仅自己可见'}</span></div>
                <div className="bobo-profile-actions"><button type="button" disabled={Boolean(busyId)} onClick={() => void save(item)}>{busy ? '保存中…' : '保存当前作品'}</button><button type="button" className="danger" disabled={Boolean(busyId)} onClick={() => void remove(item)}>删除</button><span role="status">{feedback[item.itemId] ?? ''}</span></div>
              </div>
            </article>; })()}
          </div>}

        {cursor && !loading && !error && <div className="bobo-profile-more"><button type="button" disabled={loadingMore} onClick={() => void load(cursor, false)}>
          {loadingMore ? '正在读取…' : '加载更多作品'}
        </button></div>}
        {user && <div className="bobo-profile-footer"><button type="button" onClick={() => void load(null, true)}>刷新作品列表</button><span>已载入 {items.length} 张</span></div>}
      </section>

      {preview && <div className="bobo-world-modal" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}>
        <section className="bobo-world-viewer" role="dialog" aria-modal="true" aria-label="我的作品预览">
          <button type="button" className="bobo-world-close" onClick={() => setPreview(null)} aria-label="关闭预览">×</button>
          {brokenIds.has(preview.itemId) || !preview.imageUrl ? <div className="bobo-viewer-unavailable">图片暂不可用，请刷新作品列表后重试。</div>
            : <img src={preview.imageUrl} alt="我的 Bobo's World 作品大图" onError={() => setBrokenIds((old) => new Set(old).add(preview.itemId))} />}
          {preview.caption && <div className="bobo-world-caption is-visible">{!preview.anonymous && user?.username ? <strong>{user.username}：</strong> : null}{preview.caption}</div>}
        </section>
      </div>}
    </div>
  );
}
