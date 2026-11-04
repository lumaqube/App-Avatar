# Avatar (overlay)

A virtual assistant that stands **on top of the booth app's running event screen**: a 3D
character in a corner, nothing else. It greets guests, talks with them by voice, guides
them through the booth app's own screens (start, template picker, camera, review, result) and
presses the booth app's buttons for them when asked ("ayo foto", "yang kedua", "foto", "ulang",
"proses", "cetak", "QR"). Everything goes through the booth app's **Local API**.

Works with QBooth.exe, BleepShare.exe and XBooth.exe; the name shown comes from the connected
app (see [Brands](#brands)).

It has no camera, live view or screens of its own: the booth app does all the showing; the
assistant only talks and presses.

Docs (en / id / zh): the recipe, how it is built and run ([docs/Avatar_EN.md](docs/Avatar_EN.md),
[docs/Avatar_ID.md](docs/Avatar_ID.md), [docs/Avatar_ZH.md](docs/Avatar_ZH.md)), and the user guide
(`docs/Avatar_EN.docx`, `Avatar_ID.docx`, `Avatar_ZH.docx`).

## Run

- Desktop app (the normal way): `npm run app` (`npm run app:mock` = with the built-in fake
  booth app; both clear `ELECTRON_RUN_AS_NODE`, which some shells set). Packaged:
  `dist\Avatar-win32-x64\Avatar.exe`.
- `npm run build` packages it (`--no-asar`, without `tools/` and `models/`: the exe downloads
  them on its first start, below). A ready exe: the repo's **Releases** page.
- `node server.js [--mock]` serves the page alone on http://127.0.0.1:3920 for testing in
  a browser (add `?debug=1`); without the desktop app there is no overlay window.
- Leftover AI servers (after a hard kill) are stopped by the app itself at the next start.

Ports: page 3920, speech-to-text 3921, LLM 3922.

## Downloads on the first start (`setup.js`)

The source folder has no `tools/` or `models/` (too large). On the first start the app
downloads what its config uses and is missing, before the rest starts up; the start-up
screen shows the progress ("Downloading (first start only)"). Once in place they are
never downloaded again; a cut download resumes on the next start.

| Goes to | What, from where | Size |
|---|---|---|
| `tools/llama/` | llama.cpp b11982, Windows Vulkan build (GitHub ggml-org/llama.cpp) | 37 MB |
| `models/Qwen3.5-0.8B-Q8_0.gguf` | the local AI brain (Hugging Face unsloth/Qwen3.5-0.8B-GGUF) | 774 MB |
| `tools/whisper/` | whisper.cpp b5454, CPU/BLAS build (GitHub ggml-org/whisper.cpp) | 21 MB |
| `models/ggml-small-q5_1.bin` | speech recognition model (Hugging Face ggerganov/whisper.cpp) | 181 MB |
| `tools/piper/` | Piper 2023.11.14-2 (GitHub rhasspy/piper) | 21 MB |
| `tools/piper/*.onnx(.json)` | the Piper voices the config names (Hugging Face rhasspy/piper-voices) | 60 MB each |
| `tools/whisper-cuda/` + `models/ggml-large-v3-turbo-q5_0.bin` | only with an NVIDIA GPU: in the background, used from the next start | 653 + 547 MB |

- Skipped: the LLM parts with a cloud-only brain (`llm.fallbackLocal: false`), anything
  with a `url` (a server running elsewhere), files at a custom path the app has no
  download for.
- **Have it already?** While a part downloads, the start-up screen (desktop app) shows
  "Have it already? Choose <file>": pick your own copy and it is copied in instead. A model
  or voice must be the same file (same type and size); for a program, pick its release
  `.zip` or its exe inside an existing folder (e.g. a portable build's
  `resources\app\tools\llama\llama-server.exe`: the whole folder is copied).
- `"autoDownload": false` turns it off. Without internet, copy `tools/` and `models/`
  from the portable build (`Avatar\resources\app\`) instead.
- A failed part is shown on the start-up screen; the app starts with what it has.

## Brands

The booth app comes in three brand builds with the same Local API: QBooth.exe ("QBooth"),
BleepShare.exe ("BleepShareAI") and XBooth.exe ("XBooth"). The assistant works with all three and
never names one on its own: the name it shows and says comes from the booth's status
(`app.name`; "QBooth" is written "Q-Booth", a trailing " (mock)" is dropped), kept for the session
([public/brand.js](public/brand.js), page and server alike). Before the first answer it says "the booth
app" / "aplikasi booth" / "拍照亭应用" ("Booth" as the settings tab). `brandName` (Settings → the
booth tab → Brand name) overrides the reported name.

- Texts carry `{booth}` / `{Booth}` / `{boothShort}` (settings, start-up screen, fixed lines), filled
  when shown; the settings fill them again when the name arrives while they are open.
- The server sees the name in every status reply (its own calls and the page's `/qb/status`), gives it in
  `/config.json` (`brand`, `brandSeen`) and `GET /brand`, and warms the prompt and the fixed lines
  again when it changes.
- The system prompt (chat.js, live.js) and whisper's vocabulary prompt (stt.js) use the name; the
  Q-Booth pronunciations (pronounce.js) apply only when the booth is Q-Booth.
- Pre-rendered voice clips are keyed on the text: lines naming another brand are voiced live.
- The mock reports "QBooth" unless `mockBrand` (config) or the environment variable `QBA_MOCK_BRAND`
  names another (e.g. `set QBA_MOCK_BRAND=XBooth` before `node server.js --mock`).

## Connecting to the booth app

1. The booth app: Settings → Advanced → Local API (Expert mode): on, note port and password.
2. Hold the character 5 s (or Ctrl+Alt+Shift+S) → Settings → the booth tab: address, port,
   password → **Connect**. The **Event** list fills in (template counts, the running one
   marked). **Run** / **Stop** start and end an event in the booth app. "Run this event when the
   app opens" (`qbooth.autoStart`) launches it once the booth app answers, if none is running.
3. In the booth app's event editor, the event's output monitor = the screen the character is on.

## The window

- Covers the whole screen (`display`), transparent, frameless, always on top: re-asserted every 1.5 s, because the booth app raises its
  kiosk window once when an event opens. Shown without taking the focus from the booth app.
- Cut to the character's outline (`win.setShape`; the outline comes from its bones,
  `Avatar.screenBox`, sent to `POST /app/shape` every 250 ms when it moves, 8 px steps). The
  rest of the screen has no window at all: the booth app stays visible and touchable around it.
- Nothing but the character: no subtitles, buttons or cards. The debug panel (`?debug=1`,
  or D with the window focused) shows what was heard / said.
- **Thinking**: from the guest's last word until the first sentence of the answer, the character
  puts a hand to its chin, tilts its head, looks up, and a "•••" bubble shows beside its head
  (`Avatar.setThinking`, `#think`; the bubble is part of the window's shape).
- Settings and the language screen take the whole screen while open (`/app/overlay {expand}`).
  Settings come in tabs (the booth app's name, Assistant, AI brain, Look, Microphone, Security): a side menu
  on a landscape screen, a row of tabs on a portrait one, each tab fitting without scrolling.

### Controls

| | |
|---|---|
| Tap the character | Talk (the mic button). Hands-free listening (`listenMode` auto / wake) works too |
| Hold the character 5 s | Settings (PIN if set) |
| Ctrl+Alt+Shift+S | Settings, from anywhere (global shortcut: the booth app usually has the focus) |
| Language button (globe) | Bahasa Indonesia / English / 中文. Asks the settings PIN when one is set (`overlay.langPin`, on by default; off = guests may switch) |
| Menu button (☰) | Settings (PIN if set). Both buttons can be switched off (`overlay.menuButton`, `overlay.langButton`) |
| Ctrl+Alt+Shift+P | Placing ([public/layout.js](public/layout.js)): drag the character and each button on its own, − / + for the character, Reset, Done (saved as `overlay.layout`, screen fractions) |
| Ctrl+Alt+Shift+Q | Quit. Settings also has "Close the app" |
| F12 / Ctrl+Q | Developer tools / quit, with the window focused |

Until it is first placed: `overlay.side` (right / left bottom corner) and `overlay.size`
(% of the screen height) on screen `display`, the two buttons at the character's top corners.

## How it guides

- [public/brain.js](public/brain.js): each new booth app page / camera phase → a fixed line
  ([public/lines.js](public/lines.js)) with a gesture. Idle on Welcome → an invitation.
- [chat.js](chat.js): the guest's words + the booth app's status → LLM (local llama.cpp, Gemini or
  OpenRouter) with tools for exactly the commands the booth app accepts now (`status.available`).
  Clear commands are routed in code (`routeIntent`): "ayo foto" → `session/start`, a
  template's name or number → `template/select`, "foto" → `camera/capture`, …
  Numbers count the booth app's cards in their on-screen order (`inScreenOrder`, from the picker's `index`).
- [live.js](live.js): Gemini Live (voice in, voice out), same tools.
- The LLM is told it stands on top of the booth app's screen and guides the guest through it.

## Speed

Measured with the local LLM on the CPU only (i7-13700HX), time to the first spoken sentence:

| | before | now |
|---|---|---|
| first question after the app opens | 5.7 s | 0.6 s |
| a question | 1-2 s | about 1 s |
| a clear command ("ayo foto", "nomor dua", "cetak") | waited for the LLM | 0.01 s |

- **Prompt cache warm-up** (`Chat.warm`, server.js `warmUp`): once the LLM is up, and after a language
  change, the real system prompt + tools are read into llama.cpp's cache.
- **Fixed lines made at start**: every fixed line and command acknowledgement of the current
  language is voiced in the background, one at a time (`cache/tts`), so they play at once.
- **Routed commands answer with a fixed line** (`ACK` in chat.js), no LLM; the LLM only talks when
  the command failed. The countdown's own "Smile!" covers take / retake.
- **At most 3 sentences** per answer (`MAX_SENTENCES`): the model is stopped there.
- **The next sentence's voice is made while the current one plays** (public/voice.js asks for each
  sentence as it arrives); 120 ms between sentences.
- Whisper's vocabulary prompt carries the assistant's name (wake mode) and the template names.

The biggest wait left is the 1.1 s pause that ends a guest's sentence (`SILENCE_MS`, public/mic.js);
0.8 s cut people off between words.

## Avatars and their voice

Eight bundled VRM models (public/avatars, named and gendered in [avatars.json](public/avatars/avatars.json)):
Luma (VRM 1.0 sample, pixiv), Seed-san (VirtualCast), and six from VRoid Studio's early sample
models: Fumiriya and Ren (male), Shibu, Bibi, Vita, Victoria (female). The VRoid ones say in
their own VRM meta: anyone may use them, corporate commercial use, redistribution and changes
allowed, no credit needed (Ren = HairSample_Male, CC0); found via
opengameart.org/content/vroid-studio-cc0-models. They are VRM 0.x: avatar.js mirrors their bone
rotations (X, Z) because rotateVRM0 turns them around.

**Credits** (from each model's VRM licence, https://vrm.dev/licenses/1.0/): **Seed-san by
VirtualCast, Inc.** (credit required); Luma = "VRM1_Constraint_Twist_Sample" by pixiv Inc.; the six
VRoid models by the VRoid Project (pixiv), redistribution allowed, no credit required.

**The voice follows the avatar's gender** (avatars.json, or Edit the avatar → Voice for an own
VRM; `avatarStyle[file].gender`). `tts.voices[lang][female|male]` picks it:

| | female | male |
|---|---|---|
| id | Piper news_tts | Windows OneCore "Andika" (`winrt`) |
| en | Windows Zira | Windows David |
| zh | Piper huayan | Windows OneCore "Kangkang" |

Piper has one Indonesian voice (female, ~256 Hz) and its Mandarin male voice (chaowen) needs a
newer Piper; so the male ones are Windows voices from the Indonesian / Chinese language packs
(Settings → Time & language → Language → the language → Text-to-speech). Not installed: the
other gender's voice speaks, and the settings say how to install it. Gemini Live takes Puck (male)
or Kore (female) when its chosen voice is the other gender; the browser fallback voice too.
The voice is part of the cache key (`cache/tts`), and pre-rendered clips are only used for female.

## Pronunciation

[pronounce.js](pronounce.js) rewrites words the voice says wrong before they are spoken (the voice
only). Checked by speaking each spelling with Piper and hearing it back with whisper: "Q-Booth"
was heard as "keyboard", "QR" as "kier". Built in: Indonesian Q-Booth → Kyubuth (the Q-Booth ones only when the brand is Q-Booth), QR → kyu ar,
QRIS → kris, photobooth → fotobut, template(nya) → templet(nya), (di)scan → (di)sken,
(di)upload → (di)aplod, online → onlen; Mandarin Q-Booth → 丘布斯, QR(码) → 二维码, QRIS → 克里斯
(the Mandarin voice cannot say Latin letters). The owner adds more in Settings → Assistant →
Pronunciations (`pronunciations`: one "written = how to say it" a line, every language).
A changed line is never taken from an old pre-rendered clip; the cache keys on what is said.
Gemini Live speaks with its own voice: the list does not apply there.

## Languages

Indonesian, English and Mandarin (`zh`). For Mandarin: Chinese system prompt, tools and fixed
lines; clear commands in Chinese are routed in code (`INTENTS_ZH`: 我要拍照, 拍吧, 重拍, 打印, 二维码…,
card numbers 第三个 / 三号); whisper is told `zh`; Piper speaks `zh_CN-huayan-medium`; Gemini
Live speaks Mandarin.

The chosen language is the whole app's: the voice, the start-up and language screens, the
settings (129 labels) and the avatar editor (24) in all three; the server's errors come with a
code (`offline`, `unauthorized`, `event_running`, `no_key`, …) that the settings show in that
language. Only the debug panel (developers) stays in English.

## Config (`config.json`, overrides `config.example.json`)

| Key | Meaning |
|---|---|
| `port` | This app's page (3920) |
| `qbooth.host / port / password` | The booth app's Local API |
| `qbooth.eventId / autoStart` | The event the settings run; launch it when the app opens |
| `brandName` | The booth app's name to show and say; empty = what the booth reports (see Brands) |
| `overlay.side / size / layout` | Start corner, % of screen height; where the character and buttons were placed |
| `overlay.menuButton / langButton / langPin` | The ☰ and language buttons; the language button asks the PIN |
| `display` | Screen for the start position (0 = main) |
| `screenGpu` | `auto` / `nvidia` / `software`: who draws the character (restart) |
| `language / askLanguage` | `id`, `en` or `zh` (Mandarin); the choice screen at launch |
| `talk` | How much it says: `short` (1-2 sentences), `normal` (2-3, may ask back; default), `chatty` (3-5, small talk, always asks back). Sets the prompt's length rule, the sentence cap and the local model's token budget (chat.js `TALK`) |
| `assistantName / persona / eventInfo` | Who it is, how it talks, what it may tell about the event |
| `avatar / avatarStyle` | VRM under `public/avatars/`, colours / glasses (avatar editor) |
| `listenMode` | `tap` (tap the character), `auto`, `wake` (say its name) |
| `micDevice / micSensitivity / saveRecordings` | Microphone |
| `llm.*` | Brain: `provider` local / gemini / openrouter / gemini-live, keys, models, `fallbackLocal` |
| `stt.*` | whisper-server (CPU small model, or large-v3-turbo on an NVIDIA GPU) |
| `tts.*` | Voice: Piper (id, zh: `zh_CN-huayan-medium`), Windows SAPI (en), OmniVoice; pre-rendered clips in `public/voice/` first |
| `idleInviteSec / pollMs` | Invitation interval on Welcome; status poll |
| `settingsPin` | PIN for the settings |
| `mock / mockBrand` | The built-in fake booth app; the product name it reports (default "QBooth") |

`config.json` holds the API password and keys: keep it out of git and screenshots.

## Files

| | |
|---|---|
| `electron/main.js` | The overlay window, shortcuts, watchdogs, starts the server in-process |
| `server.js` | Page, `/qb/*` proxy (adds the password), `/listen`, `/chat`, `/speak`, `/settings*`, `/app/*`, `/live` |
| `chat.js`, `live.js` | Conversation + booth tools (local / cloud LLM, Gemini Live) |
| `services.js`, `stt.js`, `tts.js` | whisper-server, llama-server, Piper / SAPI / OmniVoice |
| `settings.js` | Settings fields, Local API connect / run / stop, LLM test |
| `mock-qbooth.js` | Fake booth app Local API for tests |
| `public/` | The page: `main.js`, `avatar.js` (VRM, gestures, outline), `voice.js`, `mic.js`, `brain.js`, `lines.js`, `settings.js`, `avatar-editor.js`, `boot.js`, `brand.js` (the booth app's name, also used by the server) |
| `setup.js` | Downloads missing tools and models on the first start |
| `tools/`, `models/` | llama.cpp, whisper.cpp (CPU + CUDA), Piper; Qwen 3.5 0.8B (Q8_0, 774 MB), whisper small / large-v3-turbo |
