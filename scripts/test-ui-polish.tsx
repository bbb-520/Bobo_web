import assert from 'node:assert/strict';
import { test, before, afterEach } from 'node:test';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@hugeicons/react') return {url:'data:text/javascript,export const HugeiconsIcon=()=>null;',shortCircuit:true};
    if (specifier === '@hugeicons/core-free-icons') return {url:'data:text/javascript,export const ArrowDown01Icon={},SparklesIcon={},Tick02Icon={};',shortCircuit:true};
    if (specifier === 'motion/react') return {url:'data:text/javascript,export const useReducedMotion=()=>true;export const animate=()=>Object.assign(Promise.resolve(),{stop(){}});',shortCircuit:true};
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.css')) return {format:'module',source:'export {};',shortCircuit:true};
    return next(url, context);
  },
});
let ThoughtLine, createRoot, host, root;
const originalNow = Date.now;
let now = 1_800_000_000_000;
before(async () => {
  const dom = new JSDOM('<body></body>', {url:'http://localhost'});
  for (const key of ['window','document','HTMLElement']) globalThis[key] = dom.window[key];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.React = React;
  globalThis.ResizeObserver = class {observe(){} disconnect(){}};
  ({createRoot} = await import('react-dom/client'));
  ThoughtLine = (await import('../src/components/ThoughtLine.jsx')).default;
});
afterEach(() => {if(root)act(()=>root.unmount());root=null;host?.remove();Date.now=originalNow;});
function render(props) {
  if(!root){host=document.createElement('div');document.body.append(host);root=createRoot(host);}
  act(()=>root.render(<ThoughtLine {...props}/>));
}
const timer=()=>host.querySelector('.thought-line__timer').textContent;
test('restored active message uses persisted start instead of restarting at zero', async()=>{
  Date.now=()=>now;
  render({working:true,startedAt:now-4200});
  assert.equal(timer(),'4.2s');
  now+=500;
  await act(async()=>new Promise(resolve=>setTimeout(resolve,120)));
  assert.equal(timer(),'4.7s');
  act(()=>root.unmount());root=null;host.remove();
  render({working:true,startedAt:now-4700});
  assert.equal(timer(),'4.7s');
});
test('completion freezes duration and remount preserves the same elapsed time',async()=>{
  Date.now=()=>now;
  const startedAt=now-7300;
  render({working:true,startedAt});
  render({working:false,startedAt,finishedAt:now});
  assert.equal(timer(),'7.3s');
  now+=60000;
  await act(async()=>new Promise(resolve=>setTimeout(resolve,120)));
  assert.equal(timer(),'7.3s');
  act(()=>root.unmount());root=null;host.remove();
  render({working:false,startedAt,finishedAt:now-60000});
  assert.equal(timer(),'7.3s');
});
test('history opened after a long time does not include time spent away',()=>{
  Date.now=()=>now;
  render({working:false,startedAt:now-86400000,finishedAt:now-86396500});
  assert.equal(timer(),'3.5s');
});
test('future or inverted timestamps do not create negative elapsed time',()=>{
  Date.now=()=>now;
  render({working:false,startedAt:now+5000,finishedAt:now});
  assert.equal(timer(),'0.0s');
});
