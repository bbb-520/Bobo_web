// Local browser-test fixture; it never contacts a payment provider or model.
import { createServer } from 'node:http';
let loggedIn=false;
let wallet={balanceMicros:0,reservedMicros:0,freeImages:0,freeTokens:1000000,arrears:false,lowBalance:false,blocked:false,activeUsageId:null};
const user={userId:'11111111-1111-3111-8111-111111111111',username:'alice',emailBound:true,qqEmail:'123456@qq.com'};
const events=new Set();const orders=new Map();const receipts=new Map();const executions=new Map();const usage=[];
const emit=()=>{for(const response of events)response.write('event: balance\ndata: '+JSON.stringify(wallet)+'\n\n');};
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/api/billing/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});events.add(res);emit();req.on('close',()=>events.delete(res));return;}
 if(url.pathname==='/api/auth/me')return json(res,loggedIn?200:401,loggedIn?user:{message:'未登录'});
 if(url.pathname==='/api/auth/login'||url.pathname==='/api/auth/email/login'){loggedIn=true;return json(res,200,user);}
 if(url.pathname==='/api/auth/logout'){loggedIn=false;res.writeHead(204);return res.end();}
 if(url.pathname==='/api/auth/register')return json(res,200,{userId:user.userId});
 if(url.pathname==='/api/auth/email/code')return json(res,200,{sent:true,resendAfter:60,expiresIn:300});
 if(url.pathname==='/api/auth/email/bind')return json(res,200,{qqEmail:user.qqEmail,emailBound:true});
 if(url.pathname==='/api/billing/wallet')return json(res,200,wallet);
 if(url.pathname==='/api/billing/usage')return json(res,200,usage);
 if(url.pathname==='/api/settings/models')return json(res,200,[{provider:'QWEN',capability:'IMAGE',model:'qwen-image-3.0-pro',enabled:true},{provider:'QWEN',capability:'CHAT',model:'qwen-turbo',enabled:true}]);
 if(url.pathname==='/api/bobo/items/mine')return json(res,200,{items:[],nextCursor:null,publicCount:0});
 if(url.pathname==='/api/image-jobs')return json(res,200,[]);
 if(url.pathname==='/api/payments/orders'&&req.method==='POST'){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());
   const key=req.headers['idempotency-key'];let order=orders.get(key);
   if(!order){order={id:'fixture-order-'+orders.size,channel:body.channel,amountCents:body.amountCents,status:'PENDING',qrCode:'weixin://wxpay/bizpayurl?pr=fixture',expiresAt:new Date(Date.now()+1800000).toISOString(),checks:0};orders.set(key,order);}
   return json(res,200,order);
 }
 if(url.pathname.startsWith('/api/payments/orders/')){
   const order=[...orders.values()].find(o=>o.id===url.pathname.split('/').pop());if(!order)return json(res,404,{message:'订单不存在'});
   order.checks++;if(order.checks>=3&&order.status!=='PAID'){order.status='PAID';wallet={...wallet,balanceMicros:wallet.balanceMicros+order.amountCents*10000,arrears:false,blocked:false,lowBalance:false};emit();}
   return json(res,200,order);
 }
 if(url.pathname==='/api/zine/generate'){
   for await(const chunk of req){ /* discard only the synthetic upload */ }
   if(wallet.arrears||wallet.balanceMicros<0||wallet.freeImages===0&&wallet.balanceMicros<=0)return json(res,402,{message:'图片创作需要充值，欠费时无法交互'});
   const id='zine:fixture-'+receipts.size;const result={requestId:id,result:{mode:'gathered',model:'qwen-image',imageUrl:'http://127.0.0.1:5198/api/fixture/image.svg',rationale:'测试创作结果',inputTokens:null,outputTokens:null,providerRequestId:'fixture'}};
   receipts.set(id,result);wallet={...wallet,freeImages:Math.max(0,wallet.freeImages-1),balanceMicros:wallet.balanceMicros-(wallet.freeImages>0?0:1000000)};emit();return json(res,200,result);
 }
 if(url.pathname==='/api/zine/generations')return json(res,200,[...receipts.keys()]);
 if(url.pathname.startsWith('/api/zine/generations/'))return json(res,200,receipts.get(decodeURIComponent(url.pathname.split('/').pop())));
 if(url.pathname==='/api/fixture/image.svg'){res.writeHead(200,{'Content-Type':'image/svg+xml'});return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="440"><rect width="640" height="440" fill="#ededf0"/><circle cx="320" cy="220" r="120" fill="#44444a"/><text x="320" y="395" text-anchor="middle" font-size="25" fill="#17171a">Bobo browser test</text></svg>');}
 if(url.pathname==='/api/fixture/low'){wallet={...wallet,freeTokens:100000,lowBalance:true};emit();return json(res,200,wallet);}
 if(url.pathname==='/api/fixture/debt'){wallet={...wallet,balanceMicros:-1000,freeImages:0,arrears:true,blocked:true,lowBalance:true};emit();return json(res,200,wallet);}
 if(url.pathname==='/api/agent-executions'&&req.method==='POST'){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const request=JSON.parse(Buffer.concat(chunks).toString());
   if(wallet.arrears||wallet.balanceMicros<0)return json(res,402,{message:'账户已欠费，请充值后继续'});
   if(wallet.freeTokens===0&&wallet.balanceMicros<=0)return json(res,402,{message:'免费额度已用完，请充值'});
   const used=Math.min(wallet.freeTokens,1000);wallet={...wallet,freeTokens:wallet.freeTokens-used,balanceMicros:wallet.balanceMicros-(1000-used)*10,lowBalance:wallet.freeTokens-used<=100000};emit();
   const execution={executionId:'fixture-'+Date.now(),requestId:request.requestId,type:request.type,status:'COMPLETED',version:1,lastSeq:0,question:request.question,answer:'这是使用免费 Token 的模拟回复。',sources:[],error:null,roundsUsed:1,roundLimit:4,tokensUsed:1000,toolCalls:0};
   executions.set(execution.executionId,execution);usage.unshift({id:execution.executionId,model:'qwen-turbo',capability:'CHAT',status:'SUCCEEDED',inputTokens:800,outputTokens:200,metering:'TOKEN',chargedMicros:(1000-used)*10,trial:used>0,createdAt:new Date().toISOString()});
   return json(res,200,execution);
 }
 if(url.pathname.startsWith('/api/agent-executions/')&&req.method==='GET'){
   const execution=executions.get(url.pathname.split('/').pop());return json(res,execution?200:404,execution??{message:'执行不存在'});
 }
 return json(res,404,{message:'Fixture path not found'});
}).listen(Number(process.env.FIXTURE_PORT??5199),'127.0.0.1',()=>console.log('Account test fixture on 127.0.0.1:'+(process.env.FIXTURE_PORT??5199)));
