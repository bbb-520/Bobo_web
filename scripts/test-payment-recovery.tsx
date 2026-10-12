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

test('reset remains available while order creation is pending and unlocks a new attempt',async () => {
  let started;
  const waiting=new Promise(resolve => { started=resolve; });
  globalThis.fetch=async (_url, init) => {
    started();
    return new Promise((_resolve,reject) => init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));
  };
  host=document.createElement('div'); document.body.append(host); root=createRoot(host);
  act(() => root.render(<PaymentPanel baseUrl="" userId="alice" onPaid={() => {}} />));
  await act(async () => { host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); await waiting; });
  const reset=[...host.querySelectorAll('button')].find(b=>b.textContent.includes('重新选择金额'));
  assert.equal(reset.disabled,false,'a stalled request must not disable resetting the form');
  await act(async () => reset.click());
  await flush();
  assert.equal(host.querySelector('input').disabled,false);
  assert.equal(sessionStorage.getItem('bobo.payment.v1::alice'),null);
  assert.match(host.textContent,/生成付款二维码/);
  assert.doesNotMatch(host.textContent,/正在创建订单|Aborted/);
});

test('a failed order can retry with the same key and reset its failure message',async () => {
  const keys=[];
  globalThis.fetch=async (_url,init) => {
    keys.push(new Headers(init.headers).get('Idempotency-Key'));
    return Response.json({message:'支付宝应用尚未上线'},{status:503});
  };
  host=document.createElement('div'); document.body.append(host); root=createRoot(host);
  act(() => root.render(<PaymentPanel baseUrl="" userId="alice" onPaid={() => {}} />));
  for(let i=0;i<2;i++) {
    await act(async () => host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    await flush();
  }
  assert.equal(keys.length,2); assert.ok(keys[0]); assert.equal(keys[0],keys[1]);
  assert.match(host.textContent,/支付宝应用尚未上线/);
  await act(async () => [...host.querySelectorAll('button')].find(b=>b.textContent.includes('重新选择金额')).click());
  assert.equal(host.querySelector('input').disabled,false);
  assert.equal(host.querySelector('[role="alert"]'),null);
});

test('a restored order without a QR code can reset while retrying prepay',async () => {
  sessionStorage.setItem('bobo.payment.v1::alice',JSON.stringify({key:'restored-key',channel:'ALIPAY',amountCents:1,orderId:'restored-order'}));
  let started;
  const waiting=new Promise(resolve=>{started=resolve;});
  globalThis.fetch=async (_url,init) => {
    if(init?.method==='POST') {
      started();
      return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));
    }
    return Response.json({id:'restored-order',channel:'ALIPAY',amountCents:1,status:'PENDING',qrCode:null,expiresAt:new Date(Date.now()+60000).toISOString()});
  };
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  act(()=>root.render(<PaymentPanel baseUrl="" userId="alice" onPaid={()=>{}} />));await flush();
  assert.match(host.textContent,/重试获取二维码/);
  await act(async()=>{host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await waiting;});
  const reset=[...host.querySelectorAll('button')].find(b=>b.textContent.includes('新建另一订单'));
  assert.equal(reset.disabled,false,'restored orders must also allow resetting during prepay');
  await act(async()=>reset.click());await flush();
  assert.equal(host.querySelector('input').disabled,false);
  assert.equal(sessionStorage.getItem('bobo.payment.v1::alice'),null);
  assert.match(host.textContent,/生成付款二维码/);
});
