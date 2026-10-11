import assert from 'node:assert/strict';
import { test } from 'node:test';

let protocol, recovery, runner;
try { protocol = await import('../src/api/executions.ts'); } catch {}
try { recovery = await import('../src/lib/executionRecovery.ts'); } catch {}
try { runner = await import('../src/lib/executionRunner.ts'); } catch {}
const snapshot = (patch = {}) => ({ executionId:'e1',requestId:'r1',type:'CHAT',status:'RUNNING',version:1,lastSeq:0,question:'hello',answer:'',sources:[],error:null,roundsUsed:0,roundLimit:4,tokensUsed:0,toolCalls:0,...patch });
const event = (seq, type, generationVersion, payload) => ({ executionId:'e1',seq,type,generationVersion,payload });

test('model status follows actual fallback events, ignores old generations and survives snapshots', () => {
  let state=protocol.applyExecutionEvent(snapshot(),event(1,'model_status',1,{provider:'GPT',model:'gpt-4.1',state:'RUNNING',fallback:false,capability:'CHAT'}));
  assert.equal(state.modelStatus.provider,'GPT');
  state=protocol.applyExecutionEvent(state,event(2,'model_status',2,{provider:'QWEN',model:'qwen-plus',state:'RUNNING',fallback:true,capability:'CHAT'}));
  state=protocol.applyExecutionEvent(state,event(3,'model_status',1,{provider:'GPT',model:'gpt-4.1',state:'SUCCEEDED',fallback:false,capability:'CHAT'}));
  assert.equal(state.modelStatus.provider,'QWEN');
  state=protocol.mergeExecutionSnapshot(state,snapshot({lastSeq:3,version:2,generationVersion:2,modelStatus:{provider:'QWEN',model:'qwen-plus',state:'SUCCEEDED',fallback:true,capability:'CHAT'}}));
  assert.equal(state.modelStatus.state,'SUCCEEDED');
  assert.equal(state.fallback,true);
});

test('SSE joins multi-line data and handles CRLF and UTF-8 across network chunks', () => {
  assert.ok(protocol, 'persistent execution protocol is implemented');
  const frames = [];
  const parser = new protocol.SseParser(frame => frames.push(frame));
  for (const part of [': heartbeat\r', '\nevent: answer_delta\r\nid: e1:1\r\ndata: {"executionId":"e1",\r\n', 'data: "seq":1,"type":"answer_delta","generationVersion":1,"payload":{"text":"你好"}}\r\n\r', '\nevent: status\nid: e1:2\ndata: {"ok":true}\n\n']) parser.push(part);
  parser.finish();
  assert.equal(frames.length,2);
  assert.equal(frames[0].id,'e1:1');
  assert.equal(JSON.parse(frames[0].data).payload.text,'你好');
});

test('duplicate sequence and old answer generation cannot overwrite replacement', () => {
  assert.ok(protocol, 'execution state reducer is implemented');
  let state = snapshot();
  state = protocol.applyExecutionEvent(state,event(1,'answer_delta',1,{text:'old'}));
  state = protocol.applyExecutionEvent(state,event(1,'answer_delta',1,{text:'duplicate'}));
  state = protocol.applyExecutionEvent(state,event(2,'answer_replace',2,{text:'replacement'}));
  state = protocol.applyExecutionEvent(state,event(3,'answer_delta',1,{text:'stale'}));
  state = protocol.applyExecutionEvent(state,event(4,'answer_delta',2,{text:' answer'}));
  assert.equal(state.answer,'replacement answer');
  assert.equal(state.lastSeq,4);
  assert.equal(protocol.applyExecutionEvent(state,{...event(5,'answer_replace',3,{text:'alien'}),executionId:'another'}).answer,'replacement answer');
});

test('a stale status snapshot cannot replace newer SSE answer or rewind sequence', () => {
  assert.ok(protocol, 'snapshot merging is implemented');
  const live = snapshot({lastSeq:8,generationVersion:2,answer:'verified replacement'});
  const merged = protocol.mergeExecutionSnapshot(live,snapshot({lastSeq:7,answer:'old'}));
  assert.equal(merged.answer,'verified replacement');
  assert.equal(merged.lastSeq,8);
});

test('a new generation clears old model identity until the next model starts',()=>{
  const live=snapshot({modelStatus:{provider:'QWEN',model:'qwen-plus',state:'SUCCEEDED',generationVersion:1,fallback:true},fallback:true});
  const merged=protocol.mergeExecutionSnapshot(live,snapshot({generationVersion:2,lastSeq:live.lastSeq+1}));
  assert.equal(merged.modelStatus,undefined);
  assert.equal(merged.fallback,false);
});

