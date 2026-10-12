import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { apiRequest, ApiError } from '../src/lib/http.ts';
import {
  parseRechargeCents,
  generationBlockReason,
  createPaymentOrder,
  getPaymentOrder,
  getWallet,
  validPendingPayment,
} from '../src/lib/billing.ts';
import {
  register,
  emailLogin,
  sendEmailCode,
  bindEmail,
} from '../src/lib/auth.ts';
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const wallet = {
  balanceMicros: 0,
  reservedMicros: 0,
  freeImages: 2,
  arrears: false,
  lowBalance: true,
  blocked: false,
  activeUsageId: null,
};
test('recharge conversion is exact and rejects invalid or out-of-range amounts', () => {
  assert.equal(parseRechargeCents('0.01'), 1);
  assert.equal(parseRechargeCents('10.10'), 1010);
  assert.equal(parseRechargeCents('10000'), 1000000);
  for (const value of ['0', '-1', '1.001', '1e2', 'NaN', '10000.01', ''])
    assert.throws(() => parseRechargeCents(value));
});
test('two image trials do not unlock paid chat or allow debt bypass', () => {
  assert.equal(generationBlockReason(wallet, 'IMAGE'), null);
  assert.match(generationBlockReason(wallet, 'CHAT'), /充值/);
  assert.match(
    generationBlockReason(
      { ...wallet, balanceMicros: -1, arrears: true },
      'IMAGE',
    ),
    /欠费/,
  );
  assert.match(
    generationBlockReason(
      { ...wallet, blocked: true, activeUsageId: 'unknown' },
      'IMAGE',
    ),
    /对账|处理中/,
  );
  assert.match(generationBlockReason(null, 'IMAGE'), /余额/);
});

test('free tokens unlock chat and vision without a cash balance', () => {
  for (const capability of ['CHAT', 'VISION']) {
    assert.equal(generationBlockReason({ ...wallet, freeTokens: 1000000 }, capability), null);
    assert.equal(generationBlockReason({ ...wallet, freeTokens: 1 }, capability), null);
    assert.match(generationBlockReason({ ...wallet, freeTokens: 0 }, capability), /充值/);
  }
});

test('free tokens never bypass debt, reservations or unresolved usage', () => {
  const free = { ...wallet, freeTokens: 1000000 };
  for (const capability of ['CHAT', 'VISION', 'IMAGE']) {
    assert.match(generationBlockReason({ ...free, balanceMicros: -1 }, capability), /欠费/);
    assert.match(generationBlockReason({ ...free, arrears: true }, capability), /欠费/);
    assert.match(generationBlockReason({ ...free, blocked: true }, capability), /对账|处理中/);
    assert.match(generationBlockReason({ ...free, activeUsageId: 'pending' }, capability), /对账|处理中/);
  }
  assert.equal(generationBlockReason({ ...free, freeTokens: 0, balanceMicros: 1000 }, 'CHAT'), null);
  assert.equal(generationBlockReason({ ...free, freeImages: 0 }, 'IMAGE'), null);
});
test('payment retries keep the same idempotency key, amount, channel and cookie', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push([url, init]);
    return Response.json({ id: 'order', status: 'PENDING' });
  };
  await createPaymentOrder('', 'ALIPAY', 1010, 'same-attempt');
  await createPaymentOrder('', 'ALIPAY', 1010, 'same-attempt');
  assert.equal(calls.length, 2);
  for (const [url, init] of calls) {
    assert.equal(url, '/api/payments/orders');
    assert.equal(init.credentials, 'include');
    assert.equal(
      new Headers(init.headers).get('Idempotency-Key'),
      'same-attempt',
    );
    assert.deepEqual(JSON.parse(init.body), {
      channel: 'ALIPAY',
      amountCents: 1010,
    });
  }
});
test('malformed saved attempts are rejected instead of reused for a different order', () => {
  assert.equal(
    validPendingPayment({ key: 'ok', channel: 'ALIPAY', amountCents: 100 }).key,
    'ok',
  );
  for (const value of [
    { key: 'old-wx', channel: 'WECHAT', amountCents: 100 },
    { key: 'ok', channel: 'OTHER', amountCents: 100 },
    { key: 'ok', channel: 'ALIPAY', amountCents: 1.5 },
    null,
    {},
  ])
    assert.equal(validPendingPayment(value), null);
});
test('problem responses preserve HTTP status and useful messages', async () => {
  globalThis.fetch = async () =>
    Response.json({ detail: '余额不足，请充值' }, { status: 402 });
  await assert.rejects(
    getWallet(''),
    (error) =>
      error instanceof ApiError &&
      error.status === 402 &&
      /充值/.test(error.message),
  );
  globalThis.fetch = async () => new Response(null, { status: 204 });
  assert.equal(
    await apiRequest('', '/api/auth/logout', { method: 'POST' }),
    undefined,
  );
});
test('QQ registration, login and binding send purpose-bound backend fields', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push([url, JSON.parse(init.body)]);
    return Response.json({ username: 'alice' });
  };
  await register('', 'alice', 'password123', '123@qq.com', '123456');
  await sendEmailCode('', '123@qq.com', 'REGISTER');
  await emailLogin('', '123@qq.com', '123456');
  await bindEmail('', '123@qq.com', '123456');
  assert.deepEqual(calls, [
    [
      '/api/auth/register',
      {
        username: 'alice',
        password: 'password123',
        qqEmail: '123@qq.com',
        code: '123456',
      },
    ],
    ['/api/auth/email/code', { qqEmail: '123@qq.com', purpose: 'REGISTER' }],
    ['/api/auth/email/login', { qqEmail: '123@qq.com', code: '123456' }],
    ['/api/auth/email/bind', { qqEmail: '123@qq.com', code: '123456' }],
  ]);
});
test('order status is fetched from the server with the owned order ID', async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/payments/orders/owned%2Forder');
    assert.equal(init.credentials, 'include');
    return Response.json({ id: 'owned/order', status: 'PENDING' });
  };
  assert.equal((await getPaymentOrder('', 'owned/order')).status, 'PENDING');
});
