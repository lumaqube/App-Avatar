# Avatar: the recipe

Other languages: Avatar_ID.md (Bahasa Indonesia), Avatar_ZH.md (中文).

How Avatar is built, what it runs on, how to get the cloud API keys, and how to build
it again from nothing. Written so that a developer or an AI agent can reproduce it step by
step. State of the app: 30 October 2026, version 0.2 (`package.json` name
`avatar-overlay`).

Avatar is a Windows desktop app: a **3D character that stands on top of the booth app's running
event screen**. It greets guests, talks with them by voice, guides them through the booth app's own
screens (welcome, template picker, camera, review, result) and presses the booth app's buttons for
them when asked ("ayo foto", "yang kedua", "foto", "ulang", "proses", "cetak", "QR"). Everything
goes through the booth app's **Local API**. It has no camera, live view or screens of its own: the
booth app does all the showing, the assistant only talks and presses.

Works with QBooth.exe, BleepShare.exe and XBooth.exe; the name shown comes from the connected app
(section 5.5 and the README's "Brands").

Everything runs on the booth PC. The only optional cloud parts are the AI brain (Google Gemini,
OpenRouter) and Gemini Live (real-time voice). Section 7 explains how to get their API keys.

> History: an earlier "full" app (own camera with Canon/Nikon/Sony bridges, Automation mode,
> template cards) lived in `_SOURCE\ASSISTANT`. It was retired and deleted on 2026-10-30; this
> overlay app replaces it.

---

## 1. The stack at a glance

| Layer | What | Version used | Why this one |
|---|---|---|---|
| Desktop shell | Electron | 45.1 | One exe; transparent always-on-top window; runs the Node server inside |
| Packager | @electron/packager | 20.3 | `--no-asar`: code stays plain files, easy to patch in place |
| Server | Node.js, plain `http` + `ws` (no framework) | Node 22, ws 8.22 | Small, no build step |
| 3D | three.js + @pixiv/three-vrm | three 0.186, three-vrm 3.5.5 | VRM avatars (0.x and 1.0): expressions, look-at, spring bones |
| Text to speech | Piper (local, neural) | 2023.11.14-2 | Fast on the CPU; Indonesian `id_ID-news_tts-medium`, Mandarin `zh_CN-huayan-medium` |
| | Windows voices | SAPI (Zira, David) and OneCore (`winrt`: Andika, Kangkang) | English voices; male Indonesian / Mandarin voices from Windows language packs |
| Speech to text | whisper.cpp `whisper-server` | b5454, CPU/BLAS build + CUDA 12.4 build | Accurate Indonesian/English/Mandarin |
| | Model on an NVIDIA GPU | `ggml-large-v3-turbo-q5_0.bin` (547 MB) | ~2 % word errors in tests |
| | Model on the CPU | `ggml-small-q5_1.bin` (181 MB) | Works without an NVIDIA GPU |
| Local LLM | llama.cpp `llama-server` | b11982, Vulkan build | Any GPU (NVIDIA/AMD/Intel) through Vulkan, or the CPU |
| | Model | `Qwen3.5-0.8B-Q8_0.gguf` (774 MB) | Under 1 GB; fast even on the CPU; clear commands are routed in code anyway |
| Cloud LLM (optional) | Gemini, OpenRouter | OpenAI-compatible chat endpoints | Smarter small talk; the local LLM stays as the stand-in |
| Real-time voice (optional) | Gemini Live | WebSocket `BidiGenerateContent`, model `gemini-3.8-live` | Hears and answers in voice directly, with tool calls |

Tuned on: Windows 11 laptop, Intel i7-13700HX, RTX 4060 Laptop (8 GB), Intel UHD integrated
GPU. It also runs **without a discrete GPU** (CPU speech recognition, LLM on the CPU): the
0.8B model answers in about 1 s there.

---

## 2. How it fits together

```
 ┌──────────── Avatar.exe (Electron) ────────────────────────────────────────────────────┐
 │ overlay window: whole screen, transparent, frameless, always on top, cut to the       │
 │ character's outline (win.setShape) so the booth app stays visible and touchable       │
 │                                                                                         │
 │  page (Chromium)                       Node server (same process)  :3920               │
 │   avatar.js  three-vrm, gestures        ├─ /speak  → tts.js  → Piper / Windows voices   │
 │   mic.js     voice detection            ├─ /listen → stt.js  → whisper-server :3921     │
 │   main.js    loop, tap/hold, buttons    ├─ /chat   → chat.js → llama-server   :3922     │
 │   brain.js   what to say per screen     │                      or Gemini / OpenRouter   │
 │   layout.js  placing char + buttons     ├─ /live   → live.js → Gemini Live (WSS)        │
 │   settings.js, avatar-editor.js         ├─ /qb/*   → booth app Local API :8730 (password│
 │   boot.js    start-up + downloads       │            added on the server)               │
 │                                         ├─ /app/*  → window shape, layout, pick a file  │
 │                                         └─ /settings*, /avatars, /services, /config.json│
 └─────────────────────────────────────────────────────────────────────────────────────────┘
          ▲ guest: mic in, speaker out                     the booth app (its own kiosk window)
```

- The **page** is the whole user interface. It talks only to its own server
  (`http://127.0.0.1:3920`); secrets (API keys, the Local API password, the settings PIN)
  never reach it (`/config.json` is filtered).
- The **server** is started by Electron's main process (`electron/main.js` imports
  `server.js`). It can also run alone (`node server.js [--mock]`) and be opened in a browser
  for development; there is no overlay window then.
