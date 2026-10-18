import { expect,test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mockBackend } from './mock-backend';

test('prompt library preserves unsent chat and files, copies full catalog text and never generates',async({page,context})=>{
 const backend=await mockBackend(page);await context.grantPermissions(['clipboard-read','clipboard-write']);
 await page.addInitScript(()=>{const write=navigator.clipboard.writeText.bind(navigator.clipboard);navigator.clipboard.writeText=async value=>{(window as any).__copiedPrompt=value;await write(value);};});
 await page.goto('/#chat');await expect(page.getByText('Smoke User',{exact:true}).first()).toBeVisible();
 await page.getByRole('textbox',{name:'消息输入框'}).fill('还没有发送的灵感');
 await page.locator('input[type=file]').setInputFiles({name:'灵感.txt',mimeType:'text/plain',buffer:Buffer.from('keep this attachment')});
 await page.getByRole('menuitem',{name:'提示词',exact:true}).first().click();
 await expect(page.getByRole('heading',{name:'提示词',exact:true})).toBeVisible();
 await expect(page.locator('.prompt-card')).toHaveCount(24);
 await page.locator('.prompt-card').first().click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 const catalog=JSON.parse(readFileSync(new URL('../src/data/prompt-gallery.json',import.meta.url),'utf8'));
 const id=await dialog.getAttribute('data-prompt-id');const original=catalog.prompts.find((item:any)=>item.id===id).content;
 expect(await page.evaluate(()=>document.elementFromPoint(innerWidth-30,25)?.classList.contains('prompt-detail-backdrop'))).toBe(true);
 await dialog.getByRole('button',{name:'复制提示词',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'已复制',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__copiedPrompt)).toBe(original);
 // The Windows clipboard normalizes LF to CRLF; the application submits exact LF text.
 expect((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n')).toBe(original);
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 await page.getByRole('button',{name:'返回聊天',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'消息输入框'})).toHaveValue('还没有发送的灵感');
 await expect(page.getByRole('button',{name:'移除附件 灵感.txt'})).toBeVisible();
 expect(backend.calls.filter(call=>call.method==='POST')).toHaveLength(0);expect(backend.unexpected).toEqual([]);
});

test('gallery search, all categories and paging work without model or outside requests',async({page})=>{
 const backend=await mockBackend(page);await page.goto('/#prompts');
 await expect(page.locator('.prompt-card')).toHaveCount(24);
 await page.getByRole('button',{name:'加载更多',exact:true}).click();await expect(page.locator('.prompt-card')).toHaveCount(48);
 await page.getByRole('combobox',{name:'全部分类'}).selectOption('photography');
 expect(await page.locator('.prompt-card').count()).toBeGreaterThan(0);
 expect(await page.locator('.prompt-card').evaluateAll(cards=>cards.every(card=>card.getAttribute('data-category')==='photography'))).toBe(true);
 await page.getByRole('searchbox',{name:'搜索提示词'}).fill('a-phrase-that-does-not-exist-314159');
 await expect(page.getByRole('heading',{name:'没有找到相关提示词'})).toBeVisible();
 await page.getByRole('button',{name:'清空筛选'}).click();await expect(page.locator('.prompt-card')).toHaveCount(24);
 await page.screenshot({path:'../screenshots/gallery-desktop.png'});
 await page.getByRole('tab',{name:'我的视觉记忆',exact:true}).click();
 await expect(page.getByRole('alert')).toBeVisible();
 // A new private API is deliberately blocked by the generic backend fixture.
 expect(backend.unexpected).toEqual(['GET /api/settings/visual-memory/prompts']);
 expect(backend.calls.filter(call=>call.method==='POST')).toHaveLength(0);
});

test('private memory retries and paginates with cursor, and details copy the real content',async({page,context})=>{
 const backend=await mockBackend(page);await context.grantPermissions(['clipboard-read','clipboard-write']);
 const calls:URL[]=[];let fail=true;
 await page.route('**/api/settings/visual-memory/prompts?*',route=>{
  const url=new URL(route.request().url());calls.push(url);
  if(fail){fail=false;return route.fulfill({status:503,json:{message:'memory is temporarily offline'}});}
  const second=url.searchParams.has('cursor');
  return route.fulfill({json:{items:[{id:second?'memory:2':'memory:1',title:second?'雨后街道':'夜色霓虹',content:second?'用户原文第二段':'真实记忆\n用户指令：保留雨后的霓虹',category:'visual-memory',source:'visual-memory',subjects:['雨后'],updatedAt:'2026-10-14T12:00:00'}],nextCursor:second?null:'owned-next'}});
 });
 await page.goto('/#prompts');await page.getByRole('tab',{name:'我的视觉记忆',exact:true}).click();
 await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('button',{name:'重试加载'}).click();
 await expect(page.locator('.prompt-card')).toHaveCount(1);await page.getByRole('button',{name:'加载更多',exact:true}).click();
 await expect(page.locator('.prompt-card')).toHaveCount(2);expect(calls[2].searchParams.get('cursor')).toBe('owned-next');
 expect(calls.every(url=>!url.searchParams.has('owner')&&!url.searchParams.has('userId'))).toBe(true);
 await page.getByRole('button',{name:'查看 夜色霓虹',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('真实记忆\n用户指令：保留雨后的霓虹');
 await page.getByRole('button',{name:'复制提示词',exact:true}).click();
 expect((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n')).toBe('真实记忆\n用户指令：保留雨后的霓虹');
 expect(backend.unexpected).toEqual([]);expect(backend.calls.filter(call=>call.method==='POST')).toHaveLength(0);
});

test('mobile dark gallery and long detail remain within the screen, browser back preserves draft',async({page})=>{
 const backend=await mockBackend(page);await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>localStorage.setItem('bobo.settings.v2',JSON.stringify({theme:'dark',baseUrl:''})));
 await page.goto('/#chat');await page.getByRole('textbox',{name:'消息输入框'}).fill('手机草稿');
 await page.locator('.topbar .mobile-menu-button').click();await page.getByRole('menuitem',{name:'提示词',exact:true}).click();
 await expect(page.locator('.prompt-card')).toHaveCount(24);
 expect(await page.locator('.prompt-library').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:'../screenshots/gallery-mobile-dark.png'});
 await page.locator('.prompt-card-open').first().click();await expect(page.getByRole('dialog')).toBeVisible();
 expect(await page.getByRole('dialog').evaluate(el=>{const r=el.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight;})).toBe(true);
 await expect(page.getByRole('button',{name:'复制提示词',exact:true})).toBeInViewport();
 await page.screenshot({path:'../screenshots/detail-mobile-dark.png'});
 await page.keyboard.press('Escape');await page.goBack();
 await expect(page.getByRole('textbox',{name:'消息输入框'})).toHaveValue('手机草稿');await page.goForward();
 await expect(page.getByRole('heading',{name:'提示词',exact:true})).toBeVisible();
 expect(backend.unexpected).toEqual([]);
});

test('anonymous library never fetches memory and typing from the home entry does not navigate away',async({page})=>{
 const backend=await mockBackend(page);await page.route('**/api/auth/me',route=>route.fulfill({status:401,json:{message:'not signed in'}}));
 await page.goto('/');await page.getByRole('menuitem',{name:'提示词',exact:true}).first().click();
 await page.getByRole('searchbox',{name:'搜索提示词'}).fill('水彩');
 await expect(page.getByRole('heading',{name:'提示词',exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'我的视觉记忆',exact:true}).click();
 await expect(page.getByRole('button',{name:'登录后查看'})).toBeVisible();
 await page.getByRole('button',{name:'登录后查看'}).click();await expect(page.locator('.setup-backdrop')).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.locator('.setup-backdrop')).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'提示词',exact:true})).toBeVisible();
 expect(backend.calls.some(call=>call.path.includes('visual-memory'))).toBe(false);
 expect(backend.unexpected).toEqual([]);
});
