# 桌面端多端协同 + Clerk 账号体系设计

> 状态：设计草案，待实现
> 场景：在家起服务（Docker），公司 Mac 装 Remi 桌面端，登录 Clerk（同一邮箱），连回家里的服务，多端共享同一份记忆。

## 1. 目标与一个关键纠正

把 Remi 桌面端做成「随处登录、同一份记忆」：

- 家里跑 app 服务 + Postgres(pgvector) + Redis（Docker）。
- 公司 Mac 的桌面端通过网络连回家里 **app 服务**，用 Clerk 账号登录。
- 同一邮箱在 web / 桌面 / 手机看到同一个 Remi、同一份记忆。

**关键纠正：桌面端不直连家里的 Postgres。** 正确数据流：

```
公司 Mac (Tauri 桌面端)
   │  WebSocket + token
   ▼
家里的 app 服务 (server/gateway, :3000)   ← 它才持有 DATABASE_URL
   │  docker 内网
   ▼
Postgres(pgvector) + Redis              ← 永远只绑 127.0.0.1，不出机器
```

理由：慢脑 / 记忆提取 / embedding 检索全在 app 服务里（`server/`），数据库只是其后端。把 5432 裸暴露到公网 = 整个家庭记忆库门户大开。`docker/docker-compose.local-prod.yml` 现状已经是对的写法（app 绑 `127.0.0.1:3000`，pg/redis 不映射端口），保持不变。

## 2. 现状摸底（代码已铺好的轨道）

### 2.1 服务端 Clerk 鉴权已就绪
- `infra/auth.ts`：`REMI_AUTH_MODE=clerk` 时用 `CLERK_JWT_KEY`(RS256 公钥) 验 Clerk JWT，取 `sub` 作为 userId。
- 关键：`verifyToken` 在 clerk 模式下 `verifyClerkToken(token) ?? verifyLegacyJwtToken(token)` —— **clerk 与 legacy 两种 token 都收**（`infra/auth.ts:135`）。
- `generateToken(userId)` 签发 legacy JWT（24h，payload `{id: userId}`，`infra/auth.ts:127`）。
- WS 鉴权：握手时 `extractWsToken` 从 `?token=` 读，`verifyToken` 校验（`server/gateway/index.ts:291` / `442` / `506`）。只在握手验一次（`wsAuthenticateOnce`），连上后不再校验；重连需新 token。

### 2.2 web 端 Clerk 已接好
- `web/src/components/RemiAuthProvider.tsx`：用 `@clerk/nextjs`，`getToken()` 拿 token。
- `web/src/app/sign-in/[[...sign-in]]/page.tsx`：`<SignIn>` 完整登录页（含 Google OAuth）。
- `web/src/lib/wsUrl.ts:66` `appendTokenToWsUrl` 把 token 拼到 WS 的 `?token=`。

### 2.3 连接链路是「带 token 就能跑」的通用设计
```
useRemiWebAuth().getSessionToken()        ← 桌面端当前返回 null（被 stub）
   ▼ useRemiConnection.ts:140
getRemWsUrl(token) → 拼成 ?token=...        ← wsUrl.ts:66
   ▼
new WebSocket(url)
   ▼
服务端 extractWsToken 读 ?token=            ← server/gateway/index.ts:291
   ▼ verifyToken → clerk 模式验 Clerk JWT   ← infra/auth.ts:135
```

### 2.4 桌面端目前刻意关掉了 Clerk（缺口所在）
- `desktop/vite.config.ts`：把 `@/components/RemiAuthProvider` 别名到 stub；硬编码 `NEXT_PUBLIC_REMI_AUTH_MODE: "disabled"`、`CLERK_PUBLISHABLE_KEY: ""`。
- `desktop/src/shared/DesktopAuthProvider.tsx`：写死 stub，`getSessionToken: async () => null`，`currentUserId: DEFAULT_DEV_USER_ID`。
- `desktop/package.json`：未装任何 `@clerk/*`。
- 桌面是独立 Tauri v2 app，自建前端（`desktop/src/{character,chat}`），通过 `@ → ../web/src` 别名复用 web 逻辑。

**结论：整条链路已通，唯一缺的是「桌面端拿到真实 token」这一环。**

## 3. 方案：复用 web 登录页 + deep-link 回传 token

### 3.1 为什么不能「把 web 登录页塞进 Tauri 就完事」
桌面窗口源是 `tauri://localhost`，web 是 `https://home-server`，**不同 origin**。Clerk session/cookie 留在 web origin，不会跨到 Tauri 窗口。光在 web 登录，桌面窗口仍拿不到 token。

### 3.2 标准模式：系统浏览器登录 → deep link 递回 token
```
桌面「登录」按钮
   │ shell.open 系统浏览器
   ▼
https://home-server/sign-in?desktop=1     ← 复用 web 登录页，Google OAuth 在真浏览器里跑
   │ 登录成功
   ▼
web 调服务端接口换发【长效 token】
   │ 重定向到 ai.remi.desktop://auth?token=...   ← 自定义 scheme 深链
   ▼
Tauri deep-link 插件捕获 → 存 keychain
   ▼
DesktopAuthProvider.getSessionToken() 返回它 → WS 连上家里服务
```

### 3.3 关键决定：递回的是 legacy token，不是 Clerk JWT
- Clerk JWT 仅 ~60s 有效，桌面端没跑 Clerk SDK 无法刷新 → 连接很快废。
- 改为登录后服务端 `generateToken(clerkUserId)` 换发 **legacy JWT（24h）**，subject 绑定到 Clerk userId。
- 因为服务端两种 token 都收，且 legacy token 的 subject == Clerk userId：
  > **同一邮箱 → 同一 Clerk userId → legacy token 同 subject → 同一份记忆。** web 端继续用 Clerk，桌面用换发的长效 token，落到同一份数据。
