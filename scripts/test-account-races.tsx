import assert from 'node:assert/strict';
import { test, before, afterEach } from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

let createRoot, PaymentPanel, AccountPanel, useConversations, root, host;
const response = (value) =>
  new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  });
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
before(async () => {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'http://localhost',
  });
  for (const key of [
    'window',
    'document',
    'HTMLElement',
    'HTMLInputElement',
    'Event',
    'MouseEvent',
    'localStorage',
    'sessionStorage',
  ])
    globalThis[key] = dom.window[key];
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import('react-dom/client'));
  PaymentPanel = (await import('../src/components/PaymentPanel')).default;
  AccountPanel = (await import('../src/components/AccountPanel')).default;
  ({ useConversations } = await import('../src/hooks/useConversations'));
});
function mount(element) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(element));
}
function button(label) {
  return [...host.querySelectorAll('button')].find(
    (el) => el.textContent === label,
  );
}
function click(label) {
  assert.ok(button(label), label);
  act(() => button(label).click());
}
function input(selector, value) {
  const el = host.querySelector(selector);
  assert.ok(el, selector);
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function submit(selector = 'form') {
  act(() =>
    host
      .querySelector(selector)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}
afterEach(() => {
  if (root) {
    act(() => root.unmount());
    root = null;
  }
  host?.remove();
  localStorage.clear();
  sessionStorage.clear();
});
const order = (id) => ({
  id,
  status: 'PENDING',
  amountCents: 1000,
  channel: 'ALIPAY',
  qrCode: null,
  expiresAt: new Date(Date.now() + 600000).toISOString(),
});

test('late old payment query cannot overwrite a new order or remove its recovery key', async () => {
  const old = deferred();
  let created = 0;
  globalThis.fetch = async (url, init) =>
    init?.method === 'POST'
      ? response(order('order-' + ++created))
      : old.promise;
  mount(<PaymentPanel baseUrl="" userId="user-1" onPaid={() => {}} />);
  submit();
  await flush();
  click('刷新支付状态');
  click('新建另一订单');
  submit();
  await flush();
  assert.match(host.textContent, /order-2/);
  await act(async () =>
    old.resolve(response({ ...order('order-1'), status: 'PAID' })),
  );
  assert.match(host.textContent, /order-2/);
  assert.equal(
    JSON.parse(sessionStorage.getItem('bobo.payment.v1::user-1')).orderId,
    'order-2',
  );
});

test('email binding response after account panel unmount cannot restore the former login', async () => {
  const me = deferred();
  let updates = 0;
  let queried = false;
  globalThis.fetch = async (url) =>
    String(url).endsWith('/email/bind')
      ? response({ emailBound: true })
      : String(url).endsWith('/auth/me')
        ? ((queried = true), me.promise)
        : response([]);
  mount(
    <AccountPanel
      user={{ userId: 'old-user', username: 'old', emailBound: false }}
      baseUrl=""
      wallet={null}
      walletError=""
      connected={false}
      onRefresh={async () => {}}
      onUser={() => updates++}
    />,
  );
  await flush();
  input('#qq-email-BIND', '123456@qq.com');
  input('#qq-code-BIND', '123456');
  submit();
  await flush();
  assert.equal(queried, true);
  act(() => root.unmount());
  root = null;
  await act(async () =>
    me.resolve(
      response({ userId: 'old-user', username: 'old', emailBound: true }),
    ),
  );
  assert.equal(updates, 0);
});

test('account switch cancels old generation and late completion cannot clear the next account busy state', async () => {
  const requests = [];
  let state;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/api/agent-executions')) {
      const next = deferred();
      requests.push({ ...next, signal: init.signal });
      return next.promise;
    }
    return response([]);
  };
  function Harness({ scope }) {
    state = useConversations({
      settings: { baseUrl: '', theme: 'light' },
      accountScope: scope,
      notify: () => {},
      openSettings: () => {},
    });
    return null;
  }
  mount(<Harness scope="first" />);
  act(() => state.send('old question'));
  await flush();
  assert.equal(requests.length, 1);
  act(() => root.render(<Harness scope="second" />));
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(state.busy, null);
  act(() => state.send('new question'));
  await flush();
  assert.equal(requests.length, 2);
  const nextId = state.busy.msgId;
  await act(async () =>
    requests[0].resolve(new Response('expired', { status: 401 })),
  );
  assert.equal(state.busy.msgId, nextId);
  await act(async () => requests[1].resolve(response({executionId:'next',requestId:'next',type:'CHAT',status:'COMPLETED',version:1,lastSeq:0,question:'new question',answer:'done',sources:[],error:null,roundsUsed:0,roundLimit:4,tokensUsed:0,toolCalls:0})));
});