- The **AI servers** (whisper, llama, Piper) are child processes on fixed local ports. The
  server starts, watches and stops them.

---

## 3. Folder layout

```
QBoothAvatar/           the working folder (the git repo of the source is App-Avatar)
  package.json            dependencies, scripts (start, mock, app, app:mock, build)
  config.example.json     every setting with its default (read first)
  config.json             the owner's overrides only (not in git; next to the exe when packaged)
  server.js               HTTP + WebSocket server, routes, start/stop of everything
  config.js               loads config.example.json + config.json (deep merge), config paths
  setup.js                first start from source: downloads missing tools and models
  services.js             starts whisper-server and llama-server, GPU detection, health
  tts.js                  text to speech: clips → cache → Piper / Windows voices / OmniVoice
  pronounce.js            pronunciation lexicon (QR → kyu ar, Q-Booth → Kyubuth, …)
  stt.js                  speech to text: vocabulary prompt per screen, hallucination filter
  chat.js                 conversation: system prompt, tools, intent router, talk levels, LLMs
  persona.js              5 personalities (style text + voice speed)
  live.js                 Gemini Live proxy (/live): setup, voices, tools
  settings.js             editable fields, read/save, Local API connect/run/stop, LLM test
  mock-qbooth.js          a fake booth app Local API for testing (port 8739)
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
    brain.js              what to say when the booth app's screen changes
    lines.js              every fixed spoken line and UI label: id / en / zh
    boot.js               start-up screen (downloads, steps, progress)
    settings.js           settings screen in tabs (id / en / zh labels)
    live.js, qbooth.js    Gemini Live client; Local API client (through /qb/*)
    brand.js              the booth app's name ({booth} in texts), also used by the server
    avatars/              8 VRM models + avatars.json (names, genders)
    voice/                pre-rendered clips of the fixed lines (female voice)
  tools/                  binaries, not in git (downloaded on the first start)
  models/                 model files, not in git (downloaded on the first start)
  cache/tts/              rendered speech (wav), reused
  logs/                   app.log, stt.log, llm.log
  dist/                   the packaged app
```

---

## 4. Build it from scratch

### 4.1 Prerequisites

- Windows 10/11 x64.
- Node.js 22 (npm included).
- Internet on the first start (about 1.1 GB of tools and models), or a copy of `tools/` and
  `models/` from a portable build.
- Optional: an NVIDIA GPU with a recent driver (the CUDA 12 runtime ships inside the whisper
  CUDA build). Any Vulkan GPU works for the LLM; none is required.

### 4.2 Node project

```bash
npm init -y            # then set "type": "module", "main": "electron/main.js"
npm install three@0.186 @pixiv/three-vrm@3.5 ws@8
npm install -D electron@45 @electron/packager@20
```

The server serves `node_modules/three/` at `/vendor/three/` and the three-vrm module file at
`/vendor/three-vrm/`, so the page imports them through an import map without a bundler.

### 4.3 Binaries and models: downloaded on the first start (`setup.js`)

The source has no `tools/` or `models/`. On the first start `setup.js` downloads what the
config uses and is missing, one file at a time, before the AI servers start; the start-up
screen shows the progress.

