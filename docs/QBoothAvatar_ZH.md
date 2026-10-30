# QBooth Avatar：构建配方

其他语言版本：QBoothAvatar_EN.md（English）、QBoothAvatar_ID.md（Bahasa Indonesia）。

本文说明 QBooth Avatar 是怎么搭建的、运行在什么之上、如何获取云端 API 密钥，以及如何从零重新构建它。
写法上力求让开发者或 AI 代理能够一步一步复现。应用状态：2026 年 10 月 30 日，版本 0.2（`package.json` 名称
`qbooth-avatar-overlay`）。

QBooth Avatar 是一个 Windows 桌面应用：一个**站在 Q-Booth 正在运行的活动画面之上的 3D 角色**。它迎接客人、
用语音和客人交谈、引导客人走完 Q-Booth 自己的各个画面（欢迎、模板选择、相机、预览、结果），并在客人要求时替他们
按下 Q-Booth 的按钮（"ayo foto"＝来拍照吧、"yang kedua"＝第二个、"foto"＝拍照、"ulang"＝重拍、"proses"＝处理、
"cetak"＝打印、"QR"）。所有操作都通过 **Q-Booth Local API** 完成。它没有自己的相机、实时取景或画面：一切显示都由
Q-Booth 负责，助手只负责说话和按按钮。

一切都运行在拍照亭的电脑上。唯一可选的云端部分是 AI 大脑（Google Gemini、OpenRouter）和 Gemini Live（实时语音）。
第 7 节说明如何获取它们的 API 密钥。

> 历史：早先的“完整版”应用（自带相机及 Canon/Nikon/Sony 桥接、Automation 模式、模板卡片）位于
> `_SOURCE\ASSISTANT`。它已于 2026-10-30 退役并删除；由这个叠加层（overlay）应用取代。

---

## 1. 技术栈一览

| 层 | 内容 | 使用的版本 | 为什么选它 |
|---|---|---|---|
| 桌面外壳 | Electron | 45.1 | 单个 exe；透明、始终置顶的窗口；在内部运行 Node 服务器 |
| 打包工具 | @electron/packager | 20.3 | `--no-asar`：代码保持为普通文件，便于就地打补丁 |
| 服务器 | Node.js，原生 `http` + `ws`（无框架） | Node 22，ws 8.22 | 小巧，无需构建步骤 |
| 3D | three.js + @pixiv/three-vrm | three 0.186，three-vrm 3.5.5 | VRM 形象（0.x 和 1.0）：表情、视线跟随、弹簧骨骼 |
| 文本转语音 | Piper（本地，神经网络） | 2023.11.14-2 | 在 CPU 上很快；印尼语 `id_ID-news_tts-medium`，普通话 `zh_CN-huayan-medium` |
| | Windows 语音 | SAPI（Zira、David）和 OneCore（`winrt`：Andika、Kangkang） | 英语语音；来自 Windows 语言包的印尼语 / 普通话男声 |
| 语音转文本 | whisper.cpp `whisper-server` | b5454，CPU/BLAS 版 + CUDA 12.4 版 | 印尼语/英语/普通话识别准确 |
| | NVIDIA GPU 上的模型 | `ggml-large-v3-turbo-q5_0.bin`（547 MB） | 测试中约 2 % 的词错误率 |
| | CPU 上的模型 | `ggml-small-q5_1.bin`（181 MB） | 没有 NVIDIA GPU 也能用 |
| 本地 LLM | llama.cpp `llama-server` | b11982，Vulkan 版 | 通过 Vulkan 支持任何 GPU（NVIDIA/AMD/Intel），或使用 CPU |
| | 模型 | `Qwen3.5-0.8B-Q8_0.gguf`（774 MB） | 不到 1 GB；即使在 CPU 上也很快；明确的指令本来就在代码中路由 |
| 云端 LLM（可选） | Gemini、OpenRouter | 兼容 OpenAI 的 chat 端点 | 闲聊更聪明；本地 LLM 作为备用 |
| 实时语音（可选） | Gemini Live | WebSocket `BidiGenerateContent`，模型 `gemini-3.8-live` | 直接听、直接用语音回答，并支持工具调用 |

调优所用机器：Windows 11 笔记本，Intel i7-13700HX，RTX 4060 Laptop（8 GB），Intel UHD 集成显卡。
它也可以**在没有独立显卡的情况下**运行（CPU 语音识别，LLM 跑在 CPU 上）：此时 0.8B 模型约 1 秒内作答。

---

## 2. 整体如何协作

```
 ┌──────────── QBooth Avatar.exe (Electron) ─────────────────────────────────────────────┐
 │ overlay window: whole screen, transparent, frameless, always on top, cut to the       │
 │ character's outline (win.setShape) so Q-Booth stays visible and touchable around it   │
 │                                                                                         │
 │  page (Chromium)                       Node server (same process)  :3920               │
 │   avatar.js  three-vrm, gestures        ├─ /speak  → tts.js  → Piper / Windows voices   │
 │   mic.js     voice detection            ├─ /listen → stt.js  → whisper-server :3921     │
 │   main.js    loop, tap/hold, buttons    ├─ /chat   → chat.js → llama-server   :3922     │
 │   brain.js   what to say per screen     │                      or Gemini / OpenRouter   │
 │   layout.js  placing char + buttons     ├─ /live   → live.js → Gemini Live (WSS)        │
 │   settings.js, avatar-editor.js         ├─ /qb/*   → Q-Booth Local API :8730 (password  │
 │   boot.js    start-up + downloads       │            added on the server)               │
 │                                         ├─ /app/*  → window shape, layout, pick a file  │
 │                                         └─ /settings*, /avatars, /services, /config.json│
 └─────────────────────────────────────────────────────────────────────────────────────────┘
          ▲ guest: mic in, speaker out                       Q-Booth (its own kiosk window)
```

