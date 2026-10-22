# 开发说明（给 AI 助手）

仓库主人不写代码，通过 AI 迭代这个游戏。请用中文沟通，改完说明改了什么、怎么验证的。

## 工作流程（每次改动都照这个来）

1. 先拉取 `main` 的最新代码，读完本文件再动手。一切以仓库里的最新代码为准，不要根据聊天记录或旧附件改代码。
2. 小改动直接做；需求不清楚，或者会大改玩法、画面时，先用一两句话说清打算怎么改，等仓库主人确认再动手。
3. 修改 `index.html`，遵守下面"必须保持的约定"。
4. 运行 `python3 3d/make.py`，让 3D 试玩版跟着更新（见"项目结构"）。然后按"怎么验证"一节验证。
5. 直接在 `main` 分支上提交并推送，不要新建分支或开合并请求（PR），除非仓库主人另有要求。提交说明用中文写清改了什么。
6. 用同一份 `index.html` 更新 Claude 上的副本（见"发布"）。
7. 按"改完怎么汇报"一节回复。

## 规矩

- 删除文件、改仓库设置（公开/私有、Pages）、改写版本历史（比如强制推送），先问仓库主人。
- 只改要求的内容，不要顺手加没要求的功能；有好点子可以提出来让仓库主人选。
- 别用技术黑话，非用不可的词顺便解释一句。

## 项目结构

- 单文件游戏：`index.html`，原生 HTML/CSS/JS，无构建步骤、无依赖。唯一外部资源是 Google Fonts（加载失败有系统字体兜底）。
- 所有画面用 Canvas 2D 绘制（3D 试玩版例外，见下面）；所有声音用 Web Audio 实时合成，不要引入图片或音频文件。
- 例外：下面这几个文件只用来"添加到手机桌面"（网页应用，PWA），游戏本身不依赖它们，不要删：
  - `manifest.webmanifest`：桌面名字"跑单王"、图标、全屏打开。
  - `sw.js`：离线用。先联网取最新版，断网才用存下的副本，所以平时改 `index.html` 不用动它；新增需要离线的文件时，加进它的 `FILES` 列表，并把 `CACHE` 里的版本号加一。
  - `icons/`：桌面图标。`icons/icon.html` 用 Canvas 画出图标，改图标就改这个文件，再导出同名的 `icon-512.png`、`icon-192.png`、`apple-touch-icon.png`（180×180）替换旧图。
- `server/`：排行榜程序，跑在仓库主人自己的 Vultr 服务器上（新加坡，Ubuntu 24.04），不在 GitHub Pages 上运行，游戏离了它也照常能玩。
  - `server/leaderboard.py`：只用 Python 自带功能的小网页服务，成绩存在服务器的 SQLite 文件里。收成绩 `/api/sync`，取前 20 名 `/api/top`。
  - `server/install.sh`：一键安装和更新，用 Caddy 配加密连接（https）。没有域名时用"IP.sslip.io"当网址。
  - 游戏里的 `BOARD_URL` 是排行榜地址，空着就不显示排行榜。服务器的登录信息不进仓库，也不要向仓库主人要。
- 3D 试玩版（`qwt1998.github.io/Game/3d.html`）：玩法、按键、记录、排行榜和正式版完全一样，只有地图画成斜着看的 3D 城市。
  - `3d.html` 是**生成出来的**，不要手改。它由 `3d/make.py` 照着 `index.html` 生成，只在几个固定的地方做了替换。**每次改完 `index.html` 都运行一次 `python3 3d/make.py`**，再一起提交，两个版本才会一致。`make.py` 找不到要替换的地方时会报错停下，这时改 `make.py` 里对应的那一行。
  - `3d/scene.js`：3D 画面（Three.js），以及悬在 3D 城市上的店名、配送费气泡、"我"字标记等平面文字。
  - `vendor/three-lite.js`：只挑出用到的部分、压缩过的 Three.js（MIT 许可，版权声明在文件末尾）。放在仓库里是为了国内也能打开，不要改成从国外网站加载。`scene.js` 要用 Three.js 的新东西时，先加进 `3d/three-entry.js`，再按那个文件开头写的命令重新生成。
  - 3D 试玩版只在 GitHub Pages 上能打开（直接双击文件打不开），也不发布到 Claude 副本。

## 发布

