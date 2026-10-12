import { useEffect, useRef, useState } from 'react';
import {
  bindEmail,
  getMe,
  isQqEmail,
  listModelProfiles,
  type AuthUser,
  type ModelProfile,
} from '../lib/auth';
import { billingWarningMessage, formatMoney, formatTokens, getUsage, isInArrears, type Usage, type Wallet } from '../lib/billing';
import { listImageReceipts } from '../lib/zine';
import EmailCodeFields from './EmailCodeFields';
import PaymentPanel from './PaymentPanel';
import ZineResultCard from './ZineResultCard';
import AdminPanel from './AdminPanel';
import WalletOverview from './WalletOverview';
interface Props {
  user: AuthUser;
  baseUrl: string;
  wallet: Wallet | null;
  walletError: string;
  connected: boolean;
  onUser: (user: AuthUser) => void;
  onRefresh: () => Promise<unknown>;
}
const statusNames: Record<string, string> = {
  RESERVED: '预授权',
  DISPATCHED: '生成中',
  SUCCEEDED: '已完成',
  UNKNOWN: '待对账',
  CANCELLED: '已取消',
  REFUNDED: '已退还',
};
export default function AccountPanel({
  user,
  baseUrl,
  wallet,
  walletError,
  connected,
  onUser,
  onRefresh,
}: Props) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [usage, setUsage] = useState<Usage[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [models, setModels] = useState<ModelProfile[]>([]);
  const [receipts, setReceipts] = useState<string[]>([]);
  const [receipt, setReceipt] = useState('');
  const [reload, setReload] = useState(0);
  const binding = useRef<AbortController | null>(null);
  useEffect(() => () => binding.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    getUsage(baseUrl, controller.signal)
      .then(setUsage)
      .catch((cause) => {
        if (!controller.signal.aborted)
          setHistoryError(
            cause instanceof Error ? cause.message : '消费记录读取失败',
          );
      });
    listModelProfiles(baseUrl, controller.signal)
      .then(setModels)
      .catch(() => {});
    listImageReceipts(baseUrl, controller.signal)
      .then(setReceipts)
      .catch(() => {});
    return () => controller.abort();
  }, [baseUrl, user.userId, reload]);
  const refresh = () => {
    setHistoryError('');
    setReload((v) => v + 1);
    void onRefresh().catch(() => {});
  };
  const bind = async (e: React.FormEvent) => {
    e.preventDefault();
    if (binding.current || busy || sending) return;
    if (!isQqEmail(email) || !/^\d{6}$/.test(code)) {
      setEmailError('请填写 QQ 邮箱和 6 位验证码');
      return;
    }
    const request = new AbortController();
    binding.current = request;
    setBusy(true);
    setEmailError('');
    try {
      await bindEmail(
        baseUrl,
        email.trim().toLowerCase(),
        code,
        request.signal,
      );
      if (request.signal.aborted) return;
      const next = await getMe(baseUrl, request.signal);
      if (!request.signal.aborted && next.userId === user.userId) {
        onUser(next);
        setCode('');
      }
    } catch (cause) {
      if (!request.signal.aborted)
        setEmailError(cause instanceof Error ? cause.message : '邮箱绑定失败');
    } finally {
      if (binding.current === request) binding.current = null;
      if (!request.signal.aborted) setBusy(false);
    }
  };
  return (
    <div className="account-panel">
      <section
        className="account-section wallet-section"
        aria-labelledby="wallet-title"
      >
        <div className="account-section-heading">
          <h3 id="wallet-title">创作账户</h3>
          <button type="button" className="btn-ghost" onClick={refresh}>
            刷新账户
          </button>
        </div>
        <WalletOverview wallet={wallet}/>
        <p className={isInArrears(wallet) ? 'setup-error' : 'hint'} role="status">
          {wallet && billingWarningMessage(wallet)
            ? billingWarningMessage(wallet)
            : wallet?.activeUsageId
              ? '有请求正在生成或等待对账。'
              : (wallet?.freeTokens ?? 0) > 0
                ? '所有模型调用共用免费 Token，包括图片创作、文档索引与概要。优先按实际输入和输出扣减；图片未返回 Token 时按图片价格折算额度。'
                : '创作按实际用量扣费，余额不足时停止新请求。'}
        </p>
        {walletError && (
          <p className="setup-error" role="alert">
            {walletError}
          </p>
        )}
        <small className="hint">
          {connected ? '余额实时更新中' : '余额通知正在连接，可手动刷新'}
        </small>
      </section>
      <div className="account-columns">
        <section className="account-section" aria-labelledby="email-title">
          <h3 id="email-title">登录邮箱</h3>
          {user.emailBound ? (
            <>
              <p>{user.qqEmail}</p>
              <p className="hint">已与当前用户绑定，可使用邮箱验证码登录。</p>
            </>
          ) : (
            <form onSubmit={(e) => void bind(e)}>
              <p className="hint">
                绑定 QQ 邮箱后，可使用验证码登录。同一邮箱只能绑定一个账号。
              </p>
              <EmailCodeFields
                baseUrl={baseUrl}
                purpose="BIND"
                email={email}
                code={code}
                onEmail={setEmail}
                onCode={setCode}
                disabled={busy}
                onSending={setSending}
              />
              <button
                className="setup-primary"
                disabled={busy || sending}
                type="submit"
              >
                {busy ? '绑定中…' : '绑定 QQ 邮箱'}
              </button>
              {emailError && (
                <p className="setup-error" role="alert">
                  {emailError}
                </p>
              )}
            </form>
          )}
          <div className="platform-models">
            <h4>平台提供模型</h4>
            {models.map((model) => (
              <p key={model.capability}>
                <span>
                  {({CHAT:'对话',VISION:'图片理解',IMAGE:'图片创作',EMBEDDING:'文档向量',RERANK:'文档重排',EVALUATION:'答案验证',FALLBACK:'聊天与文档兜底',VISION_FALLBACK:'图片理解兜底'} as Record<string,string>)[model.capability]??model.capability}
                </span>
                <span>
                  {model.provider==='GPT'?'ChatGPT · ':model.provider==='QWEN'?'千问 · ':''}{model.model||'未配置'}
                  {model.enabled ? '' : ' · 暂不可用'}
                </span>
              </p>
            ))}
            <p className="hint">模型凭据由平台管理，直接登录即可使用。</p>
          </div>
        </section>
        <PaymentPanel
          baseUrl={baseUrl}
          userId={user.userId ?? user.username}
          onPaid={refresh}
        />
      </div>
      <section className="account-section">
        <div className="account-section-heading">
          <h3>最近消费</h3>
          <button type="button" className="btn-ghost" onClick={refresh}>
            刷新记录
          </button>
        </div>
        {historyError ? (
          <p className="setup-error" role="alert">
            {historyError}
          </p>
        ) : usage.length === 0 ? (
          <p className="hint">还没有消费记录。</p>
        ) : (
          <div className="usage-scroll">
            <table className="usage-table">
              <thead>
                <tr>
                  <th>时间 / 模型</th>
                  <th>状态</th>
                  <th>输入 / 输出 token</th>
                  <th>费用（元）</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {new Date(row.createdAt).toLocaleString('zh-CN')}
                      <small>{row.model}</small>
                    </td>
                    <td>
                      {statusNames[row.status] ?? row.status}
                      {row.trial && <small>{row.metering === 'TOKEN' || row.metering === 'IMAGE_TOKEN' ? '免费 Token' : '旧图片次数'}</small>}
                    </td>
                    <td>
                      {row.inputTokens ?? '未返回'} /{' '}
                      {row.outputTokens ?? '未返回'}
                      {row.metering === 'IMAGE' && <small>按图片计费</small>}{row.metering==='IMAGE_TOKEN'&&<small>图片价格折算额度（非实际 Token）</small>}{(row.freeTokensUsed??0)>0&&<small>免费额度抵扣 {formatTokens(row.freeTokensUsed!)} Token</small>}
                    </td>
                    <td>
                      {formatMoney(row.chargedMicros)}
                      {row.status === 'REFUNDED' && <small>已退回余额</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="account-section">
        <h3>恢复图片结果</h3>
        <p className="hint">
          请求中断或结算响应丢失时，可读取已保存回执。恢复不会再次生成图片。
        </p>
        <div className="account-actions">
          <select
            aria-label="选择生成回执"
            value={receipt}
            onChange={(e) => setReceipt(e.target.value)}
          >
            <option value="">选择最近生成</option>
            {receipts.map((id, index) => (
              <option key={id} value={id}>
                第 {index + 1} 条 · {id.slice(-12)}
              </option>
            ))}
          </select>
          <button type="button" className="btn-ghost" onClick={refresh}>
            刷新回执列表
          </button>
        </div>
        {receipt && (
          <ZineResultCard key={receipt} baseUrl={baseUrl} requestId={receipt} />
        )}
      </section>
      <AdminPanel key={`${baseUrl}:${user.userId}:${user.permissions?.join(',')}`} user={user} baseUrl={baseUrl} onUser={onUser}/>
    </div>
  );
}
