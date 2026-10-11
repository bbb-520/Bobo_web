import { applyExecutionEvent, ExecutionApiError, isExecutionActive, mergeExecutionSnapshot, type ExecutionEvent, type ExecutionView } from '../api/executions';
export const reconnectDelay=(attempt:number)=>Math.min(15000,500*2**Math.min(attempt,5));
export async function cancellableDelay(ms:number,signal:AbortSignal) {
  if(signal.aborted)return;
  await new Promise<void>(resolve=>{const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};const timer=setTimeout(finish,ms);signal.addEventListener('abort',finish,{once:true});});
}
export async function observeExecution(initial:ExecutionView,options:{
  api:{get:(id:string,signal?:AbortSignal)=>Promise<ExecutionView>;subscribe:(id:string,lastSeq:number,signal:AbortSignal,onEvent:(event:ExecutionEvent)=>void)=>Promise<void>};
  signal:AbortSignal;onSnapshot:(value:ExecutionView)=>void;onConnection?:(message:string)=>void;wait?:(ms:number,signal:AbortSignal)=>Promise<void>;snapshotPollMs?:number;
}) {
  let state=initial,attempt=0;
  const publish=(value:ExecutionView)=>{if(!options.signal.aborted){state=value;options.onSnapshot(state);}};
  while(!options.signal.aborted) {
    try {
      publish(mergeExecutionSnapshot(state,await options.api.get(state.executionId,options.signal)));
      if(options.signal.aborted||!isExecutionActive(state))return state;
      options.onConnection?.('');
      const subscription=new AbortController();
      const abortSubscription=()=>subscription.abort();
      options.signal.addEventListener('abort',abortSubscription,{once:true});
      let polling=false,fatal:unknown;
      const timer=setInterval(()=>{
        if(polling||subscription.signal.aborted)return;
        polling=true;
        void options.api.get(state.executionId,subscription.signal).then(snapshot=>{
          publish(mergeExecutionSnapshot(state,snapshot));
          if(!isExecutionActive(state))subscription.abort();
        }).catch(error=>{
          if(error instanceof ExecutionApiError&&[401,403,404].includes(error.status)){fatal=error;subscription.abort();}
        }).finally(()=>{polling=false;});
      },options.snapshotPollMs??4000);
      try {
        await options.api.subscribe(state.executionId,state.lastSeq,subscription.signal,event=>{
          if(event.seq>state.lastSeq+1)throw new Error('事件序号缺失，正在同步最新状态');
          publish(applyExecutionEvent(state,event));attempt=0;
          if(!isExecutionActive(state))subscription.abort();
        });
      } catch(error) {if(!subscription.signal.aborted)throw error;}
      finally {clearInterval(timer);subscription.abort();options.signal.removeEventListener('abort',abortSubscription);}
      if(fatal)throw fatal;
      if(!isExecutionActive(state)) {
        // Event payloads carry status; the snapshot owns counters and optimistic version.
        publish(mergeExecutionSnapshot(state,await options.api.get(state.executionId,options.signal)));
        if(!isExecutionActive(state))return state;
      }
    } catch(error) {
      if(options.signal.aborted)return state;
      if(error instanceof ExecutionApiError&&[401,403,404].includes(error.status))throw error;
    }
    if(options.signal.aborted)return state;
    options.onConnection?.('连接中断，正在恢复。任务仍在后台运行。');
    await (options.wait??cancellableDelay)(reconnectDelay(attempt++),options.signal);
  }
  return state;
}
