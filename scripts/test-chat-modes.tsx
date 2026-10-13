import assert from 'node:assert/strict';
import {test,before,afterEach} from 'node:test';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
let Composer,createRoot,root,host;
const wallet={balanceMicros:0,reservedMicros:0,freeImages:0,freeTokens:1000000,arrears:false,lowBalance:true,blocked:false,activeUsageId:null};
const image=()=>new File(['image'],'photo.png',{type:'image/png'});
const doc=()=>new File(['doc'],'report.txt',{type:'text/plain'});
before(async()=>{
 const dom=new JSDOM('<body></body>',{url:'http://localhost'});
 for(const key of ['window','document','HTMLElement','localStorage','sessionStorage','Event'])globalThis[key]=dom.window[key];
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.requestAnimationFrame=cb=>setTimeout(cb,0);
 URL.createObjectURL=()=> 'blob:preview';URL.revokeObjectURL=()=>{};
 ({createRoot}=await import('react-dom/client'));Composer=(await import('../src/components/Composer')).default;
});
afterEach(()=>{if(root)act(()=>root.unmount());root=null;host?.remove();});
function mount(text='hello'){host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>root.render(<Composer value={text} onChange={()=>{}} onSend={async()=>true} onStop={()=>{}} running={false} wallet={wallet} signedIn onOpenAccount={()=>{}}/>));}
test('composer exposes five distinct modes with an accessible explanation',()=>{
 mount();assert.deepEqual([...host.querySelectorAll('select option')].map(o=>o.value),['chat','text','vision','document','image']);
 const select=host.querySelector('select');assert.ok(select.getAttribute('aria-describedby'));
 assert.match(document.getElementById(select.getAttribute('aria-describedby')).textContent,/自动|智能/);
});
test('explicit image mode can send a prompt without any reference file',()=>{
 mount('生成一张海边日落图片');const select=host.querySelector('select');act(()=>{select.value='image';select.dispatchEvent(new Event('change',{bubbles:true}));});
 assert.equal(host.querySelector('[aria-label="发送"]').disabled,false);assert.match(host.textContent,/文字|参考/);
});