| Goes to | What, from where | Size |
|---|---|---|
| `tools/llama/` | llama.cpp b11982 Windows Vulkan zip (`github.com/ggml-org/llama.cpp` releases) | 37 MB |
| `models/Qwen3.5-0.8B-Q8_0.gguf` | `huggingface.co/unsloth/Qwen3.5-0.8B-GGUF` | 774 MB |
| `tools/whisper/` | whisper.cpp b5454 `whisper-blas-bin-x64.zip` (`github.com/ggml-org/whisper.cpp`) | 21 MB |
| `models/ggml-small-q5_1.bin` | `huggingface.co/ggerganov/whisper.cpp` | 181 MB |
| `tools/piper/` | Piper 2023.11.14-2 `piper_windows_amd64.zip` (`github.com/rhasspy/piper`) | 21 MB |
| `tools/piper/<voice>.onnx(.json)` | `huggingface.co/rhasspy/piper-voices` (path derived from the voice name) | 60 MB each |
| `tools/whisper-cuda/` + `models/ggml-large-v3-turbo-q5_0.bin` | whisper.cpp b5454 `whisper-bin-win-cuda-12.4.0-x64.zip` + Hugging Face; **only with an NVIDIA GPU, in the background, used from the next start** | 653 + 547 MB |

How it works:
- `ensureParts(cfg)` runs inside `startServices()` before the GPU list is read; the page's
  `boot.js` polls `GET /services` (`setup: { state, label, step, steps, done, total, expect }`)
  and shows "Downloading (first start only): AI brain model (2/8) · 385 / 774 MB".
- Downloads go to `<file>.part`, resumed with an HTTP `Range` request after a cut; no data for
  60 s aborts; 3 tries per part. Zips are unpacked with Windows' own `tar.exe` and the folder
  holding the exe is moved in file by file (Piper voices already there stay).
- Skipped: LLM parts for a cloud-only brain (`llm.fallbackLocal: false`), anything with a
  `url` (a server elsewhere), custom paths the app has no download for.
- **"Have it already? Choose <file>"** (desktop app): while a part downloads, a button opens a
  file dialog (`POST /app/pick-part` → Electron `dialog.showOpenDialog`). A model or voice is
  copied in if it has the same type and size as the download; for a program the user picks
  its release `.zip` or its exe inside an existing folder (the whole folder is copied). The
  download is aborted and its `.part` removed.
- A failed part shows on the start-up screen; the app starts with what it has.
- `"autoDownload": false` turns it off.

Tested from an empty folder: 9 parts in 150 s, then speech recognition (CPU) and the LLM (GPU)
started on the downloaded files; the GPU parts followed in the background.

### 4.4 Run during development

```bash
npm run app:mock          # the desktop app with the built-in fake booth app
npm run app               # the desktop app, real booth app (Local API settings in config.json)
node server.js --mock     # page + AI servers + fake booth app, no overlay window
# open http://127.0.0.1:3920/?autostart=1&debug=1 in Chrome or Edge
```

`?autostart=1` skips the "tap to activate" screen (browsers need one tap before audio),
`?debug=1` shows the debug panel (what was heard / said) and exposes `window.assistant`.

### 4.5 Package

```bash
npm run build
# → dist/Avatar-win32-x64/Avatar.exe  (~3.4 GB with tools + models)
```

The build leaves out `dist`, `cache`, `logs` and `config.json`.
Because of `--no-asar`, a code fix can be copied straight into `resources/app/`. For a
portable zip: build into a clean folder, add a readme, check that no `config.json`, logs or
keys are inside, and zip it with .NET `ZipFile.CreateFromDirectory` (a `tar`-made zip64 was
unreadable by Windows).

---

## 5. Each part in detail

### 5.1 The overlay window (`electron/main.js`)

- **Covers the whole display** (`display`), transparent, frameless, `alwaysOnTop` at the
  `screen-saver` level, re-asserted every 1.5 s (the booth app raises its kiosk window when
  an event opens). Shown with `showInactive()`: the booth app keeps the keyboard focus.
- **`setBounds(display.bounds)` after showing and in the 1.5 s loop**: Windows otherwise
  shrinks a frameless window to the work area (1032 px instead of 1080, above the taskbar).
- **Cut to what shows** (`win.setShape(rects)`): the page sends rectangles to `POST /app/shape`
  every 250 ms when something moved (8 px steps): the character's box from its bones
  (`Avatar.screenBox`), the thinking bubble, the two buttons, the language list, the boot box.
  The rest of the screen has no window at all. While settings, the language screen, the
  avatar editor or placing are open, the shape is the whole screen.
- **Global shortcuts** (the booth app has the focus, so page keys would not arrive):
  Ctrl+Alt+Shift+S settings, Ctrl+Alt+Shift+P placing, Ctrl+Alt+Shift+Q quit.
- **One copy at a time** (`requestSingleInstanceLock`); start order: server → window → AI
  servers after the first paint (or 10 s).
- **Recovery**: page process gone → reload; unresponsive 10 s → crash and reload; GPU process
  gone → reload; frame watchdog (`window.__frames` stands still 8 s) → restart the GPU process.
- `screenGpu`: `auto`, `nvidia` (`force_high_performance_gpu`), `software` (SwiftShader).

### 5.2 Layout (`public/layout.js`)