- **页面**就是全部用户界面。它只和自己的服务器通信（`http://127.0.0.1:3920`）；机密信息（API 密钥、Local API
  密码、设置 PIN 码）永远不会到达页面（`/config.json` 经过过滤）。
- **服务器**由 Electron 主进程启动（`electron/main.js` 导入 `server.js`）。它也可以单独运行
  （`node server.js [--mock]`），并在浏览器中打开用于开发；此时没有叠加窗口。
- **AI 服务器**（whisper、llama、Piper）是运行在固定本地端口上的子进程。由服务器负责启动、监控和停止它们。

---

## 3. 目录结构

```
QBoothAvatar/
  package.json            dependencies, scripts (start, mock, app, app:mock, build)
  config.example.json     every setting with its default (read first)
  config.json             the owner's overrides only (not in git; next to the exe when packaged)
  server.js               HTTP + WebSocket server, routes, start/stop of everything
  config.js               loads config.example.json + config.json (deep merge), config paths
  setup.js                first start from source: downloads missing tools and models
  services.js             starts whisper-server and llama-server, GPU detection, health
  tts.js                  text to speech: clips → cache → Piper / Windows voices / OmniVoice
  pronounce.js            pronunciation lexicon (Q-Booth → Kyubuth, QR → kyu ar, …)
  stt.js                  speech to text: vocabulary prompt per screen, hallucination filter
  chat.js                 conversation: system prompt, tools, intent router, talk levels, LLMs
  persona.js              5 personalities (style text + voice speed)
  live.js                 Gemini Live proxy (/live): setup, voices, tools
  settings.js             editable fields, read/save, Local API connect/run/stop, LLM test
  mock-qbooth.js          a fake Q-Booth Local API for testing (port 8739)
  openrouter-login.js     "Log in with OpenRouter" (OAuth PKCE), saves the key
  avatar-info.js          reads a VRM's name/author/licence/thumbnail
  listen.js               listen with retry (a closing old copy may still hold the port)
  electron/main.js        overlay window, shortcuts, watchdogs, file dialog, quit
  public/                 the page (no build step, ES modules + import map)
    index.html            import map: three, three/addons, @pixiv/three-vrm
    main.js               wiring: polling, tap / hold, hands-free loop, Live, buttons, shape
    layout.js             placing mode: drag the character and each button, − / +
    avatar.js             VRM loading, idle motion, gestures, thinking pose, outline box
    avatar-editor.js      colours, glasses, model gallery, voice gender
    voice.js              audio playback, lip sync, per-sentence prefetch, Live PCM
    mic.js                microphone, voice detection, WAV encoding, sensitivity
    brain.js              what to say when Q-Booth's screen changes
    lines.js              every fixed spoken line and UI label: id / en / zh
    boot.js               start-up screen (downloads, steps, progress)
    settings.js           settings screen in tabs (id / en / zh labels)
    live.js, qbooth.js    Gemini Live client; Local API client (through /qb/*)
    avatars/              8 VRM models + avatars.json (names, genders)
    voice/                pre-rendered clips of the fixed lines (female voice)
  tools/                  binaries, not in git (downloaded on the first start)
  models/                 model files, not in git (downloaded on the first start)
  cache/tts/              rendered speech (wav), reused
  logs/                   app.log, stt.log, llm.log
  dist/                   the packaged app
```

---

## 4. 从零构建

### 4.1 前提条件

- Windows 10/11 x64。
- Node.js 22（自带 npm）。
- 首次启动时需要联网（约 1.1 GB 的工具和模型），或者从便携版中复制一份 `tools/` 和 `models/`。
- 可选：装有较新驱动的 NVIDIA GPU（CUDA 12 运行库已包含在 whisper 的 CUDA 版中）。任何支持 Vulkan 的 GPU
  都可用于 LLM；但 GPU 不是必需的。

### 4.2 Node 项目

```bash
npm init -y            # then set "type": "module", "main": "electron/main.js"
npm install three@0.186 @pixiv/three-vrm@3.5 ws@8
npm install -D electron@45 @electron/packager@20
```

服务器把 `node_modules/three/` 提供在 `/vendor/three/`，把 three-vrm 的模块文件提供在 `/vendor/three-vrm/`，
因此页面无需打包工具，通过 import map 即可导入它们。

### 4.3 程序和模型：首次启动时下载（`setup.js`）

源码中不包含 `tools/` 或 `models/`。首次启动时，`setup.js` 会在 AI 服务器启动之前，逐个下载配置所用但缺失的文件；
启动画面会显示进度。

