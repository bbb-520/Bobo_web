import {useEffect,useRef,useState} from 'react';
import {getMe,hasPermission,type AuthUser} from '../lib/auth';
import {apiRequest,ApiError} from '../lib/http';

type UserRow={id:number;username:string;qq_email:string;status:string;roles:string[]};
type Role={code:string;name:string;status:string;is_system:boolean;permissions:string[]};
type Permission={code:string;name:string;module:string};
type Audit={id:number;actor_id:number|null;target:string;action:string;reason:string;created_at:string;before_value:string;after_value:string};
type Page<T>={items:T[];total:number};
interface Props{user:AuthUser;baseUrl:string;onUser:(user:AuthUser)=>void;}
const labels:Record<string,string>={USER:'普通用户',ADMIN:'管理员',SUPER_ADMIN:'超级管理员'};
export default function AdminPanel({user,baseUrl,onUser}:Props){
  const canRead=hasPermission(user,'user:read');
  const canAssign=hasPermission(user,'role:assign')&&Boolean(user.roles?.includes('SUPER_ADMIN'));
  const canConfigure=hasPermission(user,'role:permission:set')&&Boolean(user.roles?.includes('SUPER_ADMIN'));
  const canAudit=hasPermission(user,'audit:read');
  const canManage=canRead||canConfigure||canAudit;
  const [tab,setTab]=useState<'users'|'roles'|'audit'>(canRead?'users':canConfigure?'roles':'audit');
  const [users,setUsers]=useState<UserRow[]>([]),[roles,setRoles]=useState<Role[]>([]),[permissions,setPermissions]=useState<Permission[]>([]),[audits,setAudits]=useState<Audit[]>([]);
  const [page,setPage]=useState(0),[total,setTotal]=useState(0),[reload,setReload]=useState(0);
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
  const [target,setTarget]=useState<UserRow|null>(null),[roleCode,setRoleCode]=useState('ADMIN'),[grant,setGrant]=useState(true);
  const [reason,setReason]=useState(''),[password,setPassword]=useState('');
  const [draft,setDraft]=useState<Role>({code:'',name:'',status:'ACTIVE',is_system:false,permissions:[]});
  const lifetime=useRef(new AbortController());
  const scope=useRef(`${baseUrl}:${user.userId}:${user.permissions?.join(',')}`);
  scope.current=`${baseUrl}:${user.userId}:${user.permissions?.join(',')}`;
  useEffect(()=>{const controller=new AbortController();lifetime.current=controller;return()=>controller.abort();},[]);
  useEffect(()=>{
    if(!canManage)return;
    const request=new AbortController();setLoading(true);setError('');setUsers([]);setAudits([]);
    const read=async()=>{
      if(tab==='users'&&canRead){
        const data=await apiRequest<Page<UserRow>>(baseUrl,`/api/admin/users?page=${page}&size=20`,{signal:request.signal});
        if(request.signal.aborted)return;setUsers(data.items);setTotal(data.total);
        if(canAssign){const list=await apiRequest<Role[]>(baseUrl,'/api/admin/roles',{signal:request.signal});if(!request.signal.aborted)setRoles(list);}
      }else if(tab==='roles'&&canConfigure){
        const [list,catalog]=await Promise.all([apiRequest<Role[]>(baseUrl,'/api/admin/roles',{signal:request.signal}),apiRequest<Permission[]>(baseUrl,'/api/admin/permissions',{signal:request.signal})]);
        if(!request.signal.aborted){setRoles(list);setPermissions(catalog);}
      }else if(tab==='audit'&&canAudit){
        const data=await apiRequest<Page<Audit>>(baseUrl,`/api/admin/audits?page=${page}&size=20`,{signal:request.signal});
        if(!request.signal.aborted){setAudits(data.items);setTotal(data.total);}
      }
    };
    void read().catch(cause=>{if(!request.signal.aborted)setError(cause instanceof Error?cause.message:'管理数据读取失败');})
      .finally(()=>{if(!request.signal.aborted)setLoading(false);});
    return()=>request.abort();
  },[baseUrl,user.userId,canManage,canRead,canAssign,canConfigure,canAudit,tab,page,reload]);
  async function mutate(path:string,method:string,body:unknown){
    if(busy||!reason.trim())return;
    const at=scope.current;const signal=lifetime.current.signal;setBusy(true);setError('');setMessage('');
    try{
      await apiRequest(baseUrl,path,{method,body:JSON.stringify(body),signal});
      if(signal.aborted||scope.current!==at)return;
      setPassword('');setReason('');setTarget(null);setMessage('变更已保存，新的权限从下一次请求生效。');
      const next=await getMe(baseUrl,signal);
      if(signal.aborted||scope.current!==at)return;
      onUser(next);setReload(n=>n+1);
    }catch(cause){if(!signal.aborted&&scope.current===at){setPassword('');setError(cause instanceof Error?cause.message:'变更失败');
      if(cause instanceof ApiError&&[401,403].includes(cause.status))void getMe(baseUrl,signal).then(next=>{if(!signal.aborted&&scope.current===at)onUser(next);}).catch(()=>{});
    }}finally{if(!signal.aborted&&scope.current===at)setBusy(false);}
  }
  if(!canManage)return null;
  const changeTab=(next:typeof tab)=>{setTab(next);setPage(0);setTarget(null);setError('');setMessage('');setPassword('');};
  const refresh=async()=>{
    const at=scope.current,signal=lifetime.current.signal;
    try{const next=await getMe(baseUrl,signal);if(!signal.aborted&&scope.current===at){onUser(next);setReload(n=>n+1);}}
    catch(cause){if(!signal.aborted&&scope.current===at)setError(cause instanceof Error?cause.message:'权限刷新失败');}
  };
  return <section className="account-section admin-panel" aria-labelledby="admin-title">
    <div className="account-section-heading"><h3 id="admin-title">平台管理</h3><button className="btn-ghost" disabled={busy} onClick={()=>void refresh()}>刷新权限与数据</button></div>
    <p className="hint">当前角色：{user.roles?.map(r=>labels[r]??r).join('、')||'未分配'}</p>
    <nav className="admin-tabs" aria-label="管理功能">
      {canRead&&<button disabled={busy} aria-pressed={tab==='users'} onClick={()=>changeTab('users')}>用户</button>}
      {canConfigure&&<button disabled={busy} aria-pressed={tab==='roles'} onClick={()=>changeTab('roles')}>角色与权限</button>}
      {canAudit&&<button disabled={busy} aria-pressed={tab==='audit'} onClick={()=>changeTab('audit')}>授权审计</button>}
    </nav>
    {error&&<p className="setup-error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {loading&&<p role="status">正在读取管理数据…</p>}
    {tab==='users'&&canRead&&<>
      <div className="admin-table-scroll"><table><thead><tr><th>用户</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody>
        {users.map(row=><tr key={row.id}><td><strong>{row.username}</strong><small>{row.qq_email||'未绑定邮箱'}</small></td><td>{row.roles.map(r=>labels[r]??r).join('、')||'无角色'}</td><td>{row.status==='ACTIVE'?'正常':'已禁用'}</td><td>
          {canAssign&&<button className="btn-ghost" disabled={busy} onClick={()=>{setTarget(row);setRoleCode('ADMIN');setGrant(true);setPassword('');}}>分配角色</button>}
          {hasPermission(user,'user:disable')&&(!row.roles.includes('SUPER_ADMIN')||canAssign)&&<button className="btn-ghost" disabled={busy} onClick={()=>{setTarget(row);setRoleCode('');setPassword('');}}>{row.status==='ACTIVE'?'禁用':'启用'}</button>}
        </td></tr>)}
      </tbody></table></div>
      {!loading&&users.length===0&&<p className="hint">暂无用户。</p>}
      {target&&<form className="admin-editor" onSubmit={e=>{e.preventDefault();void mutate(`/api/admin/users/${target.id}/${roleCode?'roles':'status'}`,'PUT',roleCode?{role:roleCode,grant,reason,password}:{status:target.status==='ACTIVE'?'DISABLED':'ACTIVE',reason});}}>
        <h4>{roleCode?'调整角色':'调整状态'}：{target.username} · {target.qq_email}</h4>
        {roleCode&&<><label>角色<select value={roleCode} onChange={e=>{setRoleCode(e.target.value);setPassword('');}}>{roles.map(r=><option key={r.code} value={r.code}>{r.name}（{r.code}）</option>)}</select></label>
          <label>操作<select value={grant?'grant':'revoke'} onChange={e=>{setGrant(e.target.value==='grant');setPassword('');}}><option value="grant">授予角色</option><option value="revoke">撤销角色</option></select></label>
          {roleCode==='SUPER_ADMIN'&&grant&&<label>再次输入当前账号密码<input type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/></label>}
        </>}
        <label>操作原因<input required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
        <div className="admin-actions"><button type="submit" disabled={busy||!reason.trim()}>{busy?'保存中…':'确认变更'}</button><button type="button" disabled={busy} onClick={()=>{setTarget(null);setPassword('');}}>取消</button></div>
      </form>}
    </>}
    {tab==='roles'&&canConfigure&&<>
      <div className="admin-role-list">{roles.map(role=><button disabled={busy} key={role.code} onClick={()=>setDraft({...role,permissions:[...role.permissions]})}>{role.name}<small>{role.code}{role.is_system?' · 内置':''}</small></button>)}<button disabled={busy} onClick={()=>setDraft({code:'',name:'',status:'ACTIVE',is_system:false,permissions:[]})}>新增角色</button></div>
      <form className="admin-editor" onSubmit={e=>{e.preventDefault();void mutate(`/api/admin/roles/${encodeURIComponent(draft.code)}`,'PUT',{name:draft.name,status:draft.status,permissions:draft.permissions,reason});}}>
        <h4>{draft.is_system?'内置角色权限':'编辑自定义角色'}</h4>
        {draft.is_system&&<p className="hint">内置角色的职责固定。可创建自定义角色组合业务和运营权限。</p>}
        <label>角色编码<input required pattern="[A-Z][A-Z0-9_]{2,63}" placeholder="例如 SUPPORT" disabled={draft.is_system||busy} value={draft.code} onChange={e=>setDraft({...draft,code:e.target.value.toUpperCase()})}/></label>
        <label>角色名称<input required maxLength={128} disabled={draft.is_system||busy} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
        <label>状态<select disabled={draft.is_system||busy} value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value})}><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select></label>
        <fieldset disabled={draft.is_system||busy}><legend>权限</legend><div className="admin-permissions">{permissions.map(p=><label key={p.code}><input type="checkbox" disabled={p.code==='role:assign'||p.code==='role:permission:set'} checked={draft.permissions.includes(p.code)} onChange={e=>setDraft({...draft,permissions:e.target.checked?[...draft.permissions,p.code]:draft.permissions.filter(v=>v!==p.code)})}/><span>{p.name}<small>{p.code}</small></span></label>)}</div></fieldset>
        {!draft.is_system&&<><label>操作原因<input required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="admin-actions"><button disabled={busy||!reason.trim()} type="submit">保存角色与权限</button>{roles.some(r=>r.code===draft.code)&&<button type="button" disabled={busy||!reason.trim()} onClick={()=>void mutate(`/api/admin/roles/${encodeURIComponent(draft.code)}`,'DELETE',{reason})}>删除角色并撤销其授权</button>}</div></>}
      </form>
    </>}
    {tab==='audit'&&canAudit&&<div className="admin-audits">{audits.map(a=><details key={a.id}><summary>{a.action} · 目标 {a.target}<small>{a.created_at} · 操作人 {a.actor_id??'初始化工具'}</small></summary><p>{a.reason}</p><p>变更前：{a.before_value||'无'}</p><p>变更后：{a.after_value||'无'}</p></details>)}{!loading&&!audits.length&&<p className="hint">暂无授权变更记录。</p>}</div>}
    {tab!=='roles'&&<div className="admin-pagination"><button disabled={page===0||busy||loading} onClick={()=>setPage(p=>p-1)}>上一页</button><span>第 {page+1} 页 · 共 {total} 条</span><button disabled={(page+1)*20>=total||busy||loading} onClick={()=>setPage(p=>p+1)}>下一页</button></div>}
  </section>;
}
