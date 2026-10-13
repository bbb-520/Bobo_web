# Bobo_web

`BoboWeb` 是 Bobo4J（AgentDemo 后端：Spring Boot WebFlux + Spring AI）的 React / Vite 前端。

浏览器端只使用**同源路径**访问后端：开发、生产环境都通过 Node 服务或 Vite 代理把 `/api/` 转发给 Java 后端，登录 Cookie 与 SSE 流在两个环境下行为一致。

## 附件与会话异常恢复（2026-10-13）

修复上传、文档处理及请求恢复无限等待导致输入框长期不可用的问题：附件准备最多等待 10 分钟、文档上传 XHR 最多 2 分钟、问答等待账户空闲最多 210 秒；单次状态请求最多 60 秒，连续 5 分钟无法同步状态时解除本页等待，正常快照和进度会重新计时。

创建请求尚未返回执行 ID 时，停止按钮也能立即释放本页等待；保留原请求 ID 与停止意图，避免重复创建或迟到响应覆盖新消息。刷新继续按原请求恢复；已上传文档保留重试入口，未上传文件需重新选择。

需要同步升级 Bobo4j 后端的调用组恢复逻辑及 V10 审计迁移。供应商结果未知时不会伪造完成；后端超过执行与回执窗口后解除账户占用，旧调用不自动重发。HTTP 409 通用提示改为记录状态冲突，具体账户占用仍采用服务端实际错误说明。

本次 13 组前端测试脚本和生产构建通过，新增回归覆盖刷新恢复、附件超时、创建结果未知时停止、迟到响应隔离和正常长任务进度。

2026-10-13 已与后端同步部署到 `https://www.boboo.xin/`，公开静态资源校验与测试构建一致。原有 3 组长期挂起请求已解除账户占用，相关账户现金及免费 Token 未变；更新后可用 Ctrl+F5 获取新页面，再重试已上传附件或重新选择尚未上传完成的文件。

最终公开 HTTP 验收 13/13 项通过，覆盖文字、图片、文档和混合问答、幂等重放及额度审计。测试账户结束时没有占用，已禁用并撤销全部会话；刷新、停止及错误等待由前端回归覆盖。

## 功能概览

| 模块 | 说明 |
| --- | --- |
| 对话 | SSE 流式聊天，支持多模型切换、图片理解与图片生成任务状态 |
| Agent 执行 | 可恢复的多步执行：创建 / 查询 / 停止 / 继续，事件流带 `seq` 与 `generationVersion` 去重与换代 |
| 文档问答（RAG） | 上传文档（multipart，≤ 100 MiB）→ 建索引 → 按 chunk 溯源引用，支持文档会话 |
| 账号体系 | 注册 / 密码登录 / 登出、邮箱验证码登录、邮箱绑定、当前用户信息 |
| 计费与支付 | 钱包余额、用量明细、计费事件、支付下单与轮询对账（含 `RESERVED` / `DISPATCHED` / `UNKNOWN` 等状态） |
| 平台管理（RBAC） | 用户列表、角色与权限配置、授权审计，权限变更需填写原因，授予 `SUPER_ADMIN` 需二次校验密码 |
| Bobo World | 3D / 画廊作品浏览与「我的作品」管理（发布、删除） |
| 其它 | 模型密钥管理、图片生成回执（zine）、落地页 / 关于页 / 设置页 / 个人中心 |

## 技术栈

- React 18 + TypeScript 5.6 + Vite 5
- 3D 与动效：three / @react-three/fiber / @react-three/drei、gsap、motion、ogl
- 生产运行时：Node 22（`server.mjs`，纯标准库，零生产依赖）

## 开发

```bash
npm ci
npm run typecheck
```

开发有两种方式：

```bash
npm run dev:vite   # Vite 开发服务器（HMR），127.0.0.1:5173，/api 代理到后端
npm run dev        # Node 静态服务，需先 npm run build，行为与生产一致
```

Vite 开发服务器把 `/api` 代理到 `BACKEND_URL`（默认 `http://localhost:18000`，即后端网关）。SSE 由 `http-proxy` 直接透传，无需额外配置。

## 构建

```bash
npm run build     # tsc -b && vite build
```

构建产物位于 `dist/`。

## 生产运行