- Positions are **screen fractions**: `overlay.layout = { char: { x, y, h }, lang: { x, y },
  menu: { x, y } }`, saved through `POST /app/layout`.
- Before the first placing: `overlay.side` (right / left bottom corner) and `overlay.size`
  (% of the screen height); the buttons sit at the character's top corners.
- Placing mode (Ctrl+Alt+Shift+P or Settings → Look → "Place the character & buttons…"): a
  dashed frame around the character and each button, drag each one on its own, − / + for the
  character's size, Reset, Done.

### 5.3 Controls

| | |
|---|---|
| Tap the character | Talk (or hands-free: `listenMode` auto / wake) |
| Hold the character 5 s | Settings (PIN if set) |
| Language button (globe) | Bahasa Indonesia / English / 中文; asks the PIN when one is set (`overlay.langPin`) |
| Menu button (☰) | Settings (PIN if set). Both buttons can be switched off |
| Ctrl+Alt+Shift+S / P / Q | Settings / placing / quit (global) |
| F12, Ctrl+Q, D, T | DevTools, quit, debug panel, type a question (window focused) |

### 5.4 Server routes (`server.js`)

| Route | Purpose |
|---|---|
| `GET /`, static files | the page; `/vendor/three/`, `/vendor/three-vrm/` from node_modules |
| `GET /config.json` | public config for the page (never keys, password or PIN) |
| `GET /services` | state of speech-to-text, LLM (local / cloud) and the first-start downloads |
| `GET /speak?lang=&text=` | WAV of the text (clip / cache / engine) |
| `POST /listen?lang=` | WAV in → `{ text, ms }` (vocabulary prompt from the current screen) |
| `POST /chat` | `{ text, lang }` → NDJSON stream: sentences to say, actions, timing |
| `/qb/*` | proxy to the booth app's Local API `/api/v1/*` (Bearer password added on the server) |
| `POST /app/shape`, `/app/layout`, `/app/pick-part` | window shape, layout, "have it already" file |
| `GET/POST /settings`, `/settings/unlock`, `/settings/test`, `/settings/booth`, `/settings/test-llm`, `/settings/openrouter-login`, `/settings/language`, `/settings/quit` | settings (PIN header), Local API connect / run / stop, LLM test, OpenRouter login, language (PIN-free), quit |
| `GET/POST /avatars`, `/avatar-thumb` | VRM list and upload, thumbnails |
| WebSocket `/live` | Gemini Live proxy (the key stays on the server) |

### 5.5 The booth app's Local API

- The booth app comes in three brand builds with the same Local API: QBooth.exe (reports
  "QBooth", written "Q-Booth"), BleepShare.exe ("BleepShareAI") and XBooth.exe ("XBooth"). The
  name shown and said comes from `status.app.name` (`public/brand.js`), or the **Brand name**
  setting (`brandName`), or before any contact a neutral word ("the booth app" / "aplikasi
  booth" / "拍照亭应用"). The settings' first tab carries that name (e.g. "XBooth"; "Booth" before
  contact). The mock reports "QBooth" unless `mockBrand` or `QBA_MOCK_BRAND` names another.
- In the booth app: Settings → Advanced → **Local API** (Expert mode): on; it listens on a port
  (8730 by default) with a password.
- Calls: `GET /api/v1/status`, `GET /api/v1/events`, `GET /api/v1/templates`,
  `POST /api/v1/<command>` with `Authorization: Bearer <password>`.
- Status gives the page (`welcome`, `templatePicker`, `camera`, `result`…), the session, the
  camera phase (`liveIdle`, `counting`, `capturing`, `review`), busy flags and `available`
  commands. The app only offers tools that are in `available`.
- Settings → the booth tab (named after the brand): address, port, password → **Connect** fills the **Event** list (template
  counts, the running one marked); **Run** / **Stop** start and end an event; "Run this event
  when the app opens" (`qbooth.autoStart`) launches it once the booth app answers, if none runs.
  Errors come as codes (`offline`, `unauthorized`, `too_many_attempts`, `event_running`,
  `editor_open`, `dialog_open`, …) shown in the UI language.
- In the booth app's event editor, the event's output monitor = the screen the character is on.
- `mock-qbooth.js` implements the same API on port 8739 (`--mock` or Settings → Connection →
  Mock). Connect always tests the real address fields.

### 5.6 How it guides (`public/brain.js`, `lines.js`, `chat.js`)

- **brain.js**: the page polls `/qb/status` every 400 ms; each new booth app page or camera
  phase gives a fixed line with a gesture (welcome, template picker, ready, countdown,
  review, processing, result). Idle on Welcome → an invitation every `idleInviteSec`.
