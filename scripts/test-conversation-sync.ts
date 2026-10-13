import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConversationSync, durableSnapshot, mergeSnapshots } from '../src/lib/conversationSync';
import type { Conversation } from '../src/types';

const conv=(id='c',updatedAt=1):Conversation=>({id,title:id,createdAt:1,updatedAt,messages:[]});
test('initial merge preserves newer local work, remote history and deletion tombstones',()=>{
 const merged=mergeSnapshots([conv('a',5),conv('deleted')],[{id:'a',revision:2,deleted:false,snapshot:conv('a',3)},{id:'b',revision:1,deleted:false,snapshot:conv('b')},{id:'deleted',revision:2,deleted:true,snapshot:null}]);
 assert.deepEqual(merged.map(c=>c.id).sort(),['a','b']);assert.equal(merged.find(c=>c.id==='a')?.updatedAt,5);
});
test('recursive durable snapshot strips signed source, result and nested request URLs',()=>{
 const value=conv();value.messages=[{id:'m',role:'user',createdAt:1,content:'user URL https://example.com',attachments:[{assetId:'a',fileName:'x',mimeType:'image/png',fileSize:1,previewUrl:'blob:secret'}],imageRequest:{requestId:'r',conversationId:'c',prompt:'x',state:'accepted',attachments:[{assetId:'a',fileName:'x',mimeType:'image/png',fileSize:1,previewUrl:'https://signed'}]}}];
 const json=JSON.stringify(durableSnapshot(value));assert.ok(!json.includes('secret'));assert.ok(!json.includes('signed'));assert.ok(json.includes('https://example.com'));
});
test('serial writes carry last server revision and deletion produces a tombstone',async()=>{
 const calls:any[]=[];const remote={list:async()=>[],get:async()=>{throw Error('unexpected');},put:async(id:string,request:any)=>{calls.push([id,request]);return {id,revision:request.expectedRevision+1,deleted:request.deleted,snapshot:request.snapshot};}};
 const sync=new ConversationSync(remote);await sync.load([]);await sync.save([conv()]);await sync.save([conv('c',2)]);await sync.save([]);
 assert.deepEqual(calls.map(([,r])=>[r.expectedRevision,r.deleted]),[[0,false],[1,false],[2,true]]);
});
test('failed or conflicting writes retain local work and never automatically overwrite remote version',async()=>{
 let writes=0;const remote={list:async()=>[],get:async()=>{throw Error('unexpected');},put:async()=>{writes++;throw Error('409 conflict');}};
 const sync=new ConversationSync(remote);await sync.load([]);await assert.rejects(sync.save([conv()]),/409/);await assert.rejects(sync.save([conv()]),/409/);assert.equal(writes,2);
});
test('empty remote index never deletes local history and aborted synchronization never writes',async()=>{
 let writes=0;const controller=new AbortController();const sync=new ConversationSync({list:async()=>[],get:async()=>{throw Error('unexpected');},put:async()=>{writes++;throw Error('unexpected');}},controller.signal);
 assert.deepEqual(await sync.load([conv()]),[conv()]);controller.abort();await assert.rejects(sync.save([conv()]));assert.equal(writes,0);
});
test('initial fetch merges against the latest local state rather than the state before the network wait',async()=>{
 let resolve:any;let local=[conv('a')];
 const remote={list:async()=>new Promise<any[]>(done=>resolve=done),get:async()=>{throw Error('unexpected');},put:async()=>{throw Error('unexpected');}};
 const sync=new ConversationSync(remote);const loading=sync.load(()=>local);local=[conv('new',7),...local];resolve([]);
 assert.deepEqual((await loading).map(c=>c.id),['new','a']);
});
