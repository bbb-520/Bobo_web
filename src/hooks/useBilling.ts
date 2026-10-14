import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/http';
import {
  balanceEventsUrl,
  getWallet,
  generationBlockReason,
  billingWarningKind,
  isInArrears,
  type Wallet,
  type GenerationCapability,
} from '../lib/billing';
interface Callbacks {
  onWarning: (wallet: Wallet) => void;
  onUnauthenticated: () => void;
}
export function useBilling(
  baseUrl: string,
  userId: string | undefined,
  callbacks: Callbacks,
) {
  const scope = `${baseUrl}|${userId ?? ''}`;
  const [snapshot, setSnapshot] = useState<{
    scope: string;
    wallet: Wallet;
  } | null>(null);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const cb = useRef(callbacks);
  cb.current = callbacks;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const requests = useRef(new Set<AbortController>());
  const warning = useRef('none');
  const revision = useRef(0);
  const latest = useRef<{ scope: string; wallet: Wallet } | null>(null);
  const accept = useCallback(
    (wallet: Wallet) => {
      if (currentScope.current !== scope) return;
      revision.current++;
      latest.current = { scope, wallet };
      setSnapshot({ scope, wallet });
      setError('');
      const next = billingWarningKind(wallet);
      if (next !== 'none' && next !== warning.current)
        cb.current.onWarning(wallet);
      warning.current = next;
    },
    [scope],
  );
  const refresh = useCallback(async () => {
    if (!userId) return null;
    const version = revision.current;
    const request = new AbortController();
    requests.current.add(request);
    const timeout = window.setTimeout(() => request.abort(), 10000);
    try {
      const wallet = await getWallet(baseUrl, request.signal);
      if (request.signal.aborted || currentScope.current !== scope) return null;
      // A balance event received during this query is newer than its snapshot.
      if (version === revision.current) accept(wallet);
      return latest.current?.scope === scope ? latest.current.wallet : wallet;
    } catch (cause) {
      if (!request.signal.aborted && currentScope.current === scope) {
        setError(cause instanceof Error ? cause.message : '账户余额读取失败');
        if (cause instanceof ApiError && cause.status === 401)
          cb.current.onUnauthenticated();
      }
      throw cause;
    } finally {
      window.clearTimeout(timeout);
      requests.current.delete(request);
    }
  }, [baseUrl, userId, scope, accept]);
  useEffect(() => {
    setError('');
    setConnected(false);
    warning.current = 'none';
    if (!userId) {
      setSnapshot(null);
      return;
    }
    void refresh().catch(() => {});
    const events = new EventSource(balanceEventsUrl(baseUrl), {
      withCredentials: true,
    });
    events.addEventListener('balance', (event) => {
      if (currentScope.current !== scope) return;
      try {
        const wallet = JSON.parse((event as MessageEvent).data) as Wallet;
        if (
          typeof wallet.balanceMicros !== 'number' ||
          typeof wallet.blocked !== 'boolean'
        )
          return;
        accept(wallet);
        setConnected(true);
      } catch {
        /* wait for the next authoritative event */
      }
    });
    events.onopen = () => {
      if (currentScope.current !== scope) return;
      void refresh().catch(() => {});
    };
    events.onerror = () => {
      if (currentScope.current !== scope) return;
      setConnected(false);
      void refresh().catch(() => {});
    };
    const focused = () => {
      if (document.visibilityState === 'visible')
        void refresh().catch(() => {});
    };
    window.addEventListener('focus', focused);
    document.addEventListener('visibilitychange', focused);
    return () => {
      events.close();
      window.removeEventListener('focus', focused);
      document.removeEventListener('visibilitychange', focused);
      requests.current.forEach((request) => request.abort());
      requests.current.clear();
    };
  }, [baseUrl, userId, refresh, accept]);
  const wallet = snapshot?.scope === scope ? snapshot.wallet : null;
  const waitingForRelease = Boolean(wallet?.blocked || wallet?.activeUsageId);
  useEffect(() => {
    if (!userId || (connected && !waitingForRelease)) return;
    let stopped = false;
    let timer: number;
    const poll = async () => {
      try { await refresh(); } catch { /* retain the last authoritative wallet */ }
      if (!stopped) timer = window.setTimeout(() => void poll(), 5000);
    };
    timer = window.setTimeout(() => void poll(), 5000);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [userId, connected, waitingForRelease, refresh]);
  const check = useCallback(
    async (capability: GenerationCapability, options?: { reconnectOnly?: boolean }) => {
      const latest = await refresh();
      // Reattaching a known active execution does not authorize another model call.
      const reason = options?.reconnectOnly && latest && !isInArrears(latest)
        ? null : generationBlockReason(latest, capability);
      if (reason) throw new Error(reason);
    },
    [refresh],
  );
  return { wallet, error, connected, refresh, check };
}