| 存放位置 | 内容及来源 | 大小 |
|---|---|---|
| `tools/llama/` | llama.cpp b11982 Windows Vulkan zip（`github.com/ggml-org/llama.cpp` releases） | 37 MB |
| `models/Qwen3.5-0.8B-Q8_0.gguf` | `huggingface.co/unsloth/Qwen3.5-0.8B-GGUF` | 774 MB |
| `tools/whisper/` | whisper.cpp b5454 `whisper-blas-bin-x64.zip`（`github.com/ggml-org/whisper.cpp`） | 21 MB |
| `models/ggml-small-q5_1.bin` | `huggingface.co/ggerganov/whisper.cpp` | 181 MB |
| `tools/piper/` | Piper 2023.11.14-2 `piper_windows_amd64.zip`（`github.com/rhasspy/piper`） | 21 MB |
| `tools/piper/<voice>.onnx(.json)` | `huggingface.co/rhasspy/piper-voices`（路径由语音名称推出） | 每个 60 MB |
| `tools/whisper-cuda/` + `models/ggml-large-v3-turbo-q5_0.bin` | whisper.cpp b5454 `whisper-bin-win-cuda-12.4.0-x64.zip` + Hugging Face；**仅在有 NVIDIA GPU 时，在后台下载，从下一次启动开始使用** | 653 + 547 MB |

工作方式：
- `ensureParts(cfg)` 在 `startServices()` 中、读取 GPU 列表之前运行；页面的 `boot.js` 轮询 `GET /services`
  （`setup: { state, label, step, steps, done, total, expect }`），并显示
  “下载中（仅一次）: AI 模型 (2/8) · 385 / 774 MB”。
- 下载先写入 `<file>.part`，中断后用 HTTP `Range` 请求续传；60 秒没有数据即中止；每个部件尝试 3 次。zip 用 Windows
  自带的 `tar.exe` 解压，包含 exe 的文件夹被逐个文件移入（已存在的 Piper 语音会保留）。
- 跳过的情况：纯云端大脑时的 LLM 部件（`llm.fallbackLocal: false`）、任何带 `url` 的项（服务器在别处）、应用没有
  下载源的自定义路径。
- **“已有这个文件？选择 <file>”**（桌面应用）：某个部件下载时，会出现一个按钮打开文件对话框
  （`POST /app/pick-part` → Electron `dialog.showOpenDialog`）。模型或语音文件如果与下载项类型和大小相同，就会被
  复制进来；对于程序，用户可以选择它的 release `.zip`，或现有文件夹中的 exe（整个文件夹都会被复制）。随后该下载
  被中止，其 `.part` 被删除。
- 下载失败的部件会显示在启动画面上；应用用已有的部件启动。
- `"autoDownload": false` 可关闭此功能。

从空文件夹测试：150 秒内下载 9 个部件，随后语音识别（CPU）和 LLM（GPU）使用下载的文件启动；GPU 部件随后在后台
跟进。

### 4.4 开发时运行

```bash
npm run app:mock          # the desktop app with the built-in fake Q-Booth
npm run app               # the desktop app, real Q-Booth (Local API settings in config.json)
node server.js --mock     # page + AI servers + fake Q-Booth, no overlay window
# open http://127.0.0.1:3920/?autostart=1&debug=1 in Chrome or Edge
```

`?autostart=1` 跳过“点击启动助手”画面（浏览器在播放音频前需要先点一次），`?debug=1` 显示调试面板（听到了什么 /
说了什么）并暴露 `window.assistant`。

### 4.5 打包

```bash
npm run build
# → dist/QBooth Avatar-win32-x64/QBooth Avatar.exe  (~3.4 GB with tools + models)
```

构建时排除 `dist`、`cache`、`logs` 和 `config.json`。由于使用 `--no-asar`，代码修复可以
直接复制到 `resources/app/` 中。制作便携 zip：构建到一个干净的文件夹，加上 readme，检查其中没有 `config.json`、
日志或密钥，然后用 .NET `ZipFile.CreateFromDirectory` 打包（用 `tar` 制作的 zip64 Windows 无法读取）。

---

## 5. 各部分详解

### 5.1 叠加窗口（`electron/main.js`）

- **覆盖整个显示器**（`display`），透明、无边框，`alwaysOnTop` 级别为 `screen-saver`，每 1.5 秒重新置顶一次
  （Q-Booth 打开活动时会把自己的 kiosk 窗口提到前面）。用 `showInactive()` 显示：键盘焦点留在 Q-Booth。
- **显示后以及在 1.5 秒循环中执行 `setBounds(display.bounds)`**：否则 Windows 会把无边框窗口缩小到工作区
  （1032 px 而不是 1080，位于任务栏之上）。
- **裁剪为可见部分**（`win.setShape(rects)`）：当有东西移动时（以 8 px 为步长），页面每 250 ms 向 `POST /app/shape`
  发送矩形：由骨骼算出的角色框（`Avatar.screenBox`）、思考气泡、两个按钮、语言列表、启动框。屏幕其余部分根本
  没有窗口。当设置、语言画面、形象编辑器或摆放模式打开时，形状为整个屏幕。
- **全局快捷键**（焦点在 Q-Booth，页面按键收不到）：Ctrl+Alt+Shift+S 设置，Ctrl+Alt+Shift+P 摆放，
  Ctrl+Alt+Shift+Q 退出。
- **同时只运行一个实例**（`requestSingleInstanceLock`）；启动顺序：服务器 → 窗口 → 首次绘制后（或 10 秒后）启动
  AI 服务器。
