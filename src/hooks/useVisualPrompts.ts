import { useEffect,useRef,useState } from 'react';
import { fetchVisualPrompts } from '../api/visualPrompts';
import type { PromptEntry } from '../lib/promptLibrary';
interface State {key:string;items:PromptEntry[];cursor:string|null;loading:boolean;error:string;}
export function useVisualPrompts(baseUrl:string,owner:string,query:string) {
  const key=JSON.stringify([baseUrl,owner,query.trim()]);
  const [state,setState]=useState<State>({key,items:[],cursor:null,loading:Boolean(owner),error:''});
  const generation=useRef(0),identity=useRef(key),request=useRef<AbortController|null>(null),pending=useRef<number|null>(null);
  if(identity.current!==key){identity.current=key;generation.current++;}
  const view=state.key===key?state:{key,items:[],cursor:null,loading:Boolean(owner),error:''};
  const latest=useRef(view);latest.current=view;
  const run=async(cursor:string|null,epoch:number)=>{
    if(!owner||identity.current!==key||generation.current!==epoch||pending.current===epoch)return;
    pending.current=epoch;const controller=new AbortController();request.current=controller;
    setState(current=>({...current,key,items:current.key===key?current.items:[],loading:true,error:''}));
    const valid=()=>generation.current===epoch&&identity.current===key&&!controller.signal.aborted;
    try {
      const page=await fetchVisualPrompts(baseUrl,query,cursor,controller.signal);if(!valid())return;
      setState(current=>({key,items:cursor?[...new Map([...current.items,...page.items].map(item=>[item.id,item])).values()]:page.items,cursor:page.nextCursor,loading:false,error:''}));
    }catch(error){if(valid())setState(current=>({...current,key,loading:false,error:error instanceof Error?error.message:'视觉记忆加载失败，请重试'}));}
    finally{if(pending.current===epoch)pending.current=null;}
  };
  useEffect(()=>{
    const epoch=++generation.current;request.current?.abort();pending.current=null;
    setState({key,items:[],cursor:null,loading:Boolean(owner),error:''});
    const timer=window.setTimeout(()=>void run(null,epoch),160);
    return()=>{window.clearTimeout(timer);request.current?.abort();generation.current++;};
    // Stable identity, not an async closure, owns all private state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[key]);
  const loadMore=()=>latest.current.cursor?run(latest.current.cursor,generation.current):Promise.resolve();
  const retry=()=>run(latest.current.items.length?latest.current.cursor:null,generation.current);
  return {items:view.items,loading:view.loading,error:view.error,hasMore:Boolean(view.cursor),loadMore,retry};
}
