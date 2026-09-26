# LOL 赛事日历

一个纯静态的《英雄联盟》赛事月历网页：把 LPL 官方赛程按日期铺进日历，点任意日期弹出当天全部对局详情。

- 无框架、无构建、无依赖，三个文件（`index.html` / `index.css` / `index.js`）直接打开即可运行
- 数据实时拉取腾讯 LPL 官方接口，不落库、不缓存
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

## 数据源

全部为腾讯 LPL 官方公开接口：

| 接口 | 用途 |
|---|---|
| `LOL_SGameList_Info.js` | 赛事列表，填充顶部下拉框 |
| `LOL_MATCH2_MATCH_HOMEPAGE_BMATCH_LIST_{sGameId}.js` | 指定赛事的全部对局 |
| `LOL_MATCH2_TEAM_LIST.js` | 战队表，按 `TeamId` 取队徽与官方简称（只请求一次并缓存） |

## 目录结构

```
lolgame/
├── index.html   页面结构
├── index.css    样式（主题变量、日历、抽屉、提示）
├── index.js     接口请求、数据处理、渲染与交互
└── README.md
```

本地预览：双击 `index.html`，或用任意静态服务器（如 `npx serve .`）。

## 部署到 Cloudflare Pages（在线，无需命令行）

全程在 Cloudflare 仪表盘操作，两种方式任选。

### 方式一：连接 Git 仓库（推荐，推送即自动部署）

1. 把项目推到 GitHub / GitLab（三个文件直接放在仓库根目录）
2. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) → 左侧 **Workers & Pages** → **Create**
3. 选 **Pages** → **Connect to Git**，授权并选择刚才的仓库
4. 构建配置按下表填写：

   | 配置项 | 值 |
   |---|---|
   | Framework preset | `None` |
   | Build command | 留空 |
   | Build output directory | `/` |
   | Root directory | 留空（仓库根目录） |

5. 点 **Save and Deploy**，等待几十秒完成，得到 `https://<项目名>.pages.dev`
6. 之后每次 `git push` 都会自动触发重新部署

### 方式二：直接上传文件（不用 Git）

1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Upload assets**
2. 给项目起名（如 `lolgame`），把 `index.html`、`index.css`、`index.js` 三个文件拖进上传区
3. 点 **Deploy**，完成后访问 `https://lolgame.pages.dev`

> 两种方式都只上传静态资源，不需要构建、不需要任何配置文件。

### 绑定自定义域名（可选）

项目页 → **Custom domains** → **Set up a custom domain**，按提示添加 DNS 记录即可，Cloudflare 自动签发 HTTPS 证书。

## 说明

- 纯静态站点，无后端、无环境变量、无构建步骤
- 接口数据由浏览器直接请求；若官方接口变更或跨域策略调整，页面顶部会弹出失败提示，日历其余功能不受影响
- 战队表加载失败时自动降级为纯文字队名，队徽位置留空