test('conversation cache isolates backend addresses without punctuation collisions', async () => {
  const { saveConversations, loadConversations } =
    await import('../src/lib/storage');
  const entry = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title: 'private',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
  };
  saveConversations([entry], 'https://server/a+b:user');
  assert.equal(loadConversations('https://server/a+b:user').length, 1);
  assert.equal(loadConversations('https://server/a_b:user').length, 0);
});

test('a delayed wallet query cannot undo a newer debt event or admit generation', async () => {
  const { useBilling } = await import('../src/hooks/useBilling');
  const pending = [];
  let state;
  let events;
  const originalEvents = globalThis.EventSource;
  globalThis.EventSource = class {
    constructor() {
      events = this;
      this.listener = null;
    }
    addEventListener(_name, listener) {
      this.listener = listener;
    }
    close() {}
    emit(wallet) {
      this.listener({ data: JSON.stringify(wallet) });
    }
  };
  globalThis.fetch = async () => {
    const next = deferred();
    pending.push(next);
    return next.promise;
  };
  const good = {
    balanceMicros: 1000000,
    reservedMicros: 0,
    freeImages: 0,
    arrears: false,
    lowBalance: false,
    blocked: false,
    activeUsageId: null,
  };
  const debt = { ...good, balanceMicros: -1, arrears: true, blocked: true };
  function Harness() {
    state = useBilling('', 'user-1', {
      onWarning: () => {},
      onUnauthenticated: () => {},
    });
    return null;
  }
  try {
    mount(<Harness />);
    act(() => events.emit(debt));
    await act(async () => pending[0].resolve(response(good)));
    assert.equal(state.wallet.arrears, true);
    let checking;
    act(() => {
      checking = state.check('IMAGE');
    });
    const denied = assert.rejects(checking, /欠费/);
    act(() => events.emit(debt));
    await act(async () => pending[1].resolve(response(good)));
    await denied;
  } finally {
    globalThis.EventSource = originalEvents;
  }
});

test('token warning appears at 100k, deduplicates updates and rearms after recovery', async () => {
  const { useBilling } = await import('../src/hooks/useBilling');
  const warnings = [];
  let state, events;
  const originalEvents = globalThis.EventSource;
  globalThis.EventSource = class {
    constructor() { events = this; }
    addEventListener(_name, listener) { this.listener = listener; }
    close() {}
    emit(wallet) { this.listener({ data: JSON.stringify(wallet) }); }
  };
  const good = { balanceMicros: 0, reservedMicros: 0, freeImages: 2, freeTokens: 1000000,
    arrears: false, lowBalance: true, blocked: false, activeUsageId: null };
  globalThis.fetch = async () => response(good);
  function Harness() {
    state = useBilling('', 'user-1', { onWarning: w => warnings.push(w), onUnauthenticated: () => {} });
    return null;
  }
  try {
    mount(<Harness />); await flush();
    assert.equal(warnings.length, 0, 'zero money must not warn while free quota is healthy');
    act(() => events.emit({ ...good, freeTokens: 100001 }));
    assert.equal(warnings.length, 0);
    act(() => events.emit({ ...good, freeTokens: 100000 }));
    assert.equal(warnings.length, 1);
    act(() => events.emit({ ...good, freeTokens: 80000 }));
    assert.equal(warnings.length, 1);
    act(() => events.emit({ ...good, freeTokens: 0 }));
    assert.equal(warnings.length, 2, 'exhaustion gets its own notification');
    act(() => events.emit({ ...good, freeTokens: 1000000, lowBalance: false }));
    act(() => events.emit({ ...good, freeTokens: 99999 }));
    assert.equal(warnings.length, 3);
    act(() => events.emit({ ...good, freeTokens: 0, balanceMicros: 10000000, lowBalance: false }));
    assert.equal(warnings.length, 4, 'exhaustion must warn even when prepaid cash is healthy');
    act(() => events.emit({ ...good, balanceMicros: -1, arrears: false }));
    assert.equal(warnings.length, 5, 'negative money is debt even without the flag');
    assert.equal(state.wallet.balanceMicros, -1);
  } finally { globalThis.EventSource = originalEvents; }
});

