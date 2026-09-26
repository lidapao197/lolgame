# LOL 赛事日历

一个纯静态的《英雄联盟》赛事月历网页：把 LPL 官方赛程按日期铺进日历，点任意日期弹出当天全部对局详情。

- 无框架、无构建、无依赖，三个文件（`index.html` / `index.css` / `index.js`）直接打开即可运行
- 数据实时从网上获取
- 支持深浅色主题，桌面与移动端自适应

## 功能

| 功能 | 说明 |
|---|---|
| 月历视图 | 周一为起始，今日高亮，非本月日期淡显 |
| 赛程预览 | 格内最多显示 3 行（按格子高度自适应），超出用右上角 `+N` 角标提示 |
| 比分 / VS | 已结束（`MatchStatus = 3`）显示比分，未开始显示 `vs` |
| 详情抽屉 | 点击日期从右侧弹出当天全部比赛，展示战队队徽、队名、比分、赛制、地点、状态 |
| 赛事切换 | 顶部下拉框切换赛事（只保留本年度赛事），选择会记在本地 |
| 月份跳转 | 月份按钮 + 年份切换，一键回到本月 |
| 加载提示 | 顶部居中弹出成功 / 失败提示，失败时给出具体原因 |
| 主题切换 | 右上角按钮切换深浅色，偏好写入 `localStorage` |
|

## 目录结构

```
lolgame/
├── public/
│   ├── index.html  页面结构
│   ├── index.css   样式（主题变量、日历、抽屉、提示）
│   └── index.js    接口请求、数据处理、渲染与交互
├── worker.js       唯一后端：/api 代理（补 CORS 头）+ 静态资源回落
├── wrangler.jsonc  Workers 部署配置（静态资源目录指向 public/）
└── README.md
```

本地预览：双击 `public/index.html`，或用任意静态服务器（如 `npx serve public`）。
想完整验证代理，用 `npx wrangler dev`（需要 Node 18+），它会同时跑静态资源和 `/api`。

## 跨域问题与同源代理

腾讯 LPL 接口（`lpl.qq.com`）不返回 `Access-Control-Allow-Origin`，浏览器直连必然被 CORS 拦截，
所以线上必须用**同源代理**：页面请求 `/api?u=<接口地址>`，由 Worker 转发并补上 CORS 头。

- 只放行 `lpl.qq.com`，不会被当成开放代理
- 转发时带上官方 `Referer` 与浏览器 `User-Agent`，避免被上游拒绝
- 响应缓存在浏览器 60 秒，减轻上游压力
- 前端按顺序尝试：同源 `/api` → 公共代理 → 直连；拿到 HTML（如 404 页）会自动跳过继续试下一个
- 代理全部逻辑都在 `worker.js` 一个文件里，没有其它后端文件

> 为什么不用 JSONP：只有战队表是 `var TeamList={...}` 的脚本，赛事列表和对阵都是纯 JSON，
> `<script>` 标签拿不到值，所以必须由服务端转发补 CORS 头。

> 若改用 Pages 部署（`pages.dev`），把 `worker.js` 的内容换成 `functions/api.js` 里的
> `export async function onRequest(ctx) { ... }` 即可，同样只有这一个文件，且不需要 `wrangler.jsonc`。

### 部署到 Cloudflare Workers（推荐，自带代理）

```bash
npm i -g wrangler          # 只需一次
npx wrangler login         # 浏览器授权
npx wrangler deploy        # 部署，得到 https://lolgame.<子域>.workers.dev
```

Workers 的 **静态资源 + Worker** 模式由 `wrangler.jsonc` 描述：资源目录是 `public/`，
`/api` 命中 `worker.js`，其余请求回落到 `public/index.html` 等静态文件。
好处是 `worker.js`、`wrangler.jsonc`、`README.md` 不会被当成静态资源公开出去。

## 部署到 Cloudflare Pages（在线，无需命令行）

全程在 Cloudflare 仪表盘操作，两种方式任选。

### 方式一：连接 Git 仓库（推荐，推送即自动部署）

1. 把项目推到 GitHub / GitLab（站点文件放在 `public/` 目录）
2. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) → 左侧 **Workers & Pages** → **Create**
3. 选 **Pages** → **Connect to Git**，授权并选择刚才的仓库
4. 构建配置按下表填写：

   | 配置项 | 值 |
   |---|---|
   | Framework preset | `None` |
   | Build command | 留空 |
   | Build output directory | `public` |
   | Root directory | 留空（仓库根目录） |

5. 点 **Save and Deploy**，等待几十秒完成，得到 `https://<项目名>.pages.dev`
6. 之后每次 `git push` 都会自动触发重新部署

### 方式二：直接上传文件（不用 Git）

1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Upload assets**
2. 给项目起名（如 `lolgame`），把 `public` 目录里的 `index.html`、`index.css`、`index.js` 拖进上传区
3. 点 **Deploy**，完成后访问 `https://lolgame.pages.dev`

> 两种方式都只上传静态资源，不需要构建、不需要任何配置文件。

### 绑定自定义域名（可选）

项目页 → **Custom domains** → **Set up a custom domain**，按提示添加 DNS 记录即可，Cloudflare 自动签发 HTTPS 证书。

## 说明

- 无构建步骤、无环境变量；唯一的「后端」就是 `worker.js` 里的 `/api` 转发
- 数据经同源 `/api` 代理获取；若官方接口变更或代理失效，页面顶部会弹出失败提示，日历其余功能不受影响
- 本地以 `file://` 打开时 `/api` 不可用，会自动退到公共代理（可能较慢或失败），建议用 `npx wrangler dev` 预览
- 战队表加载失败时自动降级为纯文字队名，队徽位置留空