### 方式一：Node 服务

`server.mjs` 同时提供静态资源、`/health` 健康检查和 `/api/` 反向代理：

```bash
PORT=5173 BACKEND_URL=http://127.0.0.1:18000 STATIC_DIR=dist node server.mjs
```

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `5173` | 监听端口（绑定 `0.0.0.0`） |
| `BACKEND_URL` | `http://localhost:18000` | 后端网关地址 |
| `STATIC_DIR` | `dist` | 静态资源目录 |

要点：

- 静态资源做路径穿越校验；带哈希的静态文件长缓存，`index.html` 不缓存。
- `/api/` 请求流式转发，`AbortController` 在客户端断开时同步取消上游请求。
- 请求体超过 100 MiB 直接返回 `413`（multipart 额外放宽 1 MiB 头部开销）。

### 方式二：Docker / Compose

```bash
docker compose up --build
```

- `Dockerfile` 为多阶段构建：`node:22-alpine` 构建 `dist/`，运行阶段只拷贝 `dist/`、`server.mjs`、`upload-stream.mjs` 与 `package.json`，以非 root 用户运行，并内置 `/health` 健康检查。
- `docker-compose.yml` 通过 `include` 把后端与基础设施栈（gateway、auth、chat、media、content、orchestrator、rag、nacos 等）合并进同一 Project，一条命令启动完整系统。
- 只有 `agent-gateway`（`GATEWAY_PORT`，默认 `18000`）与 `agent-web`（`WEB_PORT`，默认 `5173`）对外暴露端口，其余服务走 Compose 内网。

### 方式三：Nginx

1. 执行 `npm run build`。
2. 将 `dist/` 内容复制到 `/var/www/AgentWebDemo/`。
3. Nginx 以该目录作为 `root`，并把 `/api/` 代理到后端。

Nginx 必须关闭 `/api/` 的响应缓冲（`proxy_buffering off;`），否则 SSE 会等到整段响应结束才显示内容。

## 接口一览

前端默认 `baseUrl` 为空（同源）。所有写操作都会先请求 `GET /api/auth/csrf` 取得令牌，再以 `X-XSRF-TOKEN` 头提交，并始终携带 `credentials: 'include'`（HttpOnly 登录 Cookie）。

### 认证

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 服务健康检查 |
| `GET` | `/api/auth/csrf` | 获取 CSRF 令牌（响应 `headerName: X-XSRF-TOKEN`） |
| `POST` | `/api/auth/register` | 注册 |
| `POST` | `/api/auth/login` | 登录 |
| `POST` | `/api/auth/logout` | 登出 |
| `GET` | `/api/auth/me` | 当前用户（含角色与权限） |
| `POST` | `/api/auth/email/code` | 发送邮箱验证码 |
| `POST` | `/api/auth/email/login` | 邮箱验证码登录 |
| `POST` | `/api/auth/email/bind` | 绑定邮箱 |

### 对话与 Agent 执行

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/chat` | SSE 流式对话 |
| `POST` | `/api/agent-executions` | 创建执行 |
| `GET` | `/api/agent-executions?requestId=` | 按请求号幂等查询执行 |
| `GET` | `/api/agent-executions/{id}` | 执行快照 |
| `POST` | `/api/agent-executions/{id}/stop` | 停止执行 |
| `POST` | `/api/agent-executions/{id}/resume` | 继续执行（追加轮次 / 指令） |
| `GET` | `/api/agent-executions/{id}/events` | SSE 事件流，`Last-Event-ID: {id}:{seq}` 断点续传 |

事件流使用「事件 + `seq` + `generationVersion`」模型：旧代际事件只推进游标，不覆盖答案与状态，避免重连后内容错乱。

### 文档问答（RAG）

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/documents` | 上传文档（multipart，≤ 100 MiB） |
| `GET` | `/api/documents` | 文档列表 |
| `GET` / `DELETE` | `/api/documents/{id}` | 文档详情 / 删除 |
| `POST` | `/api/documents/{id}/retry` | 重试索引 |
| `GET` | `/api/documents/{id}/summary` | 文档摘要 |
| `GET` | `/api/documents/{id}/sources/{chunkId}` | 溯源片段 |
| `POST` | `/api/document-conversations` | 创建文档会话 |
| `GET` | `/api/document-conversations/{id}` | 文档会话详情 |

