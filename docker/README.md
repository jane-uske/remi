# Docker 编排

所有 Compose 文件与 `Dockerfile` 集中在本目录。脚本与 npm 命令从**仓库根目录**执行，通过 `-f docker/docker-compose.*.yml` 引用。

## 文件

| 文件 | 用途 |
|------|------|
| [Dockerfile](Dockerfile) | 三阶段构建：backend → frontend → runtime |
| [docker-compose.yml](docker-compose.yml) | 生产：`app` + `postgres` + `redis` |
| [docker-compose.dev.yml](docker-compose.dev.yml) | 开发基础设施：`postgres` + `redis`；可选 `app-dev` / `code-server` / `cloudflared` |
| [docker-compose.local-prod.yml](docker-compose.local-prod.yml) | 本机生产化（绑定 `127.0.0.1:3000`） |
| [docker-compose.local-prod.override.yml](docker-compose.local-prod.override.yml) | 本地快速迭代：挂载宿主机 `dist` / `.next` |

`build.context` 均为仓库根目录 `..`；卷路径如 `../storage/schema.sql` 相对本目录解析。

## 常用命令（在仓库根目录）

```bash
# 开发：仅 Postgres + Redis
npm run dev:infra

# 本机构建 / 启动 local-prod
npm run prod:local:build
npm run prod:local:start

# 直接 compose（等价于脚本）
docker compose -f docker/docker-compose.dev.yml up -d postgres redis
docker compose -f docker/docker-compose.local-prod.yml --env-file .env.local-prod up -d
```

## Compose 项目隔离

| 模式 | Project 名 | 入口 |
|------|------------|------|
| dev | `remi-ai-dev` | `scripts/start-dev-stack.sh` |
| local-prod | `remi-ai-local-prod` | `scripts/start-local-prod.sh` |

避免 dev 与 local-prod 容器/卷互相覆盖。

## 宿主机 AI 服务

`docker-compose.local-prod.yml` 中 `app` 使用 `extra_hosts: host.docker.internal:host-gateway`，以便容器访问宿主机上的 LM Studio、MLX TTS、whisper-server、ComfyUI。详见 [docs/guides/NEW_DEVICE_SETUP.md](../docs/guides/NEW_DEVICE_SETUP.md)。