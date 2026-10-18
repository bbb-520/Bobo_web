import { expect,test } from '@playwright/test';
import { mockBackend } from './mock-backend';

test('real sidebar starts at twenty and load earlier appends bounded pages',async({page})=>{
  const backend=await mockBackend(page);
  const snapshots=Array.from({length:45},(_,index)=>({id:`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`,title:`历史会话 ${index+1}`,createdAt:1,updatedAt:Date.now()-index*1000,messages:[]}));
  let pages=0,reads=0;
  await page.route('**/api/conversations**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.pathname==='/api/conversations') {
      expect(url.searchParams.get('recent')).toBe('true');expect(url.searchParams.get('limit')).toBe('20');pages++;
      const offset=Number(url.searchParams.get('cursor')??0);
      return route.fulfill({json:{items:snapshots.slice(offset,offset+20).map(snapshot=>({id:snapshot.id,revision:1,deleted:false})),nextCursor:offset+20<45?String(offset+20):null}});
    }
    const id=url.pathname.split('/').at(-1)!,snapshot=snapshots.find(item=>item.id===id);
    if(request.method()==='GET'){reads++;return route.fulfill({json:{id,revision:1,deleted:false,snapshot}});}
    const write=request.postDataJSON();return route.fulfill({json:{...write,id,revision:write.expectedRevision+1}});
  });
  await page.goto('/#chat');
  await expect(page.locator('.sb-item')).toHaveCount(20);
  expect(pages).toBe(1);expect(reads).toBe(20);
  await page.getByRole('button',{name:'加载更早会话',exact:true}).click();
  await expect(page.locator('.sb-item')).toHaveCount(40);
  await page.getByRole('button',{name:'加载更早会话',exact:true}).click();
  await expect(page.locator('.sb-item')).toHaveCount(45);
  await expect(page.getByRole('button',{name:'加载更早会话',exact:true})).toHaveCount(0);
  expect(pages).toBe(3);expect(reads).toBe(45);expect(backend.unexpected).toEqual([]);
});