- 仓库是公开的，`main` 分支根目录通过 GitHub Pages 发布到 <https://qwt1998.github.io/Game/>，推送后自动更新。
- Claude 上还有一份同样的版本：<https://claude.ai/artifact/FTjmnJ6vQMNN4nr5QSYrYA>。改完后用同一份 `index.html` 更新这个链接，两边保持一致。当前环境更新不了的话，在汇报里说明，不要另建新链接。Claude 副本只需要 `index.html`；"添加到桌面"只在 GitHub Pages 上生效，页面被嵌在别的网页里（比如 Claude 预览）时会自动跳过。
- 仓库公开，不要往里放密码、密钥或个人信息。
- 改了 `server/` 里的东西：推送后，请仓库主人在 Vultr 后台的服务器控制台里再运行一次安装命令 `curl -fsSL https://qwt1998.github.io/Game/server/install.sh | bash`，就会更新到最新版，成绩不会丢。只改 `index.html` 不用动服务器。

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
| 车流（给骑手让行；骑手出事故或被交警拦下时，后面的车排队等） | `updateCars()` |
| 导航线（箱子里有单时，指向最快要超时的那一单；不逆行、绕开施工） | 路线在 `navRoute()`；正式版画在 `drawNav()`，3D 版在 `3d/scene.js` 的 `navDots()`；暂停页开关 `navToggle`（存在浏览器的 `lunch-rush-nav` 里） |
| 配送费、截止时间 | `spawnPin()`、`atDoor()` |
| 撞车惩罚 | `crash()` |
| 逆行和交警 | `isWrongWay()`、`caught()`、`updatePolice()` |
| 结算评级和点评 | `endGame()`；暂停页"结束这局，保存成绩"按钮（`endBtn`）调用 `endGame(true)`，算"提前收工" |
| 排行榜（地址、上传成绩、补传、排行榜页面） | `Leaderboard` 一段（`BOARD_URL`、`syncRider()`），排行榜页面在 `openBoard()`；服务器那边在 `server/leaderboard.py`（上限 `MAX_BEST`、频率限制 `RIDER_GAP`、`IP_PER_HOUR`） |
| 骑手名字和本机成绩（最好、局数、累计、准时率、最近 10 局） | `Riders` 一段（`newRider()`、`loadRiders()`，存在浏览器的 `lunch-rush-players` 里），开始页显示在 `refreshRider()`，一局结束时在 `endGame()` 里记账 |
| 手机触控按键（左下刹车、右下圆形方向盘，按住滑动也能转向） | HTML 里的 `#pad`；样式 `.pad`、`.dpad`（横屏在 `orientation:landscape` 那段）；手势 `padDir()`、`padSteer()` |
| 背景音乐 | `Sound` 模块里的 `PROG`（和弦）、`HOOK`（主旋律）、`stepAt()`（编曲） |
| 音效 | `Sound` 模块里的 `FX` |
| 添加到桌面（接上图标、离线、桌面名字） | 脚本开头的 `APP_HOST` 一段，以及 `manifest.webmanifest` |
| 开始页"想放到手机桌面"的提示 | `Home-screen tip` 一段（`installTip`） |

## 怎么验证

- 检查 `<script>` 里的脚本有没有语法错误。
- 用无头浏览器打开 `index.html`，开一局，确认控制台没有报错。
- 截图看两种宽度的画面：约 400px 的手机宽度和桌面宽度。
- 改了玩法数值的，跑完一整局（约 2 分半）看结算是否合理。
- 改了添加到桌面相关的东西（`manifest.webmanifest`、`sw.js`、`icons/`、`APP_HOST` 一段）的：用本地网页服务器打开（直接双击文件不算数），确认图标和这几个文件都能加载、浏览器没有报"不能安装"，断网后刷新还能打开。
- 3D 试玩版：用本地网页服务器打开 `3d.html`（无头浏览器加 `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` 才有 3D），开一局截图，确认控制台没有报错、地图上的文字和 3D 物体对得上。软件渲染很慢，游戏时间会走得比实际慢，属正常。
- 改了排行榜的：在本机用 `PAODAN_DB=临时文件 PAODAN_PORT=8799 python3 server/leaderboard.py serve` 跑一个测试排行榜，把游戏副本里的 `BOARD_URL` 临时指向 `http://127.0.0.1:8799` 测（不要把这个测试地址提交进仓库）。要测到：正常上传、造假成绩被拒、名字里的符号按文字显示、排行榜连不上时游戏照常能玩。改了 `install.sh` 的至少跑 `bash -n` 检查语法。

## 改完怎么汇报

用大白话回复仓库主人：

- 改了什么
- 怎么验证的
- 哪些没法验证（比如音乐好不好听，需要仓库主人自己听）
- 在线链接：<https://qwt1998.github.io/Game/>（推送后 1～2 分钟更新）
- 改坏了怎么回退：说清能回到哪个版本（给出改动前的提交编号和说明），以及怎么回