- **chat.js**: the guest's words + the booth app's status → the LLM with tools for exactly
  the commands the booth app accepts now. Tools: `start_session` → `session/start`, `choose_template` →
  `template/select`, `take_photo` → `camera/capture`, `retake_photo` → `camera/retake`,
  `process_photo` → `camera/process`, `print_photo` → `result/print`, `show_qr` → `result/qr`,
  `start_over` / `finish_session` → `session/end`.
- **Intent router in code** (`routeIntent`) before any LLM: regexes per language (`INTENTS`,
  `INTENTS_ZH`), "go" words ("lanjut", "proses", "ayo", "mulai"), fuzzy matching against the
  current screen's words (edit distance), `START_OVER` ("mulai lagi", "let's start over").
  **No screen skipping**: a template is chosen only on the template picker; naming one on
  Welcome starts the session instead. Questions and negations ("bisa cetak?", "jangan foto
  dulu") are not commands. Numbers count the booth app's cards in their on-screen order.
- **Intent picker**: wordings the regexes miss go to a small JSON-schema classification on
  the LLM's second slot (`id_slot` 1); it never picks print or finish by itself.
- **Routed commands answer with a fixed line** (`ACK`), no LLM wait (0.01 s).
- **Prices**: small models invent them, so a price question gets a fixed answer (`PRICE`).
- **System prompt**: name, persona, talk level, language, the booth app's name and flow, the event info (the
  only facts it may give), rules (short spoken sentences, never claim an action it did not do,
  never name models or software). It stays identical all conversation (prompt cache); the
  booth status rides on each user message.

### 5.7 Talk levels (`talk`)

| Level | Prompt rule | Sentence cap | Local token budget |
|---|---|---|---|
| `short` | 1-2 sentences, ≤ 25 words | 2 | 120 |
| `normal` (default) | 2-3 sentences, ≤ 45 words, may ask back | 3 | 200 |
| `chatty` | 3-5 sentences, ≤ 70 words, small talk, always asks back | 5 | 320 |

Measured averages with the 0.8B model: 10 / 20 / 35 words.

### 5.8 Speed

| (local LLM on the CPU, i7-13700HX) | before | now |
|---|---|---|
| first question after the app opens | 5.7 s | 0.6 s |
| a question | 1-2 s | about 1 s |
| a clear command | waited for the LLM | 0.01 s |

- llama.cpp `--parallel 2 -c 12288`: slot 0 conversation, slot 1 intent picker, both cached.
- **Prompt cache warm-up** (`Chat.warm`, `warmUp`): after start and after a change of
  language, avatar, talk level, persona, name or event info.
- **Fixed lines voiced at start** in the background (`cache/tts`).
- **Per-sentence voice prefetch**: the next sentence renders while the current one plays.
- Sampling for Qwen: `top_p 0.8, top_k 20, presence_penalty 1.5` (a 2B Q3 model looped
  without it).
- **Thinking cue**: from the guest's last word to the first answer sentence the character puts
  a hand to its chin, looks up, and a "•••" bubble shows by its head (`setThinking`).

### 5.9 Speech to text (`services.js`, `stt.js`, `public/mic.js`)

- whisper-server on :3921. NVIDIA GPU: CUDA build + large-v3-turbo (`-ac 0`); else CPU build +
  small (`-ac 640`). Both `-l auto -bo 1 -nt -nf` (no temperature fallback: on noise it
  re-decoded for 30 s). A CUDA build that logs "no GPU found" is replaced by the CPU one.
- **Vocabulary prompt per screen** (`SCREEN` words, template names, the assistant's name).
- **Hallucination filter**: subtitle credits, "terima kasih telah menonton", Chinese ad
  phrases, repeated words, punctuation-only output (Unicode-aware: a `\W` filter once dropped
  every Chinese sentence).
- **Echo filter** only for 4+ words (short answers like "Proses." were dropped as echo).
- Voice detection in the page: noise floor = quietest 300 ms, separate start / hold
  thresholds, end after 1.1 s of silence, max 12 s; sensitivity 1-10.
- Listening modes: `tap`, `auto` (always), `wake` (after its name).

### 5.10 Voice (`tts.js`, `pronounce.js`, `public/voice.js`)

- Order: pre-rendered clip (`public/voice/<lang>/`, female only) → cache → engine.
- **The voice follows the avatar's gender** (`avatars.json`, or the avatar editor's Voice;
  `tts.voices[lang][female|male]`):

  | | female | male |
  |---|---|---|
  | id | Piper news_tts | Windows OneCore "Andika" (`winrt`) |
  | en | Windows Zira | Windows David |
  | zh | Piper huayan | Windows OneCore "Kangkang" |

  Not installed (Windows language pack missing) → the other gender's voice, and the settings
  say how to install it (Windows Settings → Time & language → Language & region → add the
  language → Text-to-speech). Gemini Live takes Puck (male) / Kore (female) when its chosen
  voice is the other gender.
