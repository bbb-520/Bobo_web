import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/storage.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  },
});

const module = { exports: {} };
const context = vm.createContext({
  module,
  exports: module.exports,
  require: () => ({}),
  crypto: {},
  Math,
  Date,
  console,
  localStorage: {
    getItem: () => JSON.stringify([{ id: 'id-1790416290385-7q2enzck', messages: [] }]),
    setItem: () => {},
    removeItem: () => {},
  },
});
vm.runInContext(outputText, context, { filename: 'storage.ts' });

const id = module.exports.uid();
assert.match(
  id,
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  `uid() must return a UUID v4 when crypto.randomUUID is unavailable; received ${id}`,
);

console.log(`storage uid fallback passed: ${id}`);

const migrated = module.exports.loadConversations('guest');
assert.match(
  migrated[0].id,
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  `loadConversations() must migrate persisted legacy ids; received ${migrated[0].id}`,
);

console.log(`legacy conversation id migration passed: ${migrated[0].id}`);

context.localStorage.getItem = () => JSON.stringify([{id:'22222222-2222-4222-8222-222222222222',messages:[
  {id:'image',role:'assistant',status:'streaming',modelStatus:{provider:'GPT',model:'gpt-4.1',state:'RUNNING',generationVersion:1}},
  {id:'durable',role:'assistant',status:'streaming',execution:{executionId:'task',status:'RUNNING'}},
]}]);
const restored=module.exports.loadConversations('guest')[0].messages;
assert.equal(restored[0].status,'stopped','a disconnected image stream must not stay working after reload');
assert.equal(restored[0].modelStatus.provider,'GPT','keep the actual model identity on reload');
assert.equal(restored[1].status,'streaming','durable tasks must remain available for reattachment');
console.log('model status restoration passed');
let persisted;
context.localStorage.setItem=(_key,value)=>{persisted=value;};
module.exports.saveConversations([{id,messages:[{id:'a',imageRequest:{attachments:[{assetId:'owned',previewUrl:'https://signed.example/image'}]},execution:{result:{imageUrl:'https://signed.example/output'}}}]}],'guest');
assert.doesNotMatch(persisted,/signed\.example/,'nested provider URLs must never be persisted');
assert.match(persisted,/owned/,'durable asset identifiers must be preserved');
context.localStorage.setItem=()=>{throw new Error('quota exceeded');};
assert.throws(()=>module.exports.saveConversations([{id,messages:[]}],'guest'),/保存|存储|storage/i,'storage failure must be visible before dispatch');
