import { FREE_TOKEN_ALLOWANCE, formatMoney, formatTokens, type Wallet } from '../lib/billing';

const percentage = (value: number, total: number) => total > 0 ? Math.max(0, Math.min(100, value / total * 100)) : 0;
function Meter({label, value}: {label:string; value:number|null}) {
  return <div className="wallet-meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined} aria-valuetext={value == null ? '等待账户数据' : `${Math.round(value)}%`}>
    <span style={{width:`${value ?? 0}%`}}/>
  </div>;
}
export default function WalletOverview({wallet}: {wallet:Wallet|null}) {
  const tokens = wallet?.freeTokens;
  const freePercent = tokens == null ? null : percentage(tokens, FREE_TOKEN_ALLOWANCE);
  const available = wallet ? wallet.balanceMicros - wallet.reservedMicros : null;
  const cashPercent = wallet ? percentage(Math.max(0, available!), wallet.balanceMicros) : null;
  return <div className="wallet-overview">
    <section className="wallet-quota" aria-label="通用免费额度">
      <div className="wallet-quota-heading"><h4>通用免费额度</h4><span>{freePercent == null ? '—' : `剩余 ${Math.round(freePercent)}%`}</span></div>
      <p><strong>{tokens == null ? '—' : formatTokens(tokens)}</strong><span> / {formatTokens(FREE_TOKEN_ALLOWANCE)} Token</span></p>
      <Meter label="免费 Token 剩余比例" value={freePercent}/>
      <small>聊天、图片与文档共用，用完后按余额扣费</small>
    </section>
    <section className="wallet-quota" aria-label="账户余额">
      <div className="wallet-quota-heading"><h4>可用余额</h4><span>{cashPercent == null ? '—' : `可用 ${Math.round(cashPercent)}%`}</span></div>
      <p><strong>{available == null ? '—' : `¥${formatMoney(available)}`}</strong></p>
      <Meter label="账户余额中可用金额比例" value={cashPercent}/>
      <div className="wallet-cash-details"><small>账户余额 {wallet ? `¥${formatMoney(wallet.balanceMicros)}` : '—'}</small><small>冻结金额 {wallet ? `¥${formatMoney(wallet.reservedMicros)}` : '—'}</small></div>
    </section>
    {wallet && wallet.freeImages > 0 && <small className="wallet-legacy">旧图片额度剩余 {wallet.freeImages} 次</small>}
  </div>;
}
