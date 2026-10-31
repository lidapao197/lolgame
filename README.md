# LOL 赛事日历

一个纯静态的《英雄联盟》赛事月历网页：把 LPL 官方赛程按日期铺进日历，点任意日期弹出当天全部对局详情。

- 无框架、无构建、无依赖，三个文件（`index.html` / `index.css` / `index.js`）直接打开即可运行
- 数据实时从网上获取
- 浅色玻璃拟态界面 + 渐变光斑背景，7 套主题色可切换，桌面与移动端自适应

## 功能

| 功能 | 说明 |
|---|---|
| 月历视图 | 周一为起始，今日高亮，非本月日期淡显 |
| 赛程预览 | 格内最多显示 3 行（按格子高度自适应），超出用右上角 `+N` 角标提示；格子偏窄时自动压缩时间列，极窄时舍去格内时间以保证队名完整 |
| 比分 / VS | 已结束（`MatchStatus = 3`）显示比分，未开始显示 `vs` |
| 详情抽屉 | 点击日期从右侧弹出当天全部比赛，展示战队队徽、队名、比分、赛制、地点、状态 |
| 赛事切换 | 顶部下拉框切换赛事（只保留本年度赛事），选择会记在本地 |
| 月份跳转 | 月份按钮 + 年份切换，一键回到本月 |
| 加载提示 | 顶部居中弹出成功 / 失败提示，失败时给出具体原因 |
| 主题色 | 右上角色板按钮弹出 7 色卡（靛蓝 / 天蓝 / 紫罗兰 / 樱粉 / 暖橙 / 青碧 / 翠绿），主色、选中态、背景光斑同步变化，选择记在本地 |
| 背景 | 浅色渐变底 + 两枚随主题色变化的高斯模糊光斑，日历与播放器为半透明毛玻璃卡片 |
| 毛玻璃导航 | 顶部中央悬浮 iOS 风格毛玻璃导航，「首页 / 影视 / 音乐」滑动切换 |
| 影视导航 | 优酷 / 爱奇艺 / 腾讯视频 / 芒果TV 四个平台，每个平台下「电视剧 / 电影 / 综艺 / 动漫」各一行海报，一行 20 条，行尾 `‹ ›` 前后翻页；海报下方显示上映日期（取不到完整日期时退回年份） |
| 影视详情 | 点海报弹出详情层（海报大图 + 平台 / 标签 / 简介 / 评分 / 上映 / 状态 / 主演），**不跳转外站**；点遮罩、右上角 × 或按 Esc 关闭，打开时锁住背景滚动 |
| 音乐播放 | 播放 `public/data/music.json` 里的歌曲链接，支持上一首 / 下一首、随机 / 顺序切换（默认顺序，随机模式按播放历史回退）、进度拖拽、音量滑杆（喇叭键静音切换、←/→ 微调）、播完自动连播、播放器吸顶、列表一行最多 5 个自适应（序号 / 封面 / 单曲时长） |
|

## 目录结构

```
lolgame/
├── public/
│   ├── index.html  页面结构（首页 / 影视 / 音乐 三个视图）
│   ├── favicon.svg 站点图标（日历 + 音符）
│   ├── index.css   样式（主题变量、毛玻璃导航、日历、影视海报墙、播放器、抽屉、提示）
│   ├── index.js    接口请求、数据处理、渲染与交互、影视海报、音乐播放
│   └── data/
│       └── music.json  音乐列表（抖音导出格式，data 数组，play 字段为音频链接）
├── server.js       本地开发服务器：node server.js 一键跑静态资源 + /api + /poster
├── start.bat       Windows 双击启动（GBK 编码，勿另存为 UTF-8）
├── worker.js       后端入口：/api 代理（补 CORS 头）+ /poster 影视海报 + 静态资源回落
├── poster.mjs      影视海报聚合：抹平优酷 / 爱奇艺 / 腾讯 / 芒果 四个平台的接口差异
├── wrangler.jsonc  Workers 部署配置（静态资源目录指向 public/）
└── README.md
```

本地预览（推荐）：Windows 直接双击 `start.bat` 启动服务，然后访问 `http://localhost:3000`；
或在命令行运行 `node server.js`（需要 Node 18+）。
静态资源和 `/api` 代理都在，行为与线上一致；端口可用 `PORT=8080 node server.js` 改，
端口被占用时（如上一个服务忘关）会自动向后换空闲端口并以日志提示实际地址。

其它方式：双击 `public/index.html`，或用任意静态服务器（如 `npx serve public`）——
这些方式没有 `/api`，数据会退到公共代理，可能较慢或失败。
也可以用 `npx wrangler dev`（需要 Node 18+），效果同 `node server.js`。

## 音乐列表配置

音乐页读取 `public/data/music.json`，兼容抖音收藏导出格式，也支持简化字段：

```json
{
  "data": [
    { "title": "歌名", "author": "作者", "duration": 122,
      "cover": "https://…/封面.jpg", "play": "https://…/音频.mp3" }
  ]
}
```

- 音频取 `play`（或 `url`），作者取 `author`（或 `artist`），其余字段可选
- 音频域名不限（`<audio>` 直播不受 CORS 限制），链接失效时页面会弹出失败提示并自动跳下一首
- 主题色、当前选中视图、最后播放的歌曲、音量与静音状态都会记在 `localStorage`
- 音量滑杆在 ≤480px 的窄屏收起，只保留喇叭静音键（手机通常用系统音量键）

## 影视海报来源

