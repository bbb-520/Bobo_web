import assert from 'node:assert/strict';
import { test, before, afterEach } from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import QRCode from 'qrcode';

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
async function restore(status, reconcileState) {
  sessionStorage.setItem('bobo.payment.v1::alice',JSON.stringify({key:'key',channel:'ALIPAY',amountCents:1,orderId:'test-order'}));
  globalThis.fetch = async () => new Response(JSON.stringify({id:'test-order',channel:'ALIPAY',amountCents:1,status,reconcileState,qrCode:null,expiresAt:new Date(Date.now()-60000).toISOString()}),{headers:{'Content-Type':'application/json'}});
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

test('manual reconciliation has a visible exit and stops automatic payment polling', async () => {
  await restore('PENDING','MANUAL');
  let calls=0;
  globalThis.fetch=async () => {calls++;throw Error('manual orders must not be polled');};
  assert.match(host.textContent,/支付结果待人工核对/);
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,3200));});
  assert.equal(calls,0);
  assert.ok([...host.querySelectorAll('button')].some(button=>button.textContent.includes('新建另一订单')));
});

test('a verified late payment remains paid even when the reconciliation audit is MANUAL', async () => {
  await restore('PAID','MANUAL');
  assert.match(host.textContent,/充值已到账/);
  assert.doesNotMatch(host.textContent,/支付结果待人工核对/);
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

test('payment form offers Alipay only and ignores obsolete Wechat attempts',async () => {
  sessionStorage.setItem('bobo.payment.v1::alice',JSON.stringify({key:'old-wx',channel:'WECHAT',amountCents:1}));
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  act(()=>root.render(<PaymentPanel baseUrl="" userId="alice" onPaid={()=>{}} />));await flush();
  assert.doesNotMatch(host.textContent,/微信支付/);
  assert.equal(host.querySelector('input').disabled,false);
});

test('failed QR rendering has an explicit same-code redraw action',async () => {
  const original=QRCode.toCanvas;let draws=0;
  QRCode.toCanvas=async()=>{if(++draws===1)throw new Error('canvas unavailable');};
  try {
    sessionStorage.setItem('bobo.payment.v1::alice',JSON.stringify({key:'qr-key',channel:'ALIPAY',amountCents:1,orderId:'qr-order'}));
    globalThis.fetch=async()=>Response.json({id:'qr-order',channel:'ALIPAY',amountCents:1,status:'PENDING',qrCode:'https://qr.alipay.com/test',expiresAt:new Date(Date.now()+60000).toISOString()});
    host=document.createElement('div');document.body.append(host);root=createRoot(host);
    act(()=>root.render(<PaymentPanel baseUrl="" userId="alice" onPaid={()=>{}} />));await flush();
    assert.match(host.textContent,/二维码.*失败/);
    const retry=[...host.querySelectorAll('button')].find(b=>b.textContent.includes('重新绘制二维码'));
    assert.ok(retry,'rendering errors require a redraw action even when the QR string is unchanged');
    await act(async()=>retry.click());await flush();
    assert.equal(draws,2);assert.doesNotMatch(host.textContent,/二维码.*失败/);
  } finally { QRCode.toCanvas=original; }
});

test('refresh QR reuses the owned order endpoint rather than creating another order',async () => {
  const original=QRCode.toCanvas;QRCode.toCanvas=async()=>{};const calls=[];
  try {
    sessionStorage.setItem('bobo.payment.v1::alice',JSON.stringify({key:'same-key',channel:'ALIPAY',amountCents:1,orderId:'same-order'}));
    globalThis.fetch=async(url,init)=> {
      calls.push([String(url),init?.method??'GET']);
      return Response.json({id:'same-order',channel:'ALIPAY',amountCents:1,status:'PENDING',qrCode:'https://qr.alipay.com/'+(init?.method==='POST'?'new':'old'),expiresAt:new Date(Date.now()+60000).toISOString()});
    };
    host=document.createElement('div');document.body.append(host);root=createRoot(host);
    act(()=>root.render(<PaymentPanel baseUrl="" userId="alice" onPaid={()=>{}} />));await flush();
    const button=[...host.querySelectorAll('button')].find(b=>b.textContent==='刷新付款二维码');assert.ok(button);
    await act(async()=>button.click());await flush();
    assert.ok(calls.some(([url,method])=>url.endsWith('/api/payments/orders/same-order/qr')&&method==='POST'));
    assert.ok(!calls.some(([url,method])=>url.endsWith('/api/payments/orders')&&method==='POST'));
  } finally { QRCode.toCanvas=original; }
});

test('manual refund review has an explicit status rather than an endless processing message',async()=>{
  await restore('REFUND_REVIEW');assert.match(host.textContent,/退款待人工核对/);
  assert.doesNotMatch(host.textContent,/退款处理中|等待扫码支付/);
});

test('failed QR refresh keeps the previous valid QR and displays the error',async()=>{
  const original=QRCode.toCanvas;QRCode.toCanvas=async()=>{};
  try {
    sessionStorage.setItem('bobo.payment.v1::alice',JSON.stringify({key:'retain-key',channel:'ALIPAY',amountCents:1,orderId:'retain-order'}));
    globalThis.fetch=async(_url,init)=>init?.method==='POST'?Response.json({message:'渠道暂不可用'},{status:502}):Response.json({id:'retain-order',channel:'ALIPAY',amountCents:1,status:'PENDING',qrCode:'https://qr.alipay.com/retain',qrVersion:1,stateVersion:0,expiresAt:new Date(Date.now()+60000).toISOString()});
    host=document.createElement('div');document.body.append(host);root=createRoot(host);
    act(()=>root.render(<PaymentPanel baseUrl="" userId="alice" onPaid={()=>{}} />));await flush();
    await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='刷新付款二维码').click());await flush();
    assert.ok(host.querySelector('canvas'));assert.match(host.textContent,/渠道暂不可用/);
    assert.match(sessionStorage.getItem('bobo.payment.v1::alice'),/retain-order/);
  }finally{QRCode.toCanvas=original;}
});