test('request recovery survives reload and is isolated by account and backend scope', () => {
  assert.ok(recovery, 'account-scoped execution recovery is implemented');
  const values = new Map();
  const storage = {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  recovery.saveExecutionRecovery('server/a+b:user',[{convId:'c1',msgId:'m1',request:{requestId:'r1',type:'CHAT',question:'hello',conversationId:'c1'},executionId:'e1',lastSeq:7}],storage);
  assert.equal(recovery.loadExecutionRecovery('server/a+b:user',storage)[0].lastSeq,7);
  assert.equal(recovery.loadExecutionRecovery('server/a_b:user',storage).length,0);
  assert.equal(recovery.loadExecutionRecovery('server/a+b:other',storage).length,0);
});

test('observer disconnect cancels the subscription without a stop mutation', async () => {
  assert.ok(runner, 'persistent execution observer is implemented');
  const calls=[];
  const abort=new AbortController();
  const api={ get:async()=>snapshot(), subscribe:async(_id,_seq,signal)=>{calls.push('subscribe');abort.abort();assert.equal(signal.aborted,true);},stop:async()=>calls.push('stop') };
  await runner.observeExecution(snapshot(),{api,signal:abort.signal,onSnapshot:()=>{}});
  assert.deepEqual(calls,['subscribe']);
});

test('reconnect checks current snapshot and replays after the persisted sequence', async () => {
  assert.ok(runner, 'snapshot and replay recovery is implemented');
  const seen=[], cursors=[];
  let queries=0;
  await runner.observeExecution(snapshot({lastSeq:3,answer:'saved'}),{
    api:{get:async()=>snapshot({lastSeq:++queries===1?3:5,status:queries===1?'RUNNING':'COMPLETED',answer:queries===1?'saved':'finished'}),subscribe:async(_id,seq,_signal,onEvent)=>{cursors.push(seq);onEvent(event(4,'answer_delta',1,{text:' answer'}));}},
    signal:new AbortController().signal,onSnapshot:value=>seen.push(value),wait:async()=>{},
  });
  assert.deepEqual(cursors,[3]);
  assert.equal(seen.at(-1).answer,'finished');
  assert.equal(seen.at(-1).status,'COMPLETED');
});

test('explicit stop calls stop HTTP API, while SSE forwards Last-Event-ID', async () => {
  assert.ok(protocol, 'execution HTTP API is implemented');
  const calls=[];
  const original=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{calls.push({url,init});return String(url).endsWith('/events') ? new Response('',{headers:{'Content-Type':'text/event-stream'}}) : new Response(JSON.stringify(snapshot({status:'STOPPED'})),{headers:{'Content-Type':'application/json'}});};
  try {
    const api=protocol.executionApi('');
    await api.stop('e1');
    await api.subscribe('e1',12,new AbortController().signal,()=>{});
    assert.equal(calls[0].url,'/api/agent-executions/e1/stop');
    assert.equal(calls[0].init.method,'POST');
    assert.equal(new Headers(calls[1].init.headers).get('Last-Event-ID'),'e1:12');
    assert.equal(calls[1].init.credentials,'include');
  } finally {globalThis.fetch=original;}
});

test('terminal SSE state is reconciled with server budget counters and resume version',async()=>{
  let queries=0;const seen=[];
  await runner.observeExecution(snapshot(),{
    api:{get:async()=>snapshot(++queries===1?{}:{status:'STOPPED',lastSeq:2,version:3,roundsUsed:4,tokensUsed:200}),subscribe:async(_id,_seq,_signal,onEvent)=>{onEvent(event(1,'answer_delta',1,{text:'partial'}));onEvent(event(2,'status',1,{status:'STOPPED'}));}},
    signal:new AbortController().signal,onSnapshot:value=>seen.push(value),wait:async()=>{},
  });
  assert.equal(seen.at(-1).version,3);
  assert.equal(seen.at(-1).roundsUsed,4);
  assert.equal(seen.at(-1).tokensUsed,200);
});

test('a live subscription reconciles stop intent and budget snapshots without waiting for disconnect',async()=>{
  const abort=new AbortController();let queries=0;const seen=[];
  const observing=runner.observeExecution(snapshot(),{
    api:{get:async()=>snapshot(++queries===1?{}:{status:'STOPPED',lastSeq:2,roundsUsed:4}),subscribe:async(_id,_seq,signal)=>new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}))},
    signal:abort.signal,onSnapshot:value=>seen.push(value),snapshotPollMs:10,
  });
  const completed=await Promise.race([observing.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),100))]);
  abort.abort();await observing;
  assert.equal(completed,true,'live SSE was never reconciled with durable stop status');
  assert.equal(seen.at(-1).status,'STOPPED');
});
