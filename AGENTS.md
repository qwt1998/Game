# 开发说明（给 AI 助手）

仓库主人不写代码，通过 AI 迭代这个游戏。请用中文沟通，改完说明改了什么、怎么验证的。

## 项目结构

- 单文件游戏：`index.html`，原生 HTML/CSS/JS，无构建步骤、无依赖。唯一外部资源是 Google Fonts（加载失败有系统字体兜底）。
- 所有画面用 Canvas 2D 绘制；所有声音用 Web Audio 实时合成，不要引入图片或音频文件。

## 发布

- 仓库是公开的，`main` 分支根目录通过 GitHub Pages 发布到 <https://qwt1998.github.io/Game/>，推送后自动更新。
- Claude 上还有一份同样的版本，改完后让 Claude 用 `index.html` 更新那个链接，两边保持一致。
- 仓库公开，不要往里放密码、密钥或个人信息。

## 必须保持的约定

- **文件开头那一行外壳不要改**：`<!doctype html><html><head>…<style>…</style></head><body>` 到 `</body></html>` 是 Claude Artifact 的固定格式。保持原样，Claude 才能把这个文件直接发布回同一个链接：<https://claude.ai/artifact/FTjmnJ6vQMNN4nr5QSYrYA>
- 页面自己的 `<title>`、`<meta name="claude:viewport-fit-sides">` 和 `<style>` 放在 `<body>` 开头，保持这个顺序。
- 界面文字用简体中文。
- 同时支持键盘（方向键 / WASD / 空格 / P / M）和手机触控（滑动 + 底部按键），手机宽度约 400px 时不能出现横向滚动。
- 声音必须在玩家点击后才启动（浏览器限制），静音设置要继续生效。

## 代码地图（都在 `<script>` 里）

| 想改的东西 | 去哪里找 |
|---|---|
| 一局时长、车速、换电价格、罚款、医药费、修车费 | 脚本开头的常量：`DAY`、`SPEED`、`SWAP_COST`、`FINE`、`MEDICAL`、`REPAIR_PER` |
| 午高峰时间段 | `PEAK_A`、`PEAK_B`（单位：游戏分钟，从 11:00 起算） |
| 道路 | `street(...)` 调用、`MAIN_ROWS`、施工路段列表 |
| 店铺、小区、写字楼等地点 | `PLACE_DEFS`（类型、名字、所占街区、门口坐标） |
| 车道、红绿灯 | `LANES`、`lightPhase()` |
| 配送费、截止时间 | `spawnPin()`、`atDoor()` |
| 撞车惩罚 | `crash()` |
| 逆行和交警 | `isWrongWay()`、`caught()`、`updatePolice()` |
| 结算评级和点评 | `endGame()` |
| 背景音乐 | `Sound` 模块里的 `PROG`（和弦）、`HOOK`（主旋律）、`stepAt()`（编曲） |
| 音效 | `Sound` 模块里的 `FX` |

## 怎么验证

- 用浏览器打开 `index.html`，开一局，看控制台没有报错。
- 分别在桌面宽度和约 400px 的手机宽度下看一眼布局。
- 改了玩法数值的，跑完一整局（约 2 分半）看结算是否合理。
