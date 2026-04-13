# Remote Dev On Home Computer

目标场景：`remi` 常驻在家里电脑；公司电脑只通过办公网的浏览器或浏览器插件访问同一套开发环境，并实时预览页面与 WebSocket。

这台 `MacBook Air 16GB` 的推荐做法是：**应用原生跑在家里电脑上，Docker 默认只负责 Postgres/Redis，`code-server` 和容器内 `app-dev` 都是可选项。**

## 推荐架构

- 家里电脑作为唯一开发主机，保存仓库、`.env`、Postgres、Redis。
- `remi` 主程序默认原生运行在家里电脑上，不放进 Docker。
- Docker 默认只跑 `postgres` 和 `redis`。
- 轻量远程开发优先使用 `ttyd + tmux` 浏览器终端，而不是常驻 `code-server`。
- 浏览器 IDE 跑在家里电脑的 `127.0.0.1:8443`，仅在需要时启动。
- 对外只暴露 HTTPS 域名，不直接暴露 `3000/5432/6379`。
- 推荐用 `Cloudflare Tunnel + Cloudflare Access`：
  - `ide-rem.example.com` -> `http://127.0.0.1:8443`
  - `app-rem.example.com` -> `http://127.0.0.1:3000`
  - `term-rem.example.com` -> `http://127.0.0.1:7681`

## 本机初始化

1. 安装 Docker Desktop 或可用的 Docker Engine + Compose。
2. 在家里电脑拉取仓库并进入根目录。
3. 运行：

```bash
./scripts/bootstrap-home-dev.sh
```

4. 编辑 `.env`，至少补齐：

```env
key=...
base_url=...
model=...
JWT_SECRET=...
REMI_NEXT_HOSTNAME=app-remi.example.com
```

如果预览页与 `/ws` 使用同一 HTTPS 域名，通常不需要再设置 `NEXT_PUBLIC_WS_URL`。当前前端会在 HTTPS 页面下自动回退到 `wss://当前域名/ws`。

5. 首次原生开发安装依赖：

```bash
npm install
npm install --prefix web
```

## 启动开发环境

默认只启动存储：

```bash
./scripts/start-dev-stack.sh
```

原生启动应用：

```bash
npm run dev:native
```

如果需要单独前端开发模式，再开一个终端：

```bash
npm run web:dev
```

如果页面出现开发态缓存异常或浏览器拿到旧 HMR 状态，可先清掉 Next 缓存再重启：

```bash
npm run dev:web:clean
```

如果需要轻量浏览器终端（推荐用于 Codex / Claude Code / tmux）：

```bash
npm run dev:term
```

同时启动浏览器 IDE：

```bash
./scripts/start-dev-stack.sh --ide
```

如果你仍然想把应用放进容器里跑，只在调试时临时使用：

```bash
./scripts/start-dev-stack.sh --app
```

如果你已经在 Cloudflare Dashboard 创建好 named tunnel，并拿到了 token：

```bash
./scripts/start-dev-stack.sh --ide --tunnel
```

停止：

```bash
./scripts/stop-dev-stack.sh
```

## Cloudflare 建议配置

1. 注册域名并接入 Cloudflare。
2. 创建一个 named tunnel。
3. 在 tunnel 里配置两个 public hostnames：

```text
ide-rem.example.com  -> http://127.0.0.1:8443
app-rem.example.com  -> http://127.0.0.1:3000
term-rem.example.com -> http://127.0.0.1:7681
```

4. 给 `ide-rem.example.com` 打开 Cloudflare Access，只允许你的邮箱登录。
5. `app-rem.example.com` 也建议至少加一层 Access，除非你明确需要外部访客访问。

仓库里已提供模板：

```bash
cp infra/cloudflared/config.example.yml infra/cloudflared/config.yml
```

然后把下面两项改成你的真实值：

- `YOUR_TUNNEL_ID`
- 两个 `hostname`

如果你在家里电脑本机安装了 `cloudflared`，可直接运行：

```bash
npm run tunnel:start
```

或显式指定配置文件：

```bash
./scripts/start-cloudflare-tunnel.sh /绝对路径/你的config.yml
```

## 工作方式

- 在公司电脑浏览器打开 `https://ide-rem.example.com`。
- 进入同一个工作区，直接继续使用家里电脑上的代码、终端、Codex、Claude Code。
- 预览页面在 `https://app-rem.example.com`。
- 轻量终端入口建议使用 `https://term-rem.example.com`，登录后直接进入 `tmux` 会话 `rem-dev`。
- 网页终端已使用仓库内 `tmux-web.conf` 优化：前缀改为 `Ctrl+a`，并可用 `F7` 或输入 `tmux copy-mode` 进入滚动模式。
- `npm run dev` 跑在家里电脑本机；聊天与流式响应走同一域名下的 `/ws`。
- 如机器发热或卡顿，优先关闭 `code-server`，不要先关 Postgres/Redis。

## 每次开工的最小流程

```bash
./scripts/start-dev-stack.sh
npm run dev:native
npm run dev:check
```

需要远程 HTTPS 预览时，再单独开一个终端：

```bash
npm run tunnel:start
```

需要轻量远程终端时：

```bash
npm run dev:term
npm run dev:term:check
```

## 验证清单

- `https://app-rem.example.com` 能打开页面。
- 浏览器控制台里 WebSocket 连接为 `wss://app-rem.example.com/ws` 或你显式配置的 `NEXT_PUBLIC_WS_URL`。
- 在远程 IDE 改一个前端组件后，预览页能自动刷新或热更新。
- 重启容器后，Postgres 和 Redis 数据仍在。
- 家里电脑只运行原生 app + 必需服务时，内存压力明显小于“全容器化开发”。

## 语音链路说明

首期先按“页面 + WebSocket”远程预览设计。语音链路后续再补，原因是办公网下浏览器麦克风权限、HTTPS、音频回放和长连接代理会比普通页面预览复杂。
