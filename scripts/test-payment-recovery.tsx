import assert from 'node:assert/strict';
import { test, before, afterEach } from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

let createRoot, PaymentPanel, root, host;
before(async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost' });
  for (const key of ['window','document','HTMLElement','HTMLInputElement','Event','MouseEvent','localStorage','sessionStorage']) globalThis[key] = dom.window[key];
  Object.defineProperty(globalThis,'navigator',{ value:dom.window.navigator, configurable:true });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import('react-dom/client'));
  PaymentPanel = (await import('../src/components/PaymentPanel')).default;
});
const flush = () => act(async () => { await new Promise(r => setTimeout(r,0)); });
afterEach(() => {
  if (root) act(() => root.unmount());
  root=null;
  host?.remove();
  sessionStorage.clear();
});
async function restore(status) {
  sessionStorage.setItem('bobo.payment.v1::alice',JSON.stringify({key:'key',channel:'ALIPAY',amountCents:1,orderId:'test-order'}));
  globalThis.fetch = async () => new Response(JSON.stringify({id:'test-order',channel:'ALIPAY',amountCents:1,status,qrCode:null,expiresAt:new Date(Date.now()-60000).toISOString()}),{headers:{'Content-Type':'application/json'}});
  host=document.createElement('div'); document.body.append(host); root=createRoot(host);
  act(() => root.render(<PaymentPanel baseUrl="" userId="alice" onPaid={() => {}} />));
  await flush();
}
test('refunding an expired payment shows refund progress rather than waiting for payment',async () => {
  await restore('REFUNDING');
  assert.match(host.textContent,/退款处理中/);
  assert.doesNotMatch(host.textContent,/订单付款时间已结束|等待扫码支付/);
});
test('refunded order shows original-channel refund result',async () => {
  await restore('REFUNDED');
  assert.match(host.textContent,/已原路退款/);
});
test('provider-confirmed closed order shows closed status',async () => {
  await restore('CLOSED');
  assert.match(host.textContent,/订单已关闭/);
});
test('locally expired pending payment still polls for late confirmation',async () => {
  await restore('PENDING');
  let calls=0;
  globalThis.fetch=async () => { calls++; return new Response(JSON.stringify({id:'test-order',channel:'ALIPAY',amountCents:1,status:'PAID',qrCode:null,expiresAt:new Date(Date.now()-60000).toISOString()}),{headers:{'Content-Type':'application/json'}}); };
  await act(async () => { await new Promise(r => setTimeout(r,3200)); });
  assert.ok(calls>0);
  assert.match(host.textContent,/充值已到账/);
});