test('account page shows remaining free tokens and debt despite unused promotions', async () => {
  globalThis.fetch = async () => response([]);
  const props = { user: { userId: 'user-1', username: 'alice', emailBound: true }, baseUrl: '',
    wallet: { balanceMicros: 0, reservedMicros: 0, freeImages: 0, freeTokens: 1000000,
      arrears: false, lowBalance: false, blocked: false, activeUsageId: null },
    walletError: '', connected: true, onRefresh: async () => {}, onUser: () => {} };
  mount(<AccountPanel {...props} />); await flush();
  assert.match(host.textContent, /免费 Token/);
  assert.match(host.textContent, /1,000,000/);
  assert.doesNotMatch(host.textContent, /对话和识图需充值/);
  act(() => root.render(<AccountPanel {...props} wallet={{ ...props.wallet, freeTokens: 100000, balanceMicros: -1 }} />));
  assert.match(host.querySelector('[role="status"]').textContent, /欠费/);
});

test('composer allows free chat and disables sending when a debt event arrives', async () => {
  const Composer = (await import('../src/components/Composer')).default;
  const props = { value: 'hello', onChange: () => {}, onSend: async () => true, onStop: () => {},
    running: false, signedIn: true, onOpenAccount: () => {},
    wallet: { balanceMicros: 0, reservedMicros: 0, freeImages: 0, freeTokens: 1000000,
      arrears: false, lowBalance: false, blocked: false, activeUsageId: null } };
  mount(<Composer {...props} />);
  assert.equal(host.querySelector('[aria-label="发送"]').disabled, false);
  act(() => root.render(<Composer {...props} wallet={{ ...props.wallet, balanceMicros: -1 }} />));
  assert.equal(host.querySelector('[aria-label="发送"]').disabled, true);
  assert.match(host.textContent, /欠费/);
});

test('reconnecting existing work allows its reservation but still checks fresh debt', async () => {
  const { useBilling } = await import('../src/hooks/useBilling');
  let state;
  const originalEvents = globalThis.EventSource;
  globalThis.EventSource = class { addEventListener() {} close() {} };
  let wallet = { balanceMicros: 0, reservedMicros: 0, freeImages: 0, freeTokens: 1000000,
    arrears: false, lowBalance: false, blocked: true, activeUsageId: 'existing' };
  globalThis.fetch = async () => response(wallet);
  function Harness() { state = useBilling('', 'user-1', { onWarning: () => {}, onUnauthenticated: () => {} }); return null; }
  try {
    mount(<Harness />); await flush();
    await act(async () => { await state.check('CHAT', { reconnectOnly: true }); });
    await act(async () => { await assert.rejects(state.check('CHAT'), /处理中|对账/); });
    wallet = { ...wallet, balanceMicros: -1 };
    await act(async () => { await assert.rejects(state.check('CHAT', { reconnectOnly: true }), /欠费/); });
  } finally { globalThis.EventSource = originalEvents; }
});
