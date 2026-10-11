import type { ExecutionRequest } from '../api/executions';
export interface ExecutionRecovery { convId:string; msgId:string; request:ExecutionRequest; executionId?:string; lastSeq:number; stopRequested?:boolean; resumeRequest?:{requestId:string;expectedVersion:number;additionalRounds?:number;instruction?:string}; }
type StoragePort = Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const key=(scope:string)=>`bobo.executions.v1.${encodeURIComponent(scope)}`;
export function loadExecutionRecovery(scope:string,storage:StoragePort=localStorage):ExecutionRecovery[] {
  try { const items=JSON.parse(storage.getItem(key(scope))??'[]'); return Array.isArray(items)?items.filter(value=>typeof value.convId==='string'&&typeof value.msgId==='string'&&typeof value.request?.requestId==='string'&&Number.isSafeInteger(value.lastSeq)):[]; } catch {return [];}
}
export function saveExecutionRecovery(scope:string,items:ExecutionRecovery[],storage:StoragePort=localStorage) {
  try {if(items.length)storage.setItem(key(scope),JSON.stringify(items));else storage.removeItem(key(scope));} catch { /* Snapshot persistence still works when browser storage is unavailable. */ }
}