- **恢复机制**：页面进程消失 → 重新加载；10 秒无响应 → 强制崩溃并重新加载；GPU 进程消失 → 重新加载；帧看门狗
  （`window.__frames` 停滞 8 秒）→ 重启 GPU 进程。
- `screenGpu`：`auto`、`nvidia`（`force_high_performance_gpu`）、`software`（SwiftShader）。

### 5.2 布局（`public/layout.js`）

- 位置以**屏幕比例**表示：`overlay.layout = { char: { x, y, h }, lang: { x, y },
  menu: { x, y } }`，通过 `POST /app/layout` 保存。
- 首次摆放之前：使用 `overlay.side`（右下角 / 左下角）和 `overlay.size`（屏幕高度的 %）；按钮位于角色的上方两角。
- 摆放模式（Ctrl+Alt+Shift+P 或 设置 → 外观 → “摆放角色和按钮…”）：角色和每个按钮周围显示虚线框，可分别拖动，
  − / + 调整角色大小，“重置”，“完成”。

### 5.3 操作方式

| | |
|---|---|
| 点击角色 | 说话（或免手动：`listenMode` auto / wake） |
| 按住角色 5 秒 | 设置（如设了 PIN 需输入） |
| 语言按钮（地球图标） | Bahasa Indonesia / English / 中文；设了 PIN 时会要求输入（`overlay.langPin`） |
| 菜单按钮（☰） | 设置（如设了 PIN 需输入）。两个按钮都可以关闭 |
| Ctrl+Alt+Shift+S / P / Q | 设置 / 摆放 / 退出（全局） |
| F12、Ctrl+Q、D、T | DevTools、退出、调试面板、输入问题（窗口有焦点时） |

### 5.4 服务器路由（`server.js`）

| 路由 | 用途 |
|---|---|
| `GET /`，静态文件 | 页面；`/vendor/three/`、`/vendor/three-vrm/` 来自 node_modules |
| `GET /config.json` | 供页面使用的公开配置（绝不含密钥、密码或 PIN） |
| `GET /services` | 语音转文本、LLM（本地 / 云端）以及首次启动下载的状态 |
| `GET /speak?lang=&text=` | 文本的 WAV（预录片段 / 缓存 / 引擎） |
| `POST /listen?lang=` | 输入 WAV → `{ text, ms }`（词汇提示来自当前画面） |
| `POST /chat` | `{ text, lang }` → NDJSON 流：要说的句子、动作、计时 |
| `/qb/*` | 代理到 Q-Booth Local API `/api/v1/*`（Bearer 密码在服务器端添加） |
| `POST /app/shape`、`/app/layout`、`/app/pick-part` | 窗口形状、布局、“已有这个文件”的文件 |
| `GET/POST /settings`、`/settings/unlock`、`/settings/test`、`/settings/booth`、`/settings/test-llm`、`/settings/openrouter-login`、`/settings/language`、`/settings/quit` | 设置（PIN 头）、Local API 连接 / 运行 / 停止、LLM 测试、OpenRouter 登录、语言（无需 PIN）、退出 |
| `GET/POST /avatars`、`/avatar-thumb` | VRM 列表和上传、缩略图 |
| WebSocket `/live` | Gemini Live 代理（密钥留在服务器上） |

### 5.5 Q-Booth Local API

- Q-Booth：Settings → Advanced → **Local API**（Expert 模式）：打开；它在一个端口（默认 8730）上监听，并设有密码。
- 调用：`GET /api/v1/status`、`GET /api/v1/events`、`GET /api/v1/templates`、
  `POST /api/v1/<command>`，带 `Authorization: Bearer <password>`。
- status 返回当前页面（`welcome`、`templatePicker`、`camera`、`result`…）、会话、相机阶段（`liveIdle`、`counting`、
  `capturing`、`review`）、忙碌标志以及 `available` 命令。应用只提供 `available` 中存在的工具。
- 设置 → Q-Booth：地址、端口、密码 → **连接** 会填充 **活动** 列表（显示模板数量，正在运行的会被标出）；
  **运行** / **停止** 开始和结束一个活动；“应用启动时运行此活动”（`qbooth.autoStart`）会在 Q-Booth 响应后启动它
  一次（前提是当前没有活动在运行）。错误以代码形式返回（`offline`、`unauthorized`、`too_many_attempts`、
  `event_running`、`editor_open`、`dialog_open`…），并以界面语言显示。
- 在 Q-Booth 的活动编辑器中，活动的输出显示器 = 角色所在的屏幕。
- `mock-qbooth.js` 在 8739 端口实现同样的 API（`--mock` 或 设置 → 连接 → Mock（不连 QBooth 测试））。
  “连接”始终测试真实的地址字段。

### 5.6 如何引导（`public/brain.js`、`lines.js`、`chat.js`）

- **brain.js**：页面每 400 ms 轮询一次 `/qb/status`；Q-Booth 每出现一个新页面或相机阶段，就给出一句固定台词并配上
  手势（欢迎、模板选择、准备、倒计时、预览、处理中、结果）。在欢迎页闲置 → 每隔 `idleInviteSec` 发出一次邀请。