- **Pronunciation** (`pronounce.js`, before synthesis): id `QR` → kyu ar,
  `QRIS` → kris, photobooth → fotobut, template → templet, scan → sken, upload → aplod, online
  → onlen; zh QR → 二维码, QRIS → 克里斯; when the brand is Q-Booth also id `Q-Booth` → Kyubuth,
  zh `Q-Booth` → 丘布斯; plus the owner's own list
  (`pronunciations`, "written = how to say it" per line). Checked by speaking with Piper and
  hearing back with whisper.
- Lip sync from the playing audio (loudness + spectrum → VRM `aa ih ou ee oh`).

### 5.11 Avatars (`public/avatar.js`, `avatar-editor.js`)

- 8 bundled models (`public/avatars/avatars.json`): Luma (VRM 1.0 sample, pixiv), Seed-san
  (VirtualCast; credit required), and six VRoid Studio sample models (CC0 / free use per their
  VRM meta): Fumiriya, Ren (male), Shibu, Bibi, Vita, Victoria (female).
- **VRM 0.x bone rotations are mirrored** (X and Z) because `rotateVRM0` turns them around:
  without it VRoid models raised their arms.
- Procedural animation only: breathing, sway, blinking, look-at, gestures (wave, nod,
  present), thinking pose, listening pose.
- Editor: model gallery with licence, colours (skin tones, hair, eyes, clothes), glasses,
  **voice gender**; saved per model in `avatarStyle`. Own `.vrm` files via "Add VRM…".

### 5.12 Settings (`settings.js`, `public/settings.js`)

- Tabs: **the booth app's name (e.g. "XBooth"), Assistant, AI brain, Look, Microphone, Security**; a side menu on a
  landscape screen, a row of tabs on a portrait one; each tab fits without scrolling.
- A field table (`FIELDS`) defines each key's type and whether it needs a restart. Only
  changed fields are sent; secrets are write-only (empty = keep).
- Optional **settings PIN** (`x-settings-pin` header on every change).
- The booth tab also holds **Brand name** (`brandName`): the name to show and say; empty = what
  the booth app reports.
- Built-in tests: Local API connect, "Test the AI brain", mic level meter.
- All labels in id / en / zh; server errors come as codes translated in the page.

### 5.13 Gemini Live (`live.js`, `public/live.js`)

- The page opens `ws://127.0.0.1:3920/live`; the server opens Google's
  `BidiGenerateContent` WebSocket with the key (it never reaches the page).
- Setup: model, audio out, voice (Kore, Aoede, Leda, Zephyr, Sulafat; Puck, Charon, Fenrir,
  Orus, Achird), system instruction, the same tools as function declarations, server VAD,
  transcriptions on. Booth events are sent as text turns so Live speaks them in its own voice.
- If Live fails to connect 4 times the local mode takes over; Live is retried every 30 s.
- "Guests may interrupt" (`bargeIn`) only with a headset or directional mic.

---

## 6. Configuration reference (`config.json` overrides `config.example.json`)

| Key | Default | Meaning |
|---|---|---|
| `port` | 3920 | page server (speech-to-text 3921, LLM 3922) |
| `mock / mockBrand` | false / (unset) | the built-in fake booth app; the name it reports (unset = QBooth) |
| `qbooth.host / port / password` | 127.0.0.1 / 8730 / "" | the booth app's Local API |
| `brandName` | "" | the booth app's name to show and say ("" = what it reports) |
| `qbooth.eventId / autoStart` | "" / false | the event the settings run; launch it at start |
| `language / askLanguage` | en / true | `id`, `en`, `zh`; the choice screen at launch |
| `assistantName / persona / talk / eventInfo` | Luma / ceria / normal / "" | who it is, how it talks, how much, what it may tell |
| `pronunciations` | "" | own pronunciation lines |
| `avatar / avatarStyle` | avatars/sample.vrm / {} | model; colours, glasses, voice gender per model |
| `overlay.side / size / layout` | right / 70 / null | start corner, % of screen height, placed positions |
| `overlay.menuButton / langButton / langPin` | true / true / true | the ☰ and globe buttons; the globe asks the PIN |
| `display / screenGpu` | 0 / auto | which screen; who draws the character |
| `listenMode / micDevice / micSensitivity / saveRecordings` | tap / "" / 5 / false | hearing |
| `idleInviteSec / pollMs` | 30 / 400 | invitation interval; status poll |
| `llm.provider` | local | `local`, `gemini`, `openrouter`, `gemini-live` |
| `llm.fallbackLocal` | true | keep the local LLM as the stand-in for a cloud brain |
| `llm.gemini.apiKey / model` | "" / gemini-3.5-flash | Gemini (section 7.1) |
| `llm.openrouter.apiKey / model` | "" / google/gemini-2.5-flash | OpenRouter (section 7.2) |
| `llm.live.model / voice / bargeIn` | gemini-3.8-live / Kore / false | Gemini Live (uses the Gemini key) |
| `llm.model / ctx / device` | models/Qwen3.5-0.8B-Q8_0.gguf / 12288 / auto | local LLM |
| `stt.*` | CPU small; GPU large-v3-turbo | speech to text |
| `tts.voices / tts.piper / tts.sapi` | see 5.10 | voices per language and gender |
| `autoDownload` | true | first-start downloads (4.3) |
| `settingsPin` | "" | protects the settings |