- 附带好处：**桌面端不用装 `@clerk/clerk-react`**，前端改动更小。
- token 过期（24h）后桌面端重新走一次登录流程即可（后续可加静默续期接口）。

## 4. 实现清单（建议落地顺序，每步可独立验证）

### 第 1 步：服务端换发接口（最底层，curl 可测）
- 新增 **Clerk 鉴权保护**的接口，如 `POST /api/desktop/exchange-token`。
- 逻辑：`authMiddleware` 已把 `req.user.id` 设为 Clerk subject；接口内 `generateToken(req.user.id)` 返回 `{ token, expiresIn }`。
- 前置条件：配置 `REMI_AUTH_JWT_SECRET`（legacy 签名密钥）。
- 验证：带合法 Clerk token `curl` 调用，拿到 legacy JWT；再用该 JWT 连 WS 成功。

### 第 2 步：web 登录页支持桌面回跳
- `/sign-in` 读 `?desktop=1`：登录成功后不跳 `/`，改为调第 1 步接口拿 token，再 `window.location = ai.remi.desktop://auth?token=<token>`。
- ⚠️ **安全：回跳 scheme 只允许 `ai.remi.desktop://` 这一个**，严格校验。现有 `returnTo`（`server/gateway/index.ts:171`）只允许 `/` 开头、且是给共享密码门用的，**不能复用**，需单独实现。

### 第 3 步：桌面端 deep-link + token 存储 + 登录按钮
- `tauri.conf.json`：注册 `ai.remi.desktop://` scheme，加 Tauri `deep-link` 插件。
- `desktop/src-tauri/src/lib.rs`：处理 deep-link 回调，取出 token。
- token 存储：Tauri store / 系统 keychain。
- `desktop/src/shared/DesktopAuthProvider.tsx`：从写死 stub 改成「读存储的 token」，`getSessionToken` 返回它；`currentUserId` 用 token 解析或服务端返回；未登录渲染「用邮箱登录」按钮（`@tauri-apps/plugin-shell` open 到 `https://home-server/sign-in?desktop=1`）。
- `desktop/vite.config.ts`：`VITE_WS_URL` 指向家里服务（走 Tailscale 内网或 `wss://`）。

## 5. 网络打通（家里服务对外）

家庭宽带通常 NAT + 动态 IP，公司 Mac 直接够不到。选一种：

| 方案 | 评价 | 说明 |
|---|---|---|
| **Tailscale**（推荐） | 最省心 | 两端装 Tailscale 组私有内网，桌面端 `VITE_WS_URL=ws://home-server.tailnet:3000/ws`。零公网暴露、自带加密、动态 IP 无所谓。 |
| Cloudflare Tunnel | 想要公网 HTTPS 域名时 | `app.域名` → 家里，必须 `wss://`，建议前置 Cloudflare Access 限制只有你能进。 |
| 路由器端口转发 + DDNS | 不推荐 | 攻击面大，要自己搞证书。 |

## 6. 安全红线

1. **Postgres/Redis 永不映射公网端口**（现状已对，别改）。
2. **远程必须开 Clerk 鉴权**，且 `REMI_AUTH_ALLOW_LOOPBACK_BYPASS=0`。
3. 走公网必须 `wss://` + 隧道前置访问控制（Tailscale 天然满足）。
4. deep-link 回跳只允许 `ai.remi.desktop://`，严格校验 scheme。
5. token 放在 WS 的 URL query（`?token=`）传输——内网/`wss://` 可接受，**勿用明文 `ws://` 走公网**。
6. ⚠️ **待核实**：clerk 模式下 HTTP 层 `shouldEnforceHttpAuth` 返回 `false`（`server/gateway/index.ts:361`），意味着 HTTP 路由鉴权靠别的机制兜底。远程上线前需确认没有裸露的 unauth HTTP 接口（尤其新加的 `exchange-token` 必须自己强制 Clerk 鉴权）。

## 7. 环境变量参考

### 家里服务器（`.env.local-prod`）
```bash
REMI_AUTH_MODE=clerk
CLERK_JWT_KEY=<Clerk Dashboard → API Keys → JWKS/PEM 公钥>
CLERK_SECRET_KEY=<...>
REMI_AUTH_JWT_SECRET=<legacy 签名密钥，给 exchange-token 用>
REMI_AUTH_ALLOW_LOOPBACK_BYPASS=0
# DATABASE_URL / REDIS_URL 走 docker 内网，保持现状
```

### 公司 Mac 桌面端（`desktop/.env` 或 VITE_*）
```bash
VITE_WS_URL=ws://home-server.tailnet:3000/ws   # 公网则 wss://
# 复用 web 登录页方案下，桌面端无需 Clerk publishable key
```

## 8. 相关文件索引
- 服务端鉴权：`infra/auth.ts`（`verifyToken` / `generateToken` / `authMiddleware`）
- 服务端网关 / WS token：`server/gateway/index.ts`（`extractWsToken` / `shouldEnforceHttpAuth`）
- 配置 schema：`server/config/schema.ts`（`REMI_AUTH_MODE` / `CLERK_*`）
- web 鉴权：`web/src/components/RemiAuthProvider.tsx`、`web/src/app/sign-in/[[...sign-in]]/page.tsx`
- WS URL 拼装：`web/src/lib/wsUrl.ts`、连接：`web/src/hooks/useRemiConnection.ts`
- 桌面 stub：`desktop/src/shared/DesktopAuthProvider.tsx`、`desktop/vite.config.ts`、`desktop/src-tauri/{tauri.conf.json,src/lib.rs}`
- 部署：`docker/docker-compose.local-prod.yml`