- **chat.js**：客人的话 + Q-Booth 的状态 → 交给 LLM，并只提供 Q-Booth 此刻接受的命令作为工具。工具：
  `start_session` → `session/start`，`choose_template` → `template/select`，`take_photo` → `camera/capture`，
  `retake_photo` → `camera/retake`，`process_photo` → `camera/process`，`print_photo` → `result/print`，
  `show_qr` → `result/qr`，`start_over` / `finish_session` → `session/end`。
- **代码中的意图路由**（`routeIntent`），在任何 LLM 之前执行：按语言划分的正则（`INTENTS`、`INTENTS_ZH`），“继续”
  类词语（"lanjut"、"proses"、"ayo"、"mulai"，即继续、处理、来吧、开始），与当前画面词语的模糊匹配（编辑距离），
  `START_OVER`（"mulai lagi"＝重新开始、"let's start over"）。**不跳画面**：只有在模板选择页才会选模板；在欢迎页
  说出模板名会改为开始会话。疑问和否定（"bisa cetak?"＝能打印吗？、"jangan foto dulu"＝先别拍）不算命令。数字按
  Q-Booth 卡片在屏幕上的顺序计数。
- **意图选择器**：正则漏掉的说法交给 LLM 第二个槽位（`id_slot` 1）上的一个小型 JSON-schema 分类；它绝不会自行选择
  打印或结束。
- **已路由的命令用固定台词回应**（`ACK`），无需等待 LLM（0.01 秒）。
- **价格**：小模型会编造价格，所以价格问题用固定答案回应（`PRICE`）。
- **系统提示词**：名字、性格、说话风格、语言、Q-Booth 的流程、活动信息（唯一允许提供的事实）、规则（简短的口语句子，
  绝不声称做了没做的动作，绝不说出模型或软件的名称）。它在整个对话中保持不变（提示词缓存）；拍照亭状态附在每条
  用户消息上。

### 5.7 说话风格（`talk`）

| 级别 | 提示词规则 | 句数上限 | 本地 token 预算 |
|---|---|---|---|
| `short` | 1-2 句，≤ 25 词 | 2 | 120 |
| `normal`（默认） | 2-3 句，≤ 45 词，可以反问 | 3 | 200 |
| `chatty` | 3-5 句，≤ 70 词，闲聊，总是反问 | 5 | 320 |

0.8B 模型实测平均：10 / 20 / 35 词。

### 5.8 速度

| （本地 LLM 跑在 CPU 上，i7-13700HX） | 之前 | 现在 |
|---|---|---|
| 应用打开后的第一个问题 | 5.7 秒 | 0.6 秒 |
| 一个问题 | 1-2 秒 | 约 1 秒 |
| 一个明确的命令 | 要等 LLM | 0.01 秒 |

- llama.cpp `--parallel 2 -c 12288`：槽位 0 用于对话，槽位 1 用于意图选择器，两者都有缓存。
- **提示词缓存预热**（`Chat.warm`、`warmUp`）：在启动后，以及更换语言、形象、说话风格、性格、名字或活动信息之后。
- **固定台词在启动时于后台预先合成语音**（`cache/tts`）。
- **逐句语音预取**：当前句播放时，下一句就在合成。
- Qwen 的采样参数：`top_p 0.8, top_k 20, presence_penalty 1.5`（一个 2B Q3 模型不加这些参数会陷入循环）。
- **思考提示**：从客人说完最后一个词到第一句回答之间，角色把手放到下巴上、抬头看，头旁边出现一个 "•••" 气泡
  （`setThinking`）。

### 5.9 语音转文本（`services.js`、`stt.js`、`public/mic.js`）

- whisper-server 运行在 :3921。NVIDIA GPU：CUDA 版 + large-v3-turbo（`-ac 0`）；否则 CPU 版 + small（`-ac 640`）。
  两者都用 `-l auto -bo 1 -nt -nf`（不做温度回退：遇到噪音时它曾重新解码长达 30 秒）。如果 CUDA 版日志显示
  "no GPU found"，就换成 CPU 版。
- **按画面提供词汇提示**（`SCREEN` 词语、模板名称、助手的名字）。
- **幻觉过滤**：字幕制作人员信息、"terima kasih telah menonton"（感谢观看）、中文广告语、重复的词、只有标点的输出
  （支持 Unicode：一个 `\W` 过滤器曾经把所有中文句子都丢掉了）。
- **回声过滤**只针对 4 个词以上的内容（像 "Proses." 这样的短回答曾被当作回声丢弃）。
- 页面中的语音检测：噪声底 = 最安静的 300 ms，开始 / 保持使用不同阈值，静音 1.1 秒后结束，最长 12 秒；灵敏度 1-10。
- 聆听模式：`tap`、`auto`（一直在听）、`wake`（叫到它的名字之后）。

### 5.10 声音（`tts.js`、`pronounce.js`、`public/voice.js`）

- 顺序：预录片段（`public/voice/<lang>/`，仅女声）→ 缓存 → 引擎。
- **声音跟随形象的性别**（`avatars.json`，或形象编辑器中的“声音”；`tts.voices[lang][female|male]`）：

  | | 女声 | 男声 |
  |---|---|---|
  | id | Piper news_tts | Windows OneCore "Andika"（`winrt`） |
  | en | Windows Zira | Windows David |
  | zh | Piper huayan | Windows OneCore "Kangkang" |

  未安装（缺少 Windows 语言包）→ 改用另一性别的声音，设置中会说明如何安装（Windows 设置 → 时间和语言 → 语言和区域
  → 添加该语言 → 文本转语音）。当 Gemini Live 所选声音的性别不符时，它会改用 Puck（男声）/ Kore（女声）。