`config.json` holds the Local API password and the API keys: keep it out of git, screenshots
and shared packages.

---

## 7. Getting the cloud API keys

The app works fully offline with its local AI. A cloud brain answers small talk better and
needs an API key. Keys are pasted in **Settings → AI brain** (hold the character 5 s, or
Ctrl+Alt+Shift+S), saved only in `config.json` on that PC, and never shown again (the field
says "saved (leave empty to keep)").

| Brain (Settings → AI brain → "Runs on") | Key from | Notes |
|---|---|---|
| Gemini (cloud, Google) | Google AI Studio | free tier with daily limits; billing for events |
| OpenRouter (cloud) | OpenRouter | one key for many models; pay per use with credits |
| Gemini Live (real-time voice) | the **same Google AI Studio key** | an OpenRouter key does not work for Live |
| This computer (offline) | none | default |

### 7.1 Google Gemini API key (Google AI Studio)

1. Open **https://aistudio.google.com/apikey** in a browser and sign in with a Google account
   (use the business account the bills should go to).
2. First time: accept the Terms of Service. AI Studio then creates a default Google Cloud
   project for you. (Existing Google Cloud users can instead use **Dashboard → Projects →
   Import projects** to pick an existing project.)
3. Click **Create API key**, choose the project, and create it. Copy the key (it is a long
   string; treat it like a password).
4. Recommended: on the API Keys page, next to the key's **Unrestricted** label, click **Add
   restrictions → Restrict to Gemini API only → Restrict key**. Google rejects or blocks
   unrestricted keys in some cases, and a restricted key is safer if it leaks.
5. In Avatar: **Settings → AI brain → Runs on: Gemini (cloud, Google)**, paste the key
   into **API key**, keep the model `gemini-3.5-flash` (or another Gemini model name), keep
   **"Use the local AI if the cloud fails"** on, press **Test the AI brain**, then **Save**.
6. For **Gemini Live**: choose **Runs on: Gemini Live (real-time voice, cloud)**; the same key
   field is used. Pick a voice; leave "Guests may interrupt" off unless the guest speaks into a
   headset or directional mic.

**Free tier and billing.** A new project is on the Free Tier: it costs nothing but has small
per-minute and per-day request limits per model (see the project's rate-limit page in AI
Studio), and they can run out during a busy event; the app then answers with the local AI and
shows a "quota / 429" warning. For events:
1. In AI Studio open **API keys** or **Projects** and click **Set up billing** in the project's
   *Billing Tier* column.
2. Choose the country, confirm contact details and a payment method.
3. Pay as **Prepay** (buy credits on AI Studio's Billing page: **Buy credits**, minimum $5;
   requests fail with HTTP 402 when the balance is $0; auto-reload is available) or
   **Postpay** (charged monthly), whichever AI Studio offers.
4. Linking a billing account moves the project to **Tier 1** (higher limits) almost at once.
   Set a billing alert in the Google Cloud console.

On a paid tier Google does not use the prompts and answers to improve its products; on the
free tier, check the current terms. Either way, guests' words are sent to Google: say so if
the event needs it.

If a key leaks: create a new key, put it into the app, then delete or disable the old one in
AI Studio and check the usage.

### 7.2 OpenRouter API key

OpenRouter is one account and one key for models from many providers (Google, OpenAI,
Anthropic, Meta, …). There are two ways to get the key into the app:

**A. "Log in with OpenRouter" (easiest, in the app)**
1. Settings → AI brain → Runs on: **OpenRouter (cloud)** → **Log in with OpenRouter**.
2. The browser opens OpenRouter's sign-in page; sign in (or create an account) and approve
   "Avatar". The key OpenRouter makes this way is labelled "Avatar" in your
   Keys list.
