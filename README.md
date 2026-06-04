这是 XDUCraft 社团自用项目。本 README 由 Codex（GPT-5）协助生成。

# XDUCraft Survey

XDUCraft Survey 是给 XDUCraft 社区内部使用的问卷/投票系统，主要用于 Minecraft 服务器方案、整合包候选项投稿和投票留档。

它不是通用 SaaS 问卷平台，当前目标是满足社团自部署、可控身份、可留档、可审核的内部决策流程。

## 主要功能

- 创建多个相互隔离的问卷。
- 每个问卷独立配置投票规则、起止时间、是否允许修改、是否要求登录。
- 玩家通过公开链接或二维码进入问卷。
- 玩家可以投票，也可以提交新的服务器/整合包候选项。
- 候选项可配置是否需要管理员审核。
- 管理员可以编辑问卷、字段、候选项、审核状态，并导出数据。
- 支持 XDUCraft 皮肤站 OAuth 登录。
- 普通玩家只能看到脱敏后的公开数据。

## 技术栈

- 前端：Vue 3、Vite、Naive UI、lucide-vue-next
- 后端：Node.js HTTP Server
- 数据：当前使用本地 JSON 文件持久化，默认位于 `data/app-state.json`

## 本地开发

安装依赖：

```bash
npm install
```

复制环境变量：

```bash
cp .env.example .env
```

启动开发服务：

```bash
npm run dev
```

默认情况下：

- 前端运行在 Vite 端口。
- API 运行在 `http://localhost:8787`。
- Vite 会把 `/api` 代理到本地 API。

## 环境变量

常用配置见 `.env.example`。

关键项：

```bash
PORT=8787
FRONTEND_BASE_URL=http://localhost:5173
XDUCRAFT_DATA_DIR=./data
SESSION_SECRET=replace-with-a-long-random-string
SESSION_TTL_SECONDS=1209600
XDUCRAFT_PROXY_SECRET=

BLESSING_BASE_URL=https://skin.example.edu
BLESSING_CLIENT_ID=
BLESSING_CLIENT_SECRET=
BLESSING_REDIRECT_URI=http://localhost:8787/api/auth/blessing/callback
BLESSING_OAUTH_SCOPE=User.Read Player.Read
BLESSING_ADMIN_IDS=

VITE_API_BASE_URL=
XDUCRAFT_UPSTREAM_API=
```

说明：

- `SESSION_SECRET` 必须在生产环境中设置为足够长的随机字符串。
- `BLESSING_REDIRECT_URI` 必须和皮肤站 OAuth 应用中填写的回调地址一致。
- `BLESSING_ADMIN_IDS` 用英文逗号分隔，可填皮肤站返回的 uid、邮箱、昵称或游戏名。
- `XDUCRAFT_DATA_DIR` 指向后端数据目录，生产环境应定期备份。
- `VITE_API_BASE_URL` 留空时，前端会请求同域名下的 `/api`。
- `XDUCRAFT_UPSTREAM_API` 只给 Vercel `/api` 代理使用，指向真实后端地址。
- `XDUCRAFT_PROXY_SECRET` 是可选的代理密钥。后端和 Vercel 填同一个值后，后端会拒绝绕过代理的 API 请求。

## 构建与运行

构建前端：

```bash
npm run build
```

运行生产服务：

```bash
npm run serve
```

生产服务会从 `dist/` 提供前端静态文件，并同时处理 `/api` 请求。

## 部署建议

### 推荐方案：自托管完整服务

适合当前代码结构。

1. 在服务器上安装 Node.js。
2. 拉取项目并安装依赖。
3. 配置 `.env`。
4. 执行 `npm run build`。
5. 使用 `npm run serve` 启动服务。
6. 使用 Nginx 或 Caddy 反代到 `localhost:8787`。
7. 给域名配置 HTTPS。
8. 在皮肤站 OAuth 应用中填写公网回调地址：