- **发音**（`pronounce.js`，在合成之前）：id `Q-Booth` → Kyubuth，`QR` → kyu ar，`QRIS` → kris，photobooth →
  fotobut，template → templet，scan → sken，upload → aplod，online → onlen；zh `Q-Booth` → 丘布斯，QR → 二维码，
  QRIS → 克里斯；另加主人自己的列表（`pronunciations`，每行“写法 = 读法”）。通过用 Piper 朗读、再用 whisper
  听写回来进行检查。
- 根据正在播放的音频做口型同步（响度 + 频谱 → VRM `aa ih ou ee oh`）。

### 5.11 形象（`public/avatar.js`、`avatar-editor.js`）

- 8 个内置模型（`public/avatars/avatars.json`）：Luma（VRM 1.0 示例，pixiv）、Seed-san（VirtualCast；须署名），以及
  六个 VRoid Studio 示例模型（按其 VRM 元数据为 CC0 / 免费使用）：Fumiriya、Ren（男）、Shibu、Bibi、Vita、
  Victoria（女）。
- **VRM 0.x 的骨骼旋转要镜像**（X 和 Z），因为 `rotateVRM0` 会把它们转过来：不这样做的话 VRoid 模型会举起手臂。
- 只用程序化动画：呼吸、摇摆、眨眼、视线跟随、手势（挥手、点头、展示）、思考姿势、聆听姿势。
- 编辑器：带授权信息的模型库、颜色（肤色、头发、眼睛、衣服）、眼镜、**声音性别**；按模型保存在 `avatarStyle` 中。
  自己的 `.vrm` 文件通过“添加 VRM…”导入。

### 5.12 设置（`settings.js`、`public/settings.js`）

- 标签页：**Q-Booth、助手、AI 大脑、外观、麦克风、安全**；横屏时为侧边菜单，竖屏时为一排标签；每个标签页都无需
  滚动即可完整显示。
- 一个字段表（`FIELDS`）定义每个键的类型以及是否需要重启。只发送改动过的字段；机密信息只写不读（留空 = 保持不变）。
- 可选的**设置 PIN 码**（每次更改都带 `x-settings-pin` 头）。
- 内置测试：Local API 连接、“测试 AI 大脑”、麦克风电平表。
- 所有标签都有 id / en / zh 三种语言；服务器错误以代码返回，在页面中翻译。

### 5.13 Gemini Live（`live.js`、`public/live.js`）

- 页面打开 `ws://127.0.0.1:3920/live`；服务器用密钥打开 Google 的 `BidiGenerateContent` WebSocket（密钥永远不会到达
  页面）。
- 设置内容：模型、音频输出、声音（Kore、Aoede、Leda、Zephyr、Sulafat；Puck、Charon、Fenrir、Orus、Achird）、系统
  指令、作为函数声明的同一套工具、服务器端 VAD、开启转写。拍照亭事件以文本轮次发送，让 Live 用自己的声音说出来。
- 如果 Live 连续 4 次连接失败，就由本地模式接管；每 30 秒重试一次 Live。
- “客人可以打断”（`bargeIn`）只在使用耳麦或指向性麦克风时开启。

---

## 6. 配置参考（`config.json` 覆盖 `config.example.json`）

| 键 | 默认值 | 含义 |
|---|---|---|
| `port` | 3920 | 页面服务器（语音转文本 3921，LLM 3922） |
| `mock` | false | 内置的模拟 Q-Booth |
| `qbooth.host / port / password` | 127.0.0.1 / 8730 / "" | Q-Booth Local API |
| `qbooth.eventId / autoStart` | "" / false | 设置中运行的活动；启动时自动运行它 |
| `language / askLanguage` | en / true | `id`、`en`、`zh`；启动时的语言选择画面 |
| `assistantName / persona / talk / eventInfo` | Luma / ceria / normal / "" | 它是谁、怎么说话、说多少、可以讲什么 |
| `pronunciations` | "" | 自定义发音行 |
| `avatar / avatarStyle` | avatars/sample.vrm / {} | 模型；每个模型的颜色、眼镜、声音性别 |
| `overlay.side / size / layout` | right / 70 / null | 初始角落、屏幕高度的 %、摆放后的位置 |
| `overlay.menuButton / langButton / langPin` | true / true / true | ☰ 和地球按钮；地球按钮要求 PIN |
| `display / screenGpu` | 0 / auto | 哪个屏幕；由谁绘制角色 |
| `listenMode / micDevice / micSensitivity / saveRecordings` | tap / "" / 5 / false | 聆听 |
| `idleInviteSec / pollMs` | 30 / 400 | 邀请间隔；状态轮询 |
| `llm.provider` | local | `local`、`gemini`、`openrouter`、`gemini-live` |
| `llm.fallbackLocal` | true | 为云端大脑保留本地 LLM 作为备用 |
| `llm.gemini.apiKey / model` | "" / gemini-3.5-flash | Gemini（第 7.1 节） |
| `llm.openrouter.apiKey / model` | "" / google/gemini-2.5-flash | OpenRouter（第 7.2 节） |
| `llm.live.model / voice / bargeIn` | gemini-3.8-live / Kore / false | Gemini Live（使用 Gemini 密钥） |
| `llm.model / ctx / device` | models/Qwen3.5-0.8B-Q8_0.gguf / 12288 / auto | 本地 LLM |
| `stt.*` | CPU small；GPU large-v3-turbo | 语音转文本 |
| `tts.voices / tts.piper / tts.sapi` | 见 5.10 | 按语言和性别划分的声音 |
| `autoDownload` | true | 首次启动下载（4.3） |
| `settingsPin` | "" | 保护设置 |