3. The app receives the key itself (OAuth PKCE on a one-time local callback) and shows
   "✓ Connected, key saved". Press **Test the AI brain**, then **Save**.

**B. Make a key by hand**
1. Sign in at **https://openrouter.ai** and open **https://openrouter.ai/settings/keys**
   (Keys).
2. Click **Create Key**, give it a name (e.g. "Avatar – booth 1") and **set a credit
   limit** (OpenRouter recommends a limit on every key: a leaked key can otherwise spend the
   whole balance).
3. Copy the key (it starts with `sk-or-v1-`; it is shown only once).
4. Paste it into Settings → AI brain → **API key**, set the **Model** (default
   `google/gemini-2.5-flash`; any model id from https://openrouter.ai/models works), press
   **Test the AI brain**, then **Save**.

**Credits.** Paid models need credits: **https://openrouter.ai/settings/credits** → add credits
by card (also crypto; auto top-up is available; a small fee applies to purchases, inference
has no mark-up). Unused credits can be refunded within 24 hours. Free models (ids ending in
`:free`) need no credits but are limited to 50 requests a day in total (1000 a day after buying
at least 10 credits): too few for an event.

If a key leaks: delete it at https://openrouter.ai/settings/keys and create a new one.
OpenRouter also scans GitHub for exposed keys and e-mails the owner.

### 7.3 The booth app's Local API password

Not a cloud key, but set the same way: the booth app → Settings → Advanced → **Local API**
(Expert mode) → switch on, note the port and the password → Avatar Settings → the booth tab →
address (127.0.0.1 on the same PC), port, password → **Connect**.

### 7.4 Rules for keys

- Never put a key in git, a screenshot, a video or a shared package. The portable build and
  the source copy are checked for this before they are shared (no `config.json` inside).
- Use a separate key (or a credit limit) per booth PC so one can be revoked alone.
- Keep "Use the local AI if the cloud fails" on: venue internet drops.

---

## 8. Lessons learned (do these from the start)

1. **Never trust a small model to act**: route clear commands in code, give every tool result
   a `next` hint, forbid claiming actions in the prompt, answer prices with a fixed line.
2. **No screen skipping**: commands only for the screen the booth app shows (`available`).
3. **Latency**: constant prompt prefix + cache warm-up, two llama slots, fixed lines
   pre-voiced, per-sentence voice prefetch, whisper without temperature fallback.
4. **Overlay windows**: `setShape` for click-through, `setBounds` after showing (work-area
   shrink), re-assert always-on-top, `showInactive` (never steal the booth app's focus), global
   shortcuts.
5. **VRM 0.x needs mirrored bone rotations.**
6. **Hearing**: Unicode-aware filters, echo filter only for long phrases, screen vocabulary.
7. **Kiosk robustness**: single instance, port retry, kill leftover AI servers by path
   (`Get-Process`; WMI took a minute on the test laptop), watchdogs.
8. **Secrets** live only on the server; the page gets a filtered config; packages are scanned.
9. **Big files are downloaded, not shipped in the source**, with resume and "have it already".
10. **Test without hardware**: the mock Local API, headless Chrome over DevTools for
    screenshots; never open app windows on the owner's working screen for tests.

---

## 9. Testing recipe (no booth, no screen)

1. `node server.js --mock` (or a copy with its own `config.json` ports).
2. Headless Chrome with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream
   --autoplay-policy=no-user-gesture-required --remote-debugging-port=…`, open
   `/?autostart=1&lang=id&debug=1`.
3. Drive it: `fetch('/qb/session/start', {method:'POST'})`, `/qb/status`, `window.assistant`,
   `window.__qba.settings()`; screenshots with `Page.captureScreenshot`
   (`Emulation.setDefaultBackgroundColorOverride` transparent to composite over a booth app
   screen).
4. Intent tests: `routeIntent` unit scripts with unseen phrasings in each language.
5. Stop the server and the AI servers afterwards and check the ports are free.

Headless Chrome uses a software GPU: test the packaged overlay on the target PC too.

---

## 10. Status and known issues (2026-10-30)

Working and tested headless: Local API flow (mock), intent routing (id / en / zh), talk
levels, thinking cue, settings tabs, language button + PIN, placing, avatar editor and voice
gender, first-start downloads (from empty, resume, "have it already"), portable package.

Open:
- The real Electron overlay over a running booth app event, the real microphone and the file
  dialog of "have it already" are not yet tested by the owner on the booth PC.
- Male Indonesian / Mandarin voices need the Windows language packs (not installed on the
  test laptop: the female voice speaks instead).
- Gemini free tier limits are small; use a billed key at events.
