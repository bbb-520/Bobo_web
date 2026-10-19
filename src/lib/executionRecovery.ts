import type { ExecutionRequest, ExecutionView } from '../api/executions';
import { StoragePersistenceError } from './storage';
export interface ExecutionRecovery { convId:string; msgId:string; request:ExecutionRequest; executionId?:string; lastSeq:number; stopRequested?:boolean; resumeRequest?:{requestId:string;expectedVersion:number;additionalRounds?:number;instruction?:string}; lookupOnly?:boolean; receipt?:ExecutionView; }

type StoragePort = Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const key=(scope:string)=>`bobo.executions.v1.${encodeURIComponent(scope)}`;
export function loadExecutionRecovery(scope:string,storage:StoragePort=localStorage):ExecutionRecovery[] {
  try {
    const items=JSON.parse(storage.getItem(key(scope))??'[]');
    if(!Array.isArray(items))return [];
    const groups=new Map<string,ExecutionRecovery[]>();
    for(const value of items) {
      if(!value||typeof value.convId!=='string'||typeof value.msgId!=='string'||typeof value.request?.requestId!=='string'||!Number.isSafeInteger(value.lastSeq))continue;
      const id=JSON.stringify([value.convId,value.msgId]);
      const entries=groups.get(id)??[];
      const previous=entries.find(entry=>entry.request.requestId===value.request.requestId);
      if(previous) {
        const uncertain=JSON.stringify(previous.request)!==JSON.stringify(value.request)
          || Boolean(previous.executionId&&value.executionId&&previous.executionId!==value.executionId)
          || Boolean(previous.resumeRequest&&value.resumeRequest&&JSON.stringify(previous.resumeRequest)!==JSON.stringify(value.resumeRequest));
        Object.assign(previous,{...value,lastSeq:Math.max(previous.lastSeq,value.lastSeq),
          executionId:value.executionId??previous.executionId,receipt:value.receipt??previous.receipt,
          resumeRequest:value.resumeRequest??previous.resumeRequest,stopRequested:previous.stopRequested===true||value.stopRequested===true,
          lookupOnly:previous.lookupOnly===true||value.lookupOnly===true||uncertain});
      } else entries.push({...value});
      groups.set(id,entries);
    }
    return [...groups.values()].flatMap(entries=>entries.length>1?entries.map(entry=>({...entry,lookupOnly:true})):entries);
  } catch {return [];}
}
export function saveExecutionRecovery(scope:string,items:ExecutionRecovery[],storage:StoragePort=localStorage) {
  try {if(items.length)storage.setItem(key(scope),JSON.stringify(items));else storage.removeItem(key(scope));} catch (cause) {throw new StoragePersistenceError(cause);}
}
