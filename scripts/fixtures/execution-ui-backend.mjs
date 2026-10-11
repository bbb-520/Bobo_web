// Disposable local browser fixture. No model, payment, account service or external network is contacted.
import {createServer} from 'node:http';
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
const source={id:'s1',documentId:'d1',chunkId:'tail-1',title:'年度报告.txt',page:null,excerpt:'报告尾部：2026 年目标为 42 个项目。'};
const documents=[{documentId:'d1',filename:'年度报告.txt',status:'READY',indexStatus:'READY',summaryStatus:'COMPLETED',chunkCount:12,completedChunks:12,error:null,indexVersion:1,updatedAt:new Date().toISOString()}];
const executions=new Map(),events=new Map(),subscribers=new Map(),timers=new Map(),calls=[];
const wallet={balanceMicros:10000000,reservedMicros:0,freeImages:2,arrears:false,lowBalance:false,blocked:false,activeUsageId:null};
function emit(view,type,payload){const event={executionId:view.executionId,seq:++view.lastSeq,type,generationVersion:view.version,payload};events.get(view.executionId).push(event);for(const res of subscribers.get(view.executionId)??[])res.write(`id: ${view.executionId}:${event.seq}\nevent: ${type}\ndata: ${JSON.stringify(event)}\n\n`);}
function finish(view){view.answer='报告尾部的目标为 **42 个项目**。[1]';view.sources=[source];view.roundsUsed=2;view.tokensUsed=123;emit(view,'fallback_started',{message:'正在切换备用模型',model:'fixture-fallback'});emit(view,'answer_replace',{text:view.answer});emit(view,'answer_committed',{text:view.answer,sources:view.sources,evaluation:'PASSED'});view.status='COMPLETED';emit(view,'status',{status:'COMPLETED'});for(const res of subscribers.get(view.executionId)??[])res.end();}
createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');const path=url.pathname;calls.push({method:req.method,path,cursor:req.headers['last-event-id']});
 if(path==='/api/auth/me')return json(res,200,{userId:'fixture-reader',username:'阅读测试',emailBound:true});
 if(path==='/api/billing/wallet')return json(res,200,wallet);
 if(path==='/api/billing/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(`event: balance\ndata: ${JSON.stringify(wallet)}\n\n`);return;}
 if(path==='/api/image-jobs')return json(res,200,[]);
 if(path==='/api/documents'&&req.method==='POST'){let name='上传文档.txt';let first=true;for await(const chunk of req){if(first){name=/filename="([^"]+)"/.exec(chunk.toString())?.[1]??name;first=false;}}const doc={...documents[0],documentId:'d'+(documents.length+1),filename:name};documents.push(doc);return json(res,202,doc);}
 if(path==='/api/documents')return json(res,200,documents);
 if(path.match(/^\/api\/documents\/[^/]+\/summary$/))return json(res,200,{status:'COMPLETED',text:'全文概要：前 11 个章节介绍项目背景，末尾说明下一年的目标为 42 个项目。',coverage:{completed:12,total:12,ratio:1}});
 if(path.includes('/sources/'))return json(res,200,source);
 if(path==='/api/document-conversations'&&req.method==='POST'){let data='';for await(const chunk of req)data+=chunk;return json(res,200,{conversationId:'dc1',documentIds:JSON.parse(data).documentIds,indexVersions:{d1:1}});}
 if(path==='/api/document-conversations/dc1')return json(res,200,{conversationId:'dc1',documentIds:['d1'],indexVersions:{d1:1},history:[]});
 if(path==='/api/agent-executions'&&req.method==='POST'){
  let data='';for await(const chunk of req)data+=chunk;const body=JSON.parse(data);let view=[...executions.values()].find(v=>v.requestId===body.requestId);
  if(!view){view={executionId:'e'+(executions.size+1),requestId:body.requestId,type:body.type,status:'RUNNING',version:1,lastSeq:0,question:body.question,answer:'',sources:[],error:null,roundsUsed:0,roundLimit:4,tokensUsed:0,toolCalls:0};executions.set(view.executionId,view);events.set(view.executionId,[]);emit(view,'progress',{stage:'retrieval',message:'正在查找文档尾部'});timers.set(view.executionId,setTimeout(()=>finish(view),body.question.includes('停止')?20000:2500));}
  return json(res,202,view);
 }
 if(path==='/api/agent-executions'){const view=[...executions.values()].find(v=>v.requestId===url.searchParams.get('requestId'));return json(res,view?200:404,view??{message:'没有执行'});}
 const match=/^\/api\/agent-executions\/([^/]+)(?:\/(events|stop|resume))?$/.exec(path);
 if(match){const view=executions.get(match[1]);if(!view)return json(res,404,{message:'执行不存在'});
  if(match[2]==='events'){res.writeHead(200,{'Content-Type':'text/event-stream'});const after=Number(req.headers['last-event-id']?.split(':').at(-1)??0);for(const e of events.get(view.executionId).filter(e=>e.seq>after))res.write(`id: ${view.executionId}:${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);if(view.status==='RUNNING'){if(!subscribers.has(view.executionId))subscribers.set(view.executionId,new Set());subscribers.get(view.executionId).add(res);res.once('close',()=>subscribers.get(view.executionId).delete(res));}else res.end();return;}
  if(match[2]==='stop'){clearTimeout(timers.get(view.executionId));view.status='STOPPED';emit(view,'status',{status:'STOPPED'});for(const listener of subscribers.get(view.executionId)??[])listener.end();return json(res,200,view);}
  if(match[2]==='resume'){for await(const _ of req){}view.version++;view.status='RUNNING';emit(view,'answer_replace',{text:''});timers.set(view.executionId,setTimeout(()=>finish(view),2000));return json(res,202,view);}
  return json(res,200,view);
 }
 if(path==='/api/fixture/calls')return json(res,200,calls);
 return json(res,404,{message:'Local UI fixture path not found'});
}).listen(5299,'127.0.0.1',()=>console.log('Execution UI fixture listening on 5299'));
