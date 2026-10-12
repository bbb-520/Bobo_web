import { apiRequest, apiUrl } from './http.ts';
export interface Wallet {
  balanceMicros: number;
  reservedMicros: number;
  freeImages: number;
  /** Remaining server-issued allowance; absent on older backend versions. */
  freeTokens?: number;
  arrears: boolean;
  lowBalance: boolean;
  blocked: boolean;
  activeUsageId: string | null;
}
export interface Usage {
  id: string;
  capability: string;
  model: string;
  status: string;
  inputTokens: number | null;
  outputTokens: number | null;
  metering: string | null;
  chargedMicros: number;
  trial: boolean;
  freeTokensUsed?:number;
  createdAt: string;
}
export type PaymentChannel = 'ALIPAY' | 'WECHAT';
export interface PaymentOrder {
  id: string;
  channel: PaymentChannel;
  amountCents: number;
  status: string;
  qrCode: string | null;
  expiresAt: string;
}
export interface PendingPayment {
  key: string;
  channel: PaymentChannel;
  amountCents: number;
  orderId?: string;
}
export type GenerationCapability = 'IMAGE' | 'CHAT' | 'VISION';
export const FREE_TOKEN_ALLOWANCE = 1_000_000;
export const LOW_FREE_TOKEN_THRESHOLD = 100_000;
export const formatTokens = (tokens: number) => new Intl.NumberFormat('zh-CN').format(tokens);
export const isInArrears = (wallet: Wallet | null) =>
  Boolean(wallet && (wallet.arrears || wallet.balanceMicros < 0));
export function billingWarningKind(wallet: Wallet) {
  if (isInArrears(wallet)) return 'debt';
  if ((wallet.freeTokens ?? 0) > 0)
    return wallet.freeTokens! <= LOW_FREE_TOKEN_THRESHOLD ? 'low-tokens' : 'none';
  if (wallet.freeTokens === 0) return 'exhausted';
  return wallet.lowBalance && wallet.freeImages === 0 ? 'low-money' : 'none';
}
export function billingWarningMessage(wallet: Wallet) {
  switch (billingWarningKind(wallet)) {
    case 'debt': return '账户已欠费，无法继续交互，请充值后继续';
    case 'low-tokens': return `免费 Token 额度即将用完，剩余 ${formatTokens(wallet.freeTokens!)} Token，请及时充值`;
    case 'exhausted': return wallet.balanceMicros - wallet.reservedMicros > 0
      ? '免费 Token 额度已用完，后续用量将从账户余额扣费'
      : '免费 Token 额度已用完，请充值后继续';
    case 'low-money': return '余额即将用完，请及时充值';
    default: return null;
  }
}
export const formatMoney = (micros: number) =>
  new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(micros / 1000000);
export function parseRechargeCents(input: string): number {
  if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(input.trim()))
    throw new Error('请输入最多两位小数的充值金额');
  const [whole, fraction = ''] = input.trim().split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 1000000)
    throw new Error('充值范围为 0.01～10,000 元');
  return cents;
}
export function generationBlockReason(
  wallet: Wallet | null,
  capability: GenerationCapability,
): string | null {
  if (!wallet) return '正在确认账户余额，请稍后再试';
  if (isInArrears(wallet))
    return '账户已欠费，请充值后继续';
  if (wallet.blocked || wallet.activeUsageId)
    return '账户有请求处理中或待对账，请稍后再试';
  if (capability === 'IMAGE' && wallet.freeImages > 0) return null;
  if ((wallet.freeTokens ?? 0) > 0) return null;
  if (wallet.balanceMicros - wallet.reservedMicros <= 0)
    return capability === 'IMAGE'
      ? '免费 Token 与图片次数已用完，请充值后继续'
      : '免费 Token 额度已用完，请充值后继续';
  return null;
}
export function validPendingPayment(value: unknown): PendingPayment | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as PendingPayment;
  if (
    typeof p.key !== 'string' ||
    !/^[A-Za-z0-9_.:-]{1,128}$/.test(p.key) ||
    !['ALIPAY', 'WECHAT'].includes(p.channel) ||
    !Number.isSafeInteger(p.amountCents) ||
    p.amountCents < 1 ||
    p.amountCents > 1000000 ||
    (p.orderId !== undefined &&
      (typeof p.orderId !== 'string' ||
        !/^[A-Za-z0-9_.:-]{1,128}$/.test(p.orderId)))
  )
    return null;
  return {
    key: p.key,
    channel: p.channel,
    amountCents: p.amountCents,
    ...(p.orderId ? { orderId: p.orderId } : {}),
  };
}
export const getWallet = (
  base: string,
  signal?: AbortSignal,
): Promise<Wallet> => apiRequest(base, '/api/billing/wallet', { signal });
export const getUsage = (
  base: string,
  signal?: AbortSignal,
): Promise<Usage[]> =>
  apiRequest(base, '/api/billing/usage?limit=20', { signal });
export const createPaymentOrder = (
  base: string,
  channel: PaymentChannel,
  amountCents: number,
  key: string,
  signal?: AbortSignal,
): Promise<PaymentOrder> =>
  apiRequest(base, '/api/payments/orders', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ channel, amountCents }),
    signal,
  });
export const getPaymentOrder = (
  base: string,
  id: string,
  signal?: AbortSignal,
): Promise<PaymentOrder> =>
  apiRequest(base, `/api/payments/orders/${encodeURIComponent(id)}`, {
    signal,
  });
export const balanceEventsUrl = (base: string) =>
  apiUrl('/api/billing/events', base);