`config.json` 中保存着 Local API 密码和 API 密钥：不要放进 git、截图或共享的软件包中。

---

## 7. 获取云端 API 密钥

应用靠本地 AI 即可完全离线工作。云端大脑在闲聊方面回答得更好，但需要 API 密钥。密钥粘贴在 **设置 → AI 大脑**
中（按住角色 5 秒，或按 Ctrl+Alt+Shift+S），只保存在那台电脑的 `config.json` 中，之后不再显示（该字段显示
“已保存（留空则不变）”）。

| 大脑（设置 → AI 大脑 → “运行在”） | 密钥来源 | 说明 |
|---|---|---|
| Gemini（云端，Google） | Google AI Studio | 免费层有每日限额；活动时请开通计费 |
| OpenRouter（云端） | OpenRouter | 一个密钥用于多个模型；用 credits 按量付费 |
| Gemini Live（实时语音，云端） | **同一个 Google AI Studio 密钥** | OpenRouter 密钥不能用于 Live |
| 这台电脑（离线） | 无 | 默认 |

### 7.1 Google Gemini API 密钥（Google AI Studio）

1. 在浏览器中打开 **https://aistudio.google.com/apikey**，用 Google 账号登录（使用应当承担账单的企业账号）。
2. 第一次使用：接受服务条款。AI Studio 随后会为你创建一个默认的 Google Cloud 项目。（已有 Google Cloud 的用户也可以
   改用 **Dashboard → Projects → Import projects**（导入项目）来选择现有项目。）
3. 点击 **Create API key**（创建 API 密钥），选择项目并创建。复制密钥（一长串字符；要像密码一样对待）。
4. 建议：在 API Keys 页面上，在密钥的 **Unrestricted**（无限制）标签旁，点击 **Add restrictions → Restrict to
   Gemini API only → Restrict key**（添加限制 → 仅限 Gemini API → 限制密钥）。Google 在某些情况下会拒绝或封锁
   无限制的密钥，而且受限的密钥即使泄露也更安全。
5. 在 QBooth Avatar 中：**设置 → AI 大脑 → 运行在：Gemini（云端，Google）**，把密钥粘贴到 **API 密钥** 中，保留模型
   `gemini-3.5-flash`（或其他 Gemini 模型名），保持 **“云端失败时使用本地 AI”** 开启，按 **测试 AI 大脑**，然后
   **保存**。
6. 使用 **Gemini Live**：选择 **运行在：Gemini Live（实时语音，云端）**；使用同一个密钥字段。选择一个声音；除非客人
   对着耳麦或指向性麦克风说话，否则让“客人可以打断”保持关闭。

**免费层和计费。** 新项目处于 Free Tier（免费层）：不花钱，但每个模型的每分钟和每天请求限额都很小（见 AI Studio 中
项目的速率限制页面），在繁忙的活动中可能会用完；此时应用改用本地 AI 回答，并显示 "quota / 429" 警告。用于活动时：
1. 在 AI Studio 中打开 **API keys** 或 **Projects**，在项目的 *Billing Tier* 列中点击 **Set up billing**（设置计费）。
2. 选择国家，确认联系信息和付款方式。
3. 付款方式选 **Prepay**（预付：在 AI Studio 的 Billing 页面购买 credits：**Buy credits**（购买 credits），最低
   $5；余额为 $0 时请求会以 HTTP 402 失败；可开启自动充值）或 **Postpay**（后付：按月扣费），以 AI Studio 提供的
   为准。
4. 关联计费账号后，项目几乎立即升到 **Tier 1**（更高限额）。在 Google Cloud 控制台中设置计费提醒。

在付费层，Google 不会用提示词和回答来改进其产品；在免费层，请查看当前条款。无论哪种情况，客人的话都会发送给
Google：如果活动需要，请事先告知。

如果密钥泄露：创建一个新密钥，放入应用，然后在 AI Studio 中删除或停用旧密钥，并检查用量。

### 7.2 OpenRouter API 密钥

OpenRouter 用一个账号、一个密钥就能使用来自多家提供商（Google、OpenAI、Anthropic、Meta 等）的模型。把密钥放进应用
有两种方式：

**A. “用 OpenRouter 登录”（最简单，在应用内完成）**
1. 设置 → AI 大脑 → 运行在：**OpenRouter（云端）** → **用 OpenRouter 登录**。
2. 浏览器打开 OpenRouter 的登录页面；登录（或创建账号）并批准 "QBooth Avatar"。用这种方式生成的密钥在你的 Keys
   列表中标记为 "QBooth Avatar"。
3. 应用自行接收密钥（在一次性本地回调上使用 OAuth PKCE），并显示“✓ 已连接，密钥已保存”。按 **测试 AI 大脑**，然后
   **保存**。