### 图片

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/image-assets/upload-policy` | 获取 OSS 直传策略 |
| `POST` | `/api/image-assets/{assetId}/complete` | 确认图片上传 |
| `GET` | `/api/image-jobs?conversationId=` | 会话下的图片任务 |
| `GET` | `/api/image-jobs/{jobId}` | 图片任务详情 |
| `POST` | `/api/zine/generate` | 图片生成（多部分表单） |
| `GET` | `/api/zine/generations` | 生成回执列表 |
| `GET` | `/api/zine/generations/{id}` | 生成回执详情 |

### Bobo World

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/bobo/world` | 世界数据 |
| `GET` / `POST` | `/api/bobo/items` | 作品列表 / 发布作品 |
| `GET` | `/api/bobo/items/mine` | 我的作品 |
| `PATCH` / `DELETE` | `/api/bobo/items/{itemId}` | 更新 / 删除作品 |

### 计费、支付与管理

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/billing/wallet` | 钱包余额 |
| `GET` | `/api/billing/usage?limit=20` | 用量明细 |
| `GET` | `/api/billing/events` | 计费事件 |
| `POST` | `/api/payments/orders` | 创建支付订单 |
| `GET` | `/api/payments/orders/{id}` | 订单状态轮询 |
| `GET` | `/api/settings/models` | 可用模型清单 |
| `GET` / `PUT` / `DELETE` | `/api/settings/keys` | 用户模型密钥管理 |
| `GET` | `/api/admin/users?page=&size=` | 用户分页 |
| `GET` | `/api/admin/roles` | 角色列表 |
| `GET` | `/api/admin/permissions` | 权限目录 |
| `PUT` | `/api/admin/users/{id}/roles` | 授予 / 撤销角色 |
| `PUT` | `/api/admin/users/{id}/status` | 启用 / 禁用用户 |
| `PUT` / `DELETE` | `/api/admin/roles/{code}` | 保存 / 删除角色 |
| `GET` | `/api/admin/audits?page=&size=` | 授权审计 |

错误码与前端提示对应：`401` 登录过期、`402` 余额不足、`403` 权限不足或安全令牌失效、`409` 有请求处理中或待对账。

## 测试

前端逻辑自带 Node 原生测试脚本，通过 `tsx` 与 `--experimental-strip-types` 直接运行 `.tsx` / `.mjs`：

```bash
npm run test:storage
npm run test:proxy-cancellation
npm run test:accounts-billing
npm run test:account-races
npm run test:executions
npm run test:documents
npm run test:rbac
npm run test:payment-recovery
npm run test:image-job-404
npm run test:image-job-reconcile
```

覆盖上传流控与代理取消、账户并发、计费、执行恢复、文档、RBAC 与支付对账等关键路径。

## 安全

- 登录态使用 HttpOnly Cookie，写操作走 CSRF 双提交（`X-XSRF-TOKEN`），`fetch` 统一 `credentials: 'include'`。
- 密钥与凭据不入库：`.env`、`secrets/`、`*.pem`、`.docker-work/` 已在 `.gitignore` 与 `.dockerignore` 中排除；示例见 `.env.example`。
- 管理端敏感操作（授予 `SUPER_ADMIN` 等）要求二次输入密码并填写操作原因，全部写入授权审计。

## 支付稳定性修复（2026-10-12）

充值仅保留支付宝；移除微信入口、类型和示例配置，并拒绝恢复旧微信支付缓存。二维码支持同一订单刷新（`POST /api/payments/orders/{id}/qr`）和绘制失败后的重新绘制；刷新失败保留有效二维码，缺失时明确提示重新获取。订单 `stateVersion` / `qrVersion` 防止旧响应覆盖新状态，刷新页面继续恢复已有订单。

退款超出自动恢复上限时显示“退款待人工核对，请联系管理员”，不再无限显示处理中；真实到账仍由后端确认。2026-10-12 仅提交源码，2026-10-13 附件恢复发布包包含该改动，须配合后端 V9 数据库迁移和 API 一起上线；未执行真实支付。详见 [Bobo4j 支付说明](https://github.com/bbb-520/Bobo4j#支付链路稳定性更新2026-10-12)。