```text
https://你的后端域名/api/auth/blessing/callback
```

示例：

```bash
FRONTEND_BASE_URL=https://vote.xducraft.cn
BLESSING_REDIRECT_URI=https://vote.xducraft.cn/api/auth/blessing/callback
```

### 推荐给当前条件：Vercel 前端 + Vercel API 代理 + 自托管后端

如果前端域名走 Vercel，而后端运行在家宽公网 IPv4 上，建议让玩家始终访问同一个前端域名：

```text
玩家浏览器 -> https://vote.xducraft.cn
          -> https://vote.xducraft.cn/api/...
          -> http://你的公网 IPv4:8787/api/...
```

这样浏览器只连接 Vercel 的 443 端口，不需要玩家直接访问家宽的 `:8787` 或 `:8443`，也避免 HTTPS 页面请求 HTTP API 的混合内容问题。

Vercel 环境变量：

```bash
VITE_API_BASE_URL=
XDUCRAFT_UPSTREAM_API=http://你的公网 IPv4:8787
XDUCRAFT_PROXY_SECRET=换成和后端一致的随机长字符串
```

后端 `.env` 设置：

```bash
FRONTEND_BASE_URL=https://vote.xducraft.cn
BLESSING_REDIRECT_URI=https://vote.xducraft.cn/api/auth/blessing/callback
XDUCRAFT_PROXY_SECRET=换成和 Vercel 一致的随机长字符串
```

皮肤站 OAuth 应用里的回调地址也填写：

```text
https://vote.xducraft.cn/api/auth/blessing/callback
```

如果你愿意开放并配置 `8443`，也可以把 `XDUCRAFT_UPSTREAM_API` 写成：

```bash
XDUCRAFT_UPSTREAM_API=https://api.xducraft.cn:8443
```

但从玩家体验看，仍然建议让玩家只看到 `vote.xducraft.cn`，由 Vercel `/api` 代理转发。

### 可选方案：Vercel 前端 + 浏览器直连后端

这种方式也能用，但需要玩家浏览器直接访问后端域名或端口：

```bash
VITE_API_BASE_URL=https://api.xducraft.cn:8443
```

后端 `.env`：

```bash
FRONTEND_BASE_URL=https://vote.xducraft.cn
BLESSING_REDIRECT_URI=https://api.xducraft.cn:8443/api/auth/blessing/callback
```

这会让跨域、证书、非标准端口连通性都落到玩家浏览器侧，除非你已经确认不同网络环境访问 `:8443` 很稳定，否则不作为首选。

### 不推荐：当前版本直接全量部署到 Vercel

当前后端使用本地 JSON 文件持久化。Vercel Functions 的运行时文件系统是只读的，只有 `/tmp` 是临时可写空间，不适合作为长期数据存储。

如果要全量部署到 Vercel，应先把存储层改成外部数据库，例如 PostgreSQL、Supabase、Neon 或其他托管数据库。

参考：

- https://vercel.com/docs/functions/runtimes
- https://vercel.com/docs/functions

## 数据与备份

当前数据文件默认在：

```text
data/app-state.json
```

生产环境建议：

- 定期备份 `data/` 目录。
- 不要把 `.env`、`data/`、`dist/` 提交到 Git。
- 迁移服务器前先停止服务，再复制数据文件。
- 后续如问卷数量、投票数量明显增加，应迁移到数据库。

## 注意事项

- 手动退出登录会清理本系统的本地 session。
- 如果皮肤站本身仍保持登录，下次 OAuth 可能仍会自动授权同一个皮肤站账号。
- 新项目默认没有问卷，管理员需要先在后台创建问卷。
- 默认候选项字段模板会在新建问卷时使用。

## 常用命令

```bash
npm run dev       # 本地开发
npm run api       # 只启动 API 服务
npm run build     # 类型检查并构建前端
npm run serve     # 生产模式运行
```
