import assert from 'node:assert/strict';
import {test, before, afterEach} from 'node:test';
import {JSDOM} from 'jsdom';
import React, {act} from 'react';
let createRoot, useBilling, root, state;
let timers: Map<number, () => void>;
let sequence = 0;
before(async () => {
  const dom = new JSDOM('<body></body>', {url: 'http://localhost'});
  for (const key of ['window','document','HTMLElement','Event']) globalThis[key]=dom.window[key];
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  globalThis.EventSource=class {addEventListener() {} close() {} };
  ({createRoot}=await import('react-dom/client'));
  ({useBilling}=await import('../src/hooks/useBilling'));
});
afterEach(() => {if(root)act(()=>root.unmount());root=null;});
const flush=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
function mount() {
  timers=new Map();
  window.setTimeout=((fn)=>{timers.set(++sequence,fn);return sequence;}) as typeof window.setTimeout;
  window.clearTimeout=(id)=>{timers.delete(id);};
  function Harness(){state=useBilling('', 'alice', {onWarning:()=>{},onUnauthenticated:()=>{}});return null;}
  root=createRoot(document.createElement('div'));
  act(()=>root.render(<Harness/>));
}
const wallet=(busy)=>({balanceMicros:0,reservedMicros:0,freeImages:0,freeTokens:1000000,arrears:false,lowBalance:false,blocked:busy,activeUsageId:busy?'failed-image':null});
test('silent balance event stream cannot leave a recovered wallet blocked indefinitely',async()=>{
  let requests=0;
  globalThis.fetch=async()=>Response.json(wallet(++requests===1));
  mount();await flush();
  assert.equal(state.wallet.blocked,true);
  assert.ok(timers.size>0,'An independent wallet refresh must be scheduled');
  const callbacks=[...timers.values()];timers.clear();
  await act(async()=>{for(const callback of callbacks)callback();});await flush();
  assert.equal(state.wallet.blocked,false);
  assert.equal(state.wallet.activeUsageId,null);
  assert.equal(requests,2);
});
test('wallet recovery polling stops after unmount and never dispatches image requests',async()=>{
  const paths=[];
  globalThis.fetch=async(url)=>{paths.push(String(url));return Response.json(wallet(true));};
  mount();await flush();
  act(()=>root.unmount());root=null;
  assert.equal(timers.size,0);
  assert.deepEqual(paths,['/api/billing/wallet']);
});
