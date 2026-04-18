# Local Production Deploy (Single Machine)

适用场景：你现在要在本机常驻服务，先支持 2-3 个用户真实试用，并保证用户记忆、聊天记录、关系连续性可长期持久化。

这份方案是“单机生产化基线”，不是多机高可用集群。

## 1. What this mode solves

- 独立用户身份（`legacy_jwt` 或 `clerk`）
- 用户级持久化（Postgres）
- 对话链路常驻（app + redis + postgres）
- 可被 Tunnel/反代安全暴露（默认只监听 127.0.0.1）

## 2. Prerequisites

- Docker + Docker Compose 可用
- 已创建 `.env`
- 已填关键变量（至少）：
  - `key`
  - `base_url`
  - `model`
  - `POSTGRES_PASSWORD`

认证配置必须二选一：
- `REMI_AUTH_MODE=legacy_jwt` + `JWT_SECRET`
- `REMI_AUTH_MODE=clerk` + `CLERK_JWT_KEY` + `NEXT_PUBLIC_REMI_AUTH_MODE=clerk` + `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`

补充说明：
- 当前 local-prod 运行时验签只依赖 `CLERK_JWT_KEY`
- `CLERK_SECRET_KEY` 仍建议配置，但它属于“未来服务端 Clerk API / 管理接口”准备项，不再作为 local-prod 自检的硬前置

`REMI_AUTH_MODE=disabled` 不应作为这套“本机生产化”基线使用；它只适合本机开发直连。

## 3. Start / stop

```bash
# 检查配置完整性
npm run prod:local:check

# 启动本机生产化栈
npm run prod:local:start

# 停止
npm run prod:local:stop
```

服务编排文件：`docker-compose.local-prod.yml`

端口职责：
- `localhost:3000`：local-prod / tunnel 入口
- `localhost:3001`：本地开发入口（`npm run dev`）

## 4. Persistence boundary (must keep)

- `users/sessions/messages`：聊天与会话历史
- `memories/episodes`：记忆与关系主线
- `__rem_relationship_state_v1`：关系状态连续性

只要不删 Docker volume，数据会一直保留：
- `rem_local_prod_pgdata`
- `rem_local_prod_redisdata`

## 5. Capacity reality for 2-3 users

当前目标是小规模稳定，不是无限并发：

- 文本同时 2-3 人：通常可行
- 语音同时活跃 2-3 人：可行但要有预期
  - 首音频可能抖动
  - STT/TTS 会出现排队
  - 本机 CPU/内存会是首要瓶颈

建议先把语音并发按 1-2 活跃流做验收标准，第三人允许延迟升高但不崩溃。

## 6. Security baseline

- 不要直接暴露 `5432/6379`
- `app` 默认仅绑定 `127.0.0.1:${PORT}`
- 通过 Cloudflare Tunnel 或反向代理暴露 HTTPS
- 必须启用正式 auth（`legacy_jwt` 或 `clerk`），否则用户身份会退化成开发态
- 若主域名要作为正式 Web 入口并走 Clerk，不要再叠 `REMI_ACCESS_PASSWORD`
- `REMI_ACCESS_PASSWORD` 只建议留给单独的开发/预发入口，而不是正式登录域名
- 若仍保留 shared-password gate，至少要清楚它和正式用户登录不是同一层身份体系

## 7. Not solved yet

这套基线不包含：
- 多机容灾
- 自动故障切换
- 水平扩容
- STT/TTS 独立服务化与队列调度

所以它是“可持续迭代的单机生产化方案”，不是最终形态。