test('input help is optional, follows the selected mode and can be dismissed with Escape or outside click',()=>{
 mount('');const help=host.querySelector('[aria-label="输入说明"]');assert.ok(help);assert.equal(help.getAttribute('aria-expanded'),'false');
 assert.equal(host.querySelector('[role="region"]'),null);
 act(()=>help.click());assert.equal(help.getAttribute('aria-expanded'),'true');assert.match(host.querySelector('[role="region"]').textContent,/8 个附件/);
 const select=host.querySelector('select');act(()=>{select.value='image';select.dispatchEvent(new Event('change',{bubbles:true}));});
 assert.match(host.querySelector('[role="region"]').textContent,/一张参考图片/);
 act(()=>document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 assert.equal(help.getAttribute('aria-expanded'),'false');assert.equal(document.activeElement,help);
 act(()=>help.click());act(()=>document.body.dispatchEvent(new window.Event('pointerdown',{bubbles:true})));assert.equal(host.querySelector('[role="region"]'),null);
});

for(const prompt of ['帮我生成一张图片：海边日落','画一只猫','请绘制一个森林插画','生成以下场景的图片：雨夜街头','把这张照片做成一张复古海报','Generate an image of a red panda','Create a watercolor illustration of a forest']) {
 test(`explicit generation routes to IMAGE: ${prompt}`,async()=>{
  const {resolveChatMode}=await import('../src/lib/chatModes');const route=resolveChatMode(prompt,[],'chat');assert.equal(route.mode,'image');assert.equal(route.capability,'IMAGE');assert.equal(route.automatic,true);
 });
}
for(const prompt of ['如何生成一张图片？','你能生成图片吗？','不要生成图片，只解释原理','帮我写一个生成图片的提示词','解释这段生成图片的代码','总结文档中提到的图片生成方法','图片生成失败怎么办','Draw a comparison between Java and Python','Explain how to generate an image','Do not generate an image, just explain','请帮我解释如何生成图片','给我生成图片的步骤','写一段生成图片的 Python 代码','Please explain how to generate an image','Help me write code to generate an image',"I don't want you to generate an image",'我不想生成图片，只想了解原理','What is the best way to generate an image?','Can you help me understand how to generate an image?']) {
 test(`discussion does not start a chargeable image task: ${prompt}`,async()=>{
  const {resolveChatMode}=await import('../src/lib/chatModes');assert.notEqual(resolveChatMode(prompt,[],'chat').mode,'image');
 });
}
test('strict text mode excludes earlier document and image context',async()=>{
 const {resolveChatMode}=await import('../src/lib/chatModes');const route=resolveChatMode('你好',[],'text',{hasImages:true,hasDocuments:true});
 assert.equal(route.mode,'text');assert.equal(route.useImages,false);assert.equal(route.useDocuments,false);assert.ok(resolveChatMode('hi',[image()],'text').error);
});

test('new photo requests never reuse old pictures and text mode never inherits old references',async()=>{
 const {resolveChatMode}=await import('../src/lib/chatModes');
 for(const selected of ['chat','text'] as const){const route=resolveChatMode('生成一张海边日落照片',[],selected,{hasImages:true,imageCount:2});assert.equal(route.referenceFromContext,false);assert.equal(route.error,undefined);}
 assert.equal(resolveChatMode('把这张照片改成水彩画',[],'text',{hasImages:true}).referenceFromContext,false);
 assert.equal(resolveChatMode('把这张照片改成水彩画',[],'chat',{hasImages:true}).referenceFromContext,true);
});

for(const prompt of ['请把“生成一张图片”翻译成英文',"Translate 'generate an image of a cat' into Chinese",'请问如何生成一张图片？'])test(`quoted and tutorial request is not an imperative: ${prompt}`,async()=>{
 const {resolveChatMode}=await import('../src/lib/chatModes');assert.notEqual(resolveChatMode(prompt).mode,'image');
});
for(const prompt of ['画一只猫需要哪些步骤？','帮我生成一张图片的提示词','生成一张图片需要什么条件？','画一只猫可以吗？','Generate an image prompt for a cat','Draw a cat: what steps are needed?'])test(`ambiguous request stays in chat: ${prompt}`,async()=>{
 const {resolveChatMode}=await import('../src/lib/chatModes');assert.notEqual(resolveChatMode(prompt).mode,'image');
});
test('image creation accepts the same reference formats as the backend',async()=>{
 const {IMAGE_CREATION_ACCEPT,IMAGE_CHAT_ACCEPT,validateAttachments}=await import('../src/lib/attachments');
 assert.equal(IMAGE_CREATION_ACCEPT,IMAGE_CHAT_ACCEPT);
 for(const mime of ['image/bmp','image/tiff'])assert.ok(validateAttachments([new File(['image'],'reference.bmp',{type:mime})],'image'));
});
test('file and image modes enforce attachment category and allow follow-up context',async()=>{
 const {resolveChatMode}=await import('../src/lib/chatModes');
 assert.ok(resolveChatMode('分析',[],'vision').error);assert.equal(resolveChatMode('分析',[],'vision',{hasImages:true}).mode,'vision');
 assert.ok(resolveChatMode('总结',[],'document').error);assert.equal(resolveChatMode('总结',[],'document',{hasDocuments:true}).mode,'document');
 assert.ok(resolveChatMode('分析',[doc()],'vision').error);assert.equal(resolveChatMode('总结',[doc(),image()],'document').mode,'document');
});
test('generation rejects documents and multiple images rather than silently ignoring attachments',async()=>{
 const {resolveChatMode}=await import('../src/lib/chatModes');
 assert.ok(resolveChatMode('生成一张图片',[doc()],'chat').error);assert.ok(resolveChatMode('画一只猫',[image(),image()],'chat').error);
 assert.equal(resolveChatMode('海边日落',[],'image').mode,'image');assert.ok(resolveChatMode('',[],'image').error);
});