**B. 手动创建密钥**
1. 在 **https://openrouter.ai** 登录并打开 **https://openrouter.ai/settings/keys**（Keys）。
2. 点击 **Create Key**（创建密钥），起个名字（例如 "QBooth Avatar – booth 1"），并**设置 credit 上限**（OpenRouter
   建议每个密钥都设上限：否则泄露的密钥可能花光全部余额）。
3. 复制密钥（以 `sk-or-v1-` 开头；只显示一次）。
4. 把它粘贴到 设置 → AI 大脑 → **API 密钥**，设置 **模型**（默认 `google/gemini-2.5-flash`；
   https://openrouter.ai/models 上的任何模型 id 都可以），按 **测试 AI 大脑**，然后 **保存**。

**Credits。** 付费模型需要 credits：**https://openrouter.ai/settings/credits** → 用银行卡充值 credits（也支持加密
货币；可开启自动充值；购买时收取少量手续费，推理调用本身不加价）。未使用的 credits 可在 24 小时内退款。免费模型
（id 以 `:free` 结尾）不需要 credits，但总共每天限 50 次请求（购买至少 10 credits 后为每天 1000 次）：对活动来说
太少。

如果密钥泄露：在 https://openrouter.ai/settings/keys 删除它并创建一个新的。OpenRouter 也会扫描 GitHub 上暴露的
密钥，并发邮件通知所有者。

### 7.3 Q-Booth Local API 密码

它不是云端密钥，但设置方式相同：Q-Booth → Settings → Advanced → **Local API**（Expert 模式）→ 打开，记下端口和
密码 → QBooth Avatar 设置 → Q-Booth → 地址（同一台电脑上为 127.0.0.1）、端口、密码 → **连接**。

### 7.4 密钥规则

- 绝不要把密钥放进 git、截图、视频或共享的软件包中。便携版和源码副本在分享前都会检查这一点（里面不能有
  `config.json`）。
- 每台拍照亭电脑使用单独的密钥（或设置 credit 上限），以便可以单独吊销。
- 保持“云端失败时使用本地 AI”开启：场地网络会断。

---

## 8. 经验教训（从一开始就这样做）

1. **绝不信任小模型去执行动作**：明确的命令在代码中路由，给每个工具结果一个 `next` 提示，在提示词中禁止声称做了
   动作，用固定台词回答价格。
2. **不跳画面**：只对 Q-Booth 当前显示的画面发出命令（`available`）。
3. **延迟**：固定的提示词前缀 + 缓存预热、两个 llama 槽位、固定台词预先合成语音、逐句语音预取、whisper 不做温度
   回退。
4. **叠加窗口**：用 `setShape` 实现点击穿透，显示后执行 `setBounds`（工作区缩小问题），反复重新置顶，
   `showInactive`（绝不抢 Q-Booth 的焦点），全局快捷键。
5. **VRM 0.x 需要镜像骨骼旋转。**
6. **听觉**：支持 Unicode 的过滤器，回声过滤只针对长句，画面词汇。
7. **Kiosk 稳健性**：单实例、端口重试、按路径结束残留的 AI 服务器（`Get-Process`；在测试笔记本上 WMI 要花一分钟）、
   看门狗。
8. **机密信息**只存在服务器上；页面拿到的是过滤后的配置；软件包要经过扫描。
9. **大文件靠下载，不随源码一起发布**，支持续传和“已有这个文件”。
10. **无硬件测试**：模拟 Local API，用 DevTools 驱动的无头 Chrome 截图；测试时绝不在主人正在工作的屏幕上打开应用
    窗口。

---

## 9. 测试方法（没有拍照亭，也没有屏幕）

1. `node server.js --mock`（或一份使用自己 `config.json` 端口的副本）。
2. 无头 Chrome 加上 `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream
   --autoplay-policy=no-user-gesture-required --remote-debugging-port=…`，打开
   `/?autostart=1&lang=id&debug=1`。
3. 驱动它：`fetch('/qb/session/start', {method:'POST'})`、`/qb/status`、`window.assistant`、
   `window.__qba.settings()`；用 `Page.captureScreenshot` 截图（把 `Emulation.setDefaultBackgroundColorOverride`
   设为透明，以便叠加到 Q-Booth 画面上合成）。
4. 意图测试：用每种语言中没见过的说法编写 `routeIntent` 单元测试脚本。
5. 结束后停止服务器和 AI 服务器，并检查端口已释放。

无头 Chrome 使用软件 GPU：打包后的叠加层也要在目标电脑上测试。

---

## 10. 状态和已知问题（2026-10-30）

已可用并经过无头测试：Local API 流程（mock）、意图路由（id / en / zh）、说话风格、思考提示、设置标签页、语言按钮 +
PIN、摆放、形象编辑器和声音性别、首次启动下载（从空文件夹、续传、“已有这个文件”）、便携包。

待解决：
- 真实 Electron 叠加层覆盖在运行中的 Q-Booth 活动上、真实麦克风，以及“已有这个文件”的文件对话框，都还没有由主人
  在拍照亭电脑上测试过。
- 印尼语 / 普通话男声需要 Windows 语言包（测试笔记本上未安装：改由女声说话）。
- Gemini 免费层限额很小；活动时请使用已开通计费的密钥。
