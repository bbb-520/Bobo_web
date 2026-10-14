export interface PromptEntry {
  id:string; title:string; content:string; category:string; source:'gallery'|'visual-memory';
  size?:string; quality?:string; tags?:string[]; author?:string; attribution?:string;
  sourceRepository?:string; sourceFile?:string; sourceCommit?:string; sourceAttribution?:string;
  updatedAt?:string; subjects?:string[]; palette?:string; composition?:string; mood?:string;
  sourceAssetId?:string; variant?:number; contentHash?:string;
}
export interface PromptCategory {id:string;label:string;keywords:string[];}
export interface GalleryCatalog {
  source:{repository:string;commit:string;license:string;attribution:string};
  categories:PromptCategory[];prompts:PromptEntry[];
}
const preferred=['typography-and-posters','photography','isometric','watercolor','retro-and-cyberpunk','product-and-food','anime-and-manga','architecture-and-interior','pixel-art','fashion-editorial','illustration'];
const normalize=(text:string)=>text.normalize('NFKC').toLocaleLowerCase().trim();
/** Spread styles across the opening grid, without inventing popularity metrics. */
function varied(entries:PromptEntry[]):PromptEntry[] {
  const groups=new Map<string,PromptEntry[]>();
  for(const item of entries){const group=groups.get(item.category)??[];group.push(item);groups.set(item.category,group);}
  const keys=[...preferred.filter(key=>groups.has(key)),...[...groups.keys()].filter(key=>!preferred.includes(key))];
  const result:PromptEntry[]=[];
  for(let index=0;result.length<entries.length;index++)for(const key of keys){const item=groups.get(key)?.[index];if(item)result.push(item);}
  return result;
}
export function filterGallery(catalog:GalleryCatalog,query:string,category:string):PromptEntry[] {
  const q=normalize(query),categories=new Map(catalog.categories.map(item=>[item.id,item]));
  const tokens=q.split(/[\s,，、]+/).filter(Boolean);
  const result=varied(catalog.prompts).filter(item=>category==='all'||item.category===category).map((item,index)=>{
    if(!q)return {item,score:1,index};
    const group=categories.get(item.category);
    const text=normalize([item.title,item.content,...(item.tags??[]),group?.label??'',...(group?.keywords??[])].join(' '));
    const keywordMatches=(group?.keywords??[]).filter(word=>word.length>=2&&q.includes(normalize(word))).length;
    const score=text.includes(q)?100:tokens.every(token=>text.includes(token))?60:keywordMatches*10;
    return {item,score,index};
  });
  return result.filter(row=>row.score>0).sort((a,b)=>b.score-a.score||a.index-b.index).map(row=>row.item);
}
export function promptTitle(entry:PromptEntry):string {return entry.title.replace(/^No\.\s*\d+\s*[·:—-]\s*/i,'').trim()||'画面灵感';}
/** Only passive HTTPS images or explicit local cover paths; never protocol-relative URLs. */
export function safeCoverUrl(value:unknown):string|null {
  if(typeof value!=='string'||value.length>4096||/[\u0000-\u0020\\]/.test(value))return null;
  if(value.startsWith('/')) {
    if(value.startsWith('//')||!value.startsWith('/prompt-library/covers/'))return null;
    try {if(decodeURIComponent(value).split('/').some(part=>part==='..'||part==='.'))return null;}catch{return null;}
    return value;
  }
  try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
export async function loadGallery():Promise<GalleryCatalog> {
  const module=await import('../data/prompt-gallery.json');
  const value=module.default as unknown as GalleryCatalog;
  if(!Array.isArray(value.prompts)||!Array.isArray(value.categories)||value.prompts.some(item=>typeof item.id!=='string'||typeof item.content!=='string'||!item.content.trim()))throw Error('提示词目录暂时无法读取，请重试');
  return {...value,prompts:value.prompts.map(item=>({...item,source:'gallery'}))};
}
export async function loadCoverOverrides(signal:AbortSignal):Promise<Record<string,string>> {
  try {
    const response=await fetch('/prompt-library/covers.json',{signal,credentials:'omit'});
    if(!response.ok)return {};
    const value=await response.json();if(!value?.covers||Array.isArray(value.covers)||typeof value.covers!=='object')return {};
    return Object.fromEntries(Object.entries(value.covers).map(([key,url])=>[key,safeCoverUrl(url)]).filter((row):row is [string,string]=>typeof row[1]==='string'));
  }catch{return {};}
}
export async function copyPrompt(entry:PromptEntry):Promise<boolean> {
  try {if(!navigator.clipboard?.writeText)return false;await navigator.clipboard.writeText(entry.content);return true;}catch{return false;}
}