影视页的海报不是写死的，而是由 `poster.mjs` 实时从四个平台拉取，再由 `worker.js` / `server.js`
通过 `/poster` 暴露给前端（浏览器直连这些接口会被 CORS 拦截，必须走后端）。

| 平台 | 接口 | 说明 |
|---|---|---|
| 优酷 | `acs.youku.com` MTOP `mtop.youku.columbus.home.query` | 需要 `_m_h5_tk` 令牌 + md5 签名，`poster.mjs` 内置了一份纯 JS 的 md5；翻页靠返回体里的 session 节点逐页推进 |
| 爱奇艺 | `pub.m.iqiyi.com/h5/main/recVideos/lib/` | 公开列表接口，`channel_id` 区分分类，`page_id` 即页码 |
| 腾讯视频 | `pbaccess.video.qq.com/.../getMVLPage` | POST 接口，必须先请求一次拿到 `page_context`，再用其中的 `poster_size` / `poster_offset` 分页，才能一页取 20 条 |
| 芒果TV | `pianku.api.mgtv.com/rider/list/pcweb/v3` | 公开片库接口，`channelId` 区分分类，`pn` 即页码 |

```
GET /poster?site=youku|iqiyi|tencent|mango&cat=tv|movie|variety|anime&page=1
→ { ok: true, site, cat, page, items: [{ title, poster, url, corner, note, desc, cast, update, rating, date, year }], hasMore }
```

**详情字段**（弹层用，四个平台完整度不同，缺的字段直接留空、对应行不渲染）：

| 字段 | 优酷 | 爱奇艺 | 腾讯视频 | 芒果TV |
|---|---|---|---|---|
| `desc` 简介 | ✅ 完整简介 | ⚠️ 一句推荐语 | ⚠️ 一句话看点 | ✅ 完整剧情 |
| `cast` 主演 | ❌ | ❌ | ✅ `sub_title` | ✅ `subtitle` |
| `note` 类型/地区 | ✅ `tags` | ❌ | ✅ 类型 · 地区 | ✅ `kind` |
| `update` 状态 | ✅ 限免/更新标签 | ❌ | ✅ 更新至 N 集 | ✅ 更新至 N 集 |
| `rating` 评分 | ❌ | ❌ | ✅ `chnlist_search_label` 里的「评分 x.x」 | ❌ |

> 腾讯的 `latest_mark_label` 是按位置编号的对象（`{"1":{"info":{"text":"2026"}},"2":{"info":{"text":"上新","type":"1"}}}`），
> 不是数组，`poster.mjs` 里按 `info.text` 取带颜色那个作角标，直接 `JSON.parse().map()` 会报错并露出原始 JSON。

**日期字段 `date`**：四个平台的日期完整度不同，统一按「有完整日期就用，否则退回年份，都没有则留空」处理。

| 平台 | 来源 | 实际显示 |
|---|---|---|
| 腾讯视频 | `publish_date` | `2026-10-23` |
| 爱奇艺 | `period`（`20261020` 转成 `2026-10-20`） | `2026-10-20` |
| 芒果TV | `year` | `2026` |
| 优酷 | 接口不返回任何日期/年份字段 | 留空（卡片保留占位以保持对齐） |

- 结果在服务端内存缓存 5 分钟，前端也按「平台:分类:页码」缓存，翻回看过的页不重复请求
- 优酷与爱奇艺的条目没有稳定的专辑页地址，`url` 指向该平台的站内搜索；腾讯、芒果用 `cid` / `clipId` 直连详情页。该字段仅为保留，页面已改为弹层展示，不再跳转
- 图片一律走各平台 CDN（`vcover-vt-pic.puui.qpic.cn`、`pic*.iqiyipic.com`、`*img.hitv.com`、`liangcang-material.alicdn.com`），不落本地
- 任一平台接口变更或临时不可用时，只有对应那一行显示「加载失败 + 重试」，其余三行不受影响
- 影视页依赖 `/poster`：以 `file://` 直接打开 `index.html` 时这一页取不到数据，需用 `node server.js` 或部署后访问

## 跨域问题与同源代理

腾讯 LPL 接口（`lpl.qq.com`）不返回 `Access-Control-Allow-Origin`，浏览器直连必然被 CORS 拦截，
所以线上必须用**同源代理**：页面请求 `/api?u=<接口地址>`，由 Worker 转发并补上 CORS 头。

- 只放行 `lpl.qq.com`，不会被当成开放代理
- 转发时带上官方 `Referer` 与浏览器 `User-Agent`，避免被上游拒绝
- 响应缓存在浏览器 60 秒，减轻上游压力
- 前端按顺序尝试：同源 `/api` → 公共代理 → 直连；拿到 HTML（如 404 页）会自动跳过继续试下一个
- 代理逻辑都在 `worker.js` 里；影视海报的四个平台适配单独放在 `poster.mjs`，由 `worker.js` 与 `server.js` 共用

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

- 无构建步骤、无环境变量；后端只有两个入口：`worker.js` 里的 `/api` 转发与 `/poster` 影视海报
- 数据经同源 `/api` 代理获取；若官方接口变更或代理失效，页面顶部会弹出失败提示，日历其余功能不受影响
- 本地以 `file://` 打开时 `/api` 不可用，会自动退到公共代理（可能较慢或失败），建议用 `node server.js` 预览
- 本地服务器 `server.js` 与线上 `worker.js` 的 `/api` 逻辑保持一致（同样的白名单、请求头、CORS）
- 战队表加载失败时自动降级为纯文字队名，队徽位置留空
