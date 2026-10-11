import { useEffect, useRef, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import {
  createPaymentOrder,
  getPaymentOrder,
  parseRechargeCents,
  validPendingPayment,
  type PendingPayment,
  type PaymentChannel,
  type PaymentOrder,
} from '../lib/billing';
interface Props {
  baseUrl: string;
  userId: string;
  onPaid: () => void;
}
function readAttempt(key: string): PendingPayment | null {
  try {
    return validPendingPayment(
      JSON.parse(sessionStorage.getItem(key) || 'null'),
    );
  } catch {
    return null;
  }
}
export default function PaymentPanel({ baseUrl, userId, onPaid }: Props) {
  const storageKey = `bobo.payment.v1:${baseUrl}:${userId}`;
  const [attempt, setAttempt] = useState<PendingPayment | null>(() =>
    readAttempt(storageKey),
  );
  const [channel, setChannel] = useState<PaymentChannel>(
    () => readAttempt(storageKey)?.channel ?? 'ALIPAY',
  );
  const [amount, setAmount] = useState(() =>
    ((readAttempt(storageKey)?.amountCents ?? 1000) / 100).toFixed(2),
  );
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [qrError, setQrError] = useState('');
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const lock = useRef(false);
  const requests = useRef(new Set<AbortController>());
  const paidOrder = useRef('');
  const epoch = useRef(0);
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;
  const save = (value: PendingPayment | null) => {
    setAttempt(value);
    try {
      if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* Keep the in-memory idempotency key if storage is unavailable. */
    }
  };
  const accept = (value: PaymentOrder) => {
    setOrder(value);
    setError('');
    if (['PAID', 'REFUNDED'].includes(value.status) && paidOrder.current !== `${value.id}:${value.status}`) {
      paidOrder.current = `${value.id}:${value.status}`;
      save(null);
      onPaidRef.current();
    }
  };
  const fetchOrder = async (id: string) => {
    const version = epoch.current;
    const request = new AbortController();
    requests.current.add(request);
    try {
      const value = await getPaymentOrder(baseUrl, id, request.signal);
      if (!request.signal.aborted && version === epoch.current) accept(value);
    } catch (cause) {
      if (!request.signal.aborted && version === epoch.current)
        setError(cause instanceof Error ? cause.message : '支付状态查询失败');
    } finally {
      requests.current.delete(request);
    }
  };
  useEffect(() => {
    const cached = readAttempt(storageKey);
    if (cached?.orderId) void fetchOrder(cached.orderId);
    return () => {
      epoch.current++;
      requests.current.forEach((request) => request.abort());
      requests.current.clear();
    };
  }, [storageKey]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const expired = Boolean(
    order && Date.parse(order.expiresAt) <= now && order.status === 'PENDING',
  );
  useEffect(() => {
    if (!order || !['PENDING', 'REFUNDING'].includes(order.status)) return;
    const version = epoch.current;
    let closed = false;
    let timer: number | undefined;
    let request: AbortController | undefined;
    const poll = async () => {
      request = new AbortController();
      requests.current.add(request);
      try {
        const next = await getPaymentOrder(baseUrl, order.id, request.signal);
        if (!closed && !request.signal.aborted && version === epoch.current)
          accept(next);
      } catch (cause) {
        if (!closed && version === epoch.current)
          setError(
            cause instanceof Error
              ? cause.message
              : '支付状态查询失败，可手动刷新',
          );
      } finally {
        if (request) requests.current.delete(request);
        if (!closed && version === epoch.current)
          timer = window.setTimeout(poll, 3000);
      }
    };
    timer = window.setTimeout(poll, 3000);
    return () => {
      closed = true;
      window.clearTimeout(timer);
      request?.abort();
    };
  }, [baseUrl, order?.id, order?.status, expired]);
  useEffect(() => {
    setQrError('');
    if (
      !canvas.current ||
      !order?.qrCode ||
      order.status !== 'PENDING' ||
      expired
    )
      return;
    let active = true;
    QRCode.toCanvas(canvas.current, order.qrCode, {
      width: 224,
      margin: 4,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    }).catch(() => {
      if (active) setQrError('二维码生成失败，请刷新订单重试');
    });
    return () => {
      active = false;
    };
  }, [order?.qrCode, order?.status, expired]);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (lock.current) return;
    let pending = attempt;
    if (!pending) {
      try {
        pending = {
          key: crypto.randomUUID(),
          channel,
          amountCents: parseRechargeCents(amount),
        };
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '金额无效');
        return;
      }
    }
    lock.current = true;
    setBusy(true);
    setError('');
    save(pending);
    const request = new AbortController();
    requests.current.add(request);
    try {
      const next = await createPaymentOrder(
        baseUrl,
        pending.channel,
        pending.amountCents,
        pending.key,
        request.signal,
      );
      if (!request.signal.aborted) {
        save({ ...pending, orderId: next.id });
        accept(next);
      }
    } catch (cause) {
      if (!request.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : '下单失败，请使用同一订单重试',
        );
    } finally {
      requests.current.delete(request);
      lock.current = false;
      if (!request.signal.aborted) setBusy(false);
    }
  };
  const newOrder = () => {
    epoch.current++;
    requests.current.forEach((request) => request.abort());
    requests.current.clear();
    save(null);
    setOrder(null);
    setError('');
    paidOrder.current = '';
  };
  return (
    <section
      className="account-section payment-panel"
      aria-labelledby="recharge-title"
    >
      <h3 id="recharge-title">账户充值</h3>
      <p className="hint">
        扫码支付后按实际用量扣费，余额以服务端到账记录为准。
      </p>
      <form onSubmit={(e) => void create(e)}>
        <div className="payment-channel" role="group" aria-label="支付方式">
          {(
            [
              ['ALIPAY', '支付宝'],
              ['WECHAT', '微信支付'],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={channel === value}
              disabled={busy || Boolean(attempt)}
              onClick={() => setChannel(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="recharge-amount">充值金额（元）</label>
          <input
            id="recharge-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy || Boolean(attempt)}
            required
            placeholder="10.00"
          />
        </div>
        {!order && (
          <button className="setup-primary" disabled={busy} type="submit">
            {busy
              ? '正在创建订单…'
              : attempt
                ? '重试同一订单'
                : '生成付款二维码'}
          </button>
        )}
        {order?.status === 'PENDING' && !order.qrCode && !expired && (
          <button className="btn-ghost" disabled={busy} type="submit">
            重试获取二维码
          </button>
        )}
      </form>
      {order && (
        <div className="payment-status" aria-live="polite">
          <strong>
            {order.status === 'PAID'
              ? '充值已到账'
              : order.status === 'REFUNDING'
                ? '退款处理中'
                : order.status === 'REFUNDED'
                  ? '已原路退款'
                  : order.status === 'CLOSED'
                    ? '订单已关闭'
                    : expired
                ? '订单付款时间已结束'
                : '等待扫码支付'}
          </strong>
          <p>
            ¥{(order.amountCents / 100).toFixed(2)} ·{' '}
            {order.channel === 'ALIPAY' ? '支付宝' : '微信支付'}
          </p>
          {order.qrCode && order.status === 'PENDING' && !expired && (
            <canvas
              ref={canvas}
              role="img"
              aria-label={`使用${order.channel === 'ALIPAY' ? '支付宝' : '微信'}扫一扫支付 ${(order.amountCents / 100).toFixed(2)} 元`}
            />
          )}
          <small>订单 {order.id}</small>
          {!expired && order.status === 'PENDING' && (
            <small>
              剩余{' '}
              {Math.max(
                0,
                Math.ceil((Date.parse(order.expiresAt) - now) / 60000),
              )}{' '}
              分钟
            </small>
          )}
          {expired && (
            <p className="hint">已付款但未更新时，请刷新状态核对到账。</p>
          )}
          <div className="account-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void fetchOrder(order.id)}
            >
              刷新支付状态
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={newOrder}
            >
              {order.status === 'PAID' ? '继续充值' : '新建另一订单'}
            </button>
          </div>
        </div>
      )}
      {!order && attempt && (
        <button
          type="button"
          className="btn-ghost"
          disabled={busy}
          onClick={newOrder}
        >
          重新选择金额或支付方式
        </button>
      )}
      {(error || qrError) && (
        <p className="setup-error" role="alert">
          {error || qrError}
        </p>
      )}
      {attempt && (
        <p className="hint">
          刷新页面可恢复此订单。重试会使用同一请求，避免重复下单。
        </p>
      )}
    </section>
  );
}
