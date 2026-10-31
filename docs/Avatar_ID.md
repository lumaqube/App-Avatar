# Avatar: resepnya

Versi bahasa lain: Avatar_EN.md (English), Avatar_ZH.md (中文).

Cara Avatar dibuat, apa saja yang dipakainya, cara mendapatkan API key cloud, dan cara
membangunnya lagi dari nol. Ditulis supaya developer atau AI agent bisa mengulanginya langkah
demi langkah. Kondisi app: 30 Oktober 2026, versi 0.2 (`package.json` name
`avatar-overlay`).

Avatar adalah app desktop Windows: **karakter 3D yang berdiri di atas layar event aplikasi booth
yang sedang berjalan**. Ia menyapa tamu, mengobrol dengan mereka lewat suara, memandu mereka
melewati layar-layar aplikasi booth sendiri (welcome, template picker, kamera, review, hasil) dan
menekan tombol aplikasi booth untuk mereka kalau diminta ("ayo foto", "yang kedua", "foto",
"ulang", "proses", "cetak", "QR"). Semuanya lewat **Local API** aplikasi booth. App ini tidak punya
kamera, live view atau layar sendiri: aplikasi booth yang menampilkan semuanya, asisten hanya
bicara dan menekan tombol.

Bekerja dengan QBooth.exe, BleepShare.exe dan XBooth.exe; nama yang tampil berasal dari aplikasi
yang tersambung (bagian 5.5 dan "Brands" di README).

Semuanya berjalan di PC booth. Bagian cloud yang opsional hanya otak AI (Google Gemini,
OpenRouter) dan Gemini Live (suara realtime). Bagian 7 menjelaskan cara mendapatkan API key-nya.

> Riwayat: app "lengkap" sebelumnya (kamera sendiri dengan bridge Canon/Nikon/Sony, mode
> Automation, kartu template) ada di `_SOURCE\ASSISTANT`. App itu dipensiunkan dan dihapus pada
> 2026-10-30; app overlay ini menggantikannya.

---

## 1. Stack sekilas

| Lapisan | Apa | Versi yang dipakai | Kenapa yang ini |
|---|---|---|---|
| Shell desktop | Electron | 45.1 | Satu exe; jendela transparan selalu di atas; server Node berjalan di dalamnya |
| Packager | @electron/packager | 20.3 | `--no-asar`: kode tetap berupa file biasa, gampang di-patch di tempat |
| Server | Node.js, `http` biasa + `ws` (tanpa framework) | Node 22, ws 8.22 | Kecil, tanpa langkah build |
| 3D | three.js + @pixiv/three-vrm | three 0.186, three-vrm 3.5.5 | Avatar VRM (0.x dan 1.0): ekspresi, look-at, spring bone |
| Text to speech | Piper (lokal, neural) | 2023.11.14-2 | Cepat di CPU; Indonesia `id_ID-news_tts-medium`, Mandarin `zh_CN-huayan-medium` |
| | Suara Windows | SAPI (Zira, David) dan OneCore (`winrt`: Andika, Kangkang) | Suara Inggris; suara pria Indonesia / Mandarin dari language pack Windows |
| Speech to text | whisper.cpp `whisper-server` | b5454, build CPU/BLAS + build CUDA 12.4 | Akurat untuk Indonesia/Inggris/Mandarin |
| | Model di GPU NVIDIA | `ggml-large-v3-turbo-q5_0.bin` (547 MB) | ~2 % kesalahan kata dalam tes |
| | Model di CPU | `ggml-small-q5_1.bin` (181 MB) | Jalan tanpa GPU NVIDIA |
| LLM lokal | llama.cpp `llama-server` | b11982, build Vulkan | GPU apa pun (NVIDIA/AMD/Intel) lewat Vulkan, atau CPU |
| | Model | `Qwen3.5-0.8B-Q8_0.gguf` (774 MB) | Di bawah 1 GB; cepat bahkan di CPU; perintah yang jelas toh sudah dirutekan di kode |
| LLM cloud (opsional) | Gemini, OpenRouter | Endpoint chat yang kompatibel OpenAI | Obrolan ringan lebih pintar; LLM lokal tetap jadi cadangan |
| Suara realtime (opsional) | Gemini Live | WebSocket `BidiGenerateContent`, model `gemini-3.8-live` | Mendengar dan menjawab langsung dengan suara, dengan tool call |

Di-tuning di: laptop Windows 11, Intel i7-13700HX, RTX 4060 Laptop (8 GB), GPU terintegrasi
Intel UHD. App ini juga jalan **tanpa GPU diskrit** (pengenalan suara di CPU, LLM di CPU): model
0.8B menjawab dalam sekitar 1 detik di sana.

---

## 2. Bagaimana semuanya tersambung

```
 ┌──────────── Avatar.exe (Electron) ────────────────────────────────────────────────────┐
 │ jendela overlay: seluruh layar, transparan, tanpa bingkai, selalu di atas, dipotong    │
 │ mengikuti garis karakter (win.setShape) sehingga aplikasi booth tetap terlihat dan     │
 │ bisa disentuh di sekitarnya                                                             │
 │                                                                                         │
 │  halaman (Chromium)                    Server Node (proses yang sama)  :3920           │
 │   avatar.js  three-vrm, gerakan         ├─ /speak  → tts.js  → Piper / suara Windows    │
 │   mic.js     deteksi suara              ├─ /listen → stt.js  → whisper-server :3921     │
 │   main.js    loop, ketuk/tahan, tombol  ├─ /chat   → chat.js → llama-server   :3922     │
 │   brain.js   apa yang diucapkan per     │                      atau Gemini / OpenRouter │
 │              layar                      ├─ /live   → live.js → Gemini Live (WSS)        │
 │   layout.js  menempatkan karakter +     ├─ /qb/*   → Local API aplikasi booth :8730     │
 │              tombol                     │            (password ditambahkan di server)   │
 │   settings.js, avatar-editor.js         ├─ /app/*  → bentuk jendela, layout, pilih file │
 │   boot.js    start-up + unduhan         └─ /settings*, /avatars, /services, /config.json│
 └─────────────────────────────────────────────────────────────────────────────────────────┘
          ▲ tamu: mic masuk, speaker keluar          aplikasi booth (jendela kiosk-nya sendiri)
```

- **Halaman** adalah seluruh antarmuka pengguna. Ia hanya bicara dengan server-nya sendiri
  (`http://127.0.0.1:3920`); rahasia (API key, password Local API, PIN pengaturan) tidak pernah
  sampai ke sana (`/config.json` difilter).
- **Server** dijalankan oleh main process Electron (`electron/main.js` meng-import
  `server.js`). Server juga bisa berjalan sendiri (`node server.js [--mock]`) dan dibuka di
  browser untuk development; dalam mode itu tidak ada jendela overlay.
- **Server AI** (whisper, llama, Piper) adalah child process di port lokal yang tetap. Server
  yang menjalankan, mengawasi dan menghentikan mereka.

---

## 3. Struktur folder

```
QBoothAvatar/           folder kerja (repo git source-nya: App-Avatar)
  package.json            dependency, script (start, mock, app, app:mock, build)
  config.example.json     semua pengaturan dengan nilai default-nya (baca ini dulu)
  config.json             hanya override milik owner (tidak di git; di sebelah exe kalau sudah di-package)
  server.js               server HTTP + WebSocket, route, start/stop semuanya
  config.js               memuat config.example.json + config.json (deep merge), path config
  setup.js                start pertama dari source: mengunduh tool dan model yang belum ada
  services.js             menjalankan whisper-server dan llama-server, deteksi GPU, health
  tts.js                  text to speech: klip → cache → Piper / suara Windows / OmniVoice
  pronounce.js            kamus pelafalan (QR → kyu ar, Q-Booth → Kyubuth, …)
  stt.js                  speech to text: prompt kosakata per layar, filter halusinasi
  chat.js                 percakapan: system prompt, tool, intent router, gaya bicara, LLM
  persona.js              5 kepribadian (teks gaya + kecepatan suara)
  live.js                 proxy Gemini Live (/live): setup, suara, tool
  settings.js             field yang bisa diubah, baca/simpan, Local API hubungkan/jalankan/hentikan, tes LLM
  mock-qbooth.js          Local API aplikasi booth palsu untuk pengujian (port 8739)
  openrouter-login.js     "Login dengan OpenRouter" (OAuth PKCE), menyimpan key
  avatar-info.js          membaca nama/pembuat/lisensi/thumbnail sebuah VRM
  listen.js               listen dengan retry (salinan lama yang sedang menutup mungkin masih memegang port)
  electron/main.js        jendela overlay, shortcut, watchdog, dialog file, keluar
  public/                 halaman (tanpa langkah build, ES module + import map)
    index.html            import map: three, three/addons, @pixiv/three-vrm
    main.js               penyambungan: polling, ketuk / tahan, loop hands-free, Live, tombol, bentuk
    layout.js             mode atur posisi: geser karakter dan tiap tombol, − / +
    avatar.js             memuat VRM, gerakan idle, gestur, pose berpikir, kotak garis luar
    avatar-editor.js      warna, kacamata, galeri model, gender suara
    voice.js              pemutaran audio, lip sync, prefetch per kalimat, PCM Live
    mic.js                mikrofon, deteksi suara, encoding WAV, sensitivitas
    brain.js              apa yang diucapkan saat layar aplikasi booth berubah
    lines.js              semua kalimat tetap yang diucapkan dan label UI: id / en / zh
    boot.js               layar start-up (unduhan, langkah, progres)
    settings.js           layar pengaturan dalam tab (label id / en / zh)
    live.js, qbooth.js    client Gemini Live; client Local API (lewat /qb/*)
    brand.js              nama aplikasi booth ({booth} di teks), juga dipakai server
    avatars/              8 model VRM + avatars.json (nama, gender)
    voice/                klip pra-render dari kalimat tetap (suara wanita)
  tools/                  binary, tidak di git (diunduh saat start pertama)
  models/                 file model, tidak di git (diunduh saat start pertama)
  cache/tts/              suara yang sudah dirender (wav), dipakai ulang
  logs/                   app.log, stt.log, llm.log
  dist/                   app yang sudah di-package
```

---

## 4. Membangun dari nol

### 4.1 Prasyarat

- Windows 10/11 x64.
- Node.js 22 (termasuk npm).
- Internet saat start pertama (sekitar 1,1 GB tool dan model), atau salinan `tools/` dan
  `models/` dari build portable.
- Opsional: GPU NVIDIA dengan driver terbaru (runtime CUDA 12 sudah ikut di dalam build CUDA
  whisper). GPU Vulkan apa pun bisa dipakai untuk LLM; GPU tidak wajib.

### 4.2 Project Node

```bash
npm init -y            # then set "type": "module", "main": "electron/main.js"
npm install three@0.186 @pixiv/three-vrm@3.5 ws@8
npm install -D electron@45 @electron/packager@20
```

Server menyajikan `node_modules/three/` di `/vendor/three/` dan file modul three-vrm di
`/vendor/three-vrm/`, sehingga halaman meng-import keduanya lewat import map tanpa bundler.

### 4.3 Binary dan model: diunduh saat start pertama (`setup.js`)

Source tidak berisi `tools/` atau `models/`. Saat start pertama `setup.js` mengunduh apa yang
dipakai config dan belum ada, satu file per satu waktu, sebelum server AI dijalankan; layar
start-up menampilkan progresnya.

| Tujuan | Apa, dari mana | Ukuran |
|---|---|---|
| `tools/llama/` | zip llama.cpp b11982 Windows Vulkan (release `github.com/ggml-org/llama.cpp`) | 37 MB |
| `models/Qwen3.5-0.8B-Q8_0.gguf` | `huggingface.co/unsloth/Qwen3.5-0.8B-GGUF` | 774 MB |
| `tools/whisper/` | whisper.cpp b5454 `whisper-blas-bin-x64.zip` (`github.com/ggml-org/whisper.cpp`) | 21 MB |
| `models/ggml-small-q5_1.bin` | `huggingface.co/ggerganov/whisper.cpp` | 181 MB |
| `tools/piper/` | Piper 2023.11.14-2 `piper_windows_amd64.zip` (`github.com/rhasspy/piper`) | 21 MB |
| `tools/piper/<voice>.onnx(.json)` | `huggingface.co/rhasspy/piper-voices` (path diturunkan dari nama suara) | masing-masing 60 MB |
| `tools/whisper-cuda/` + `models/ggml-large-v3-turbo-q5_0.bin` | whisper.cpp b5454 `whisper-bin-win-cuda-12.4.0-x64.zip` + Hugging Face; **hanya dengan GPU NVIDIA, di background, dipakai mulai start berikutnya** | 653 + 547 MB |

Cara kerjanya:
- `ensureParts(cfg)` berjalan di dalam `startServices()` sebelum daftar GPU dibaca; `boot.js`
  di halaman mem-poll `GET /services` (`setup: { state, label, step, steps, done, total, expect }`)
  dan menampilkan "Mengunduh (sekali saja): Model otak AI (2/8) · 385 / 774 MB".
- Unduhan masuk ke `<file>.part`, dilanjutkan dengan request HTTP `Range` setelah terputus;
  tidak ada data selama 60 detik membatalkan unduhan; 3 kali coba per bagian. Zip dibongkar
  dengan `tar.exe` bawaan Windows dan folder yang berisi exe dipindahkan file per file (suara
  Piper yang sudah ada tetap).
- Dilewati: bagian LLM untuk otak yang hanya cloud (`llm.fallbackLocal: false`), apa pun yang
  punya `url` (server di tempat lain), path kustom yang tidak punya unduhan di app.
- **"Sudah punya filenya? Pilih <file>"** (app desktop): selama sebuah bagian diunduh, sebuah
  tombol membuka dialog file (`POST /app/pick-part` → Electron `dialog.showOpenDialog`). Model
  atau suara disalin masuk kalau tipe dan ukurannya sama dengan unduhan; untuk program, pengguna
  memilih `.zip` release-nya atau exe-nya di dalam folder yang sudah ada (seluruh folder
  disalin). Unduhan dibatalkan dan `.part`-nya dihapus.
- Bagian yang gagal tampil di layar start-up; app tetap jalan dengan apa yang ada.
- `"autoDownload": false` mematikannya.

Dites dari folder kosong: 9 bagian dalam 150 detik, lalu pengenalan suara (CPU) dan LLM (GPU)
berjalan dengan file yang diunduh; bagian GPU menyusul di background.

### 4.4 Menjalankan saat development

```bash
npm run app:mock          # app desktop dengan aplikasi booth palsu bawaan
npm run app               # app desktop, aplikasi booth asli (pengaturan Local API di config.json)
node server.js --mock     # halaman + server AI + aplikasi booth palsu, tanpa jendela overlay
# open http://127.0.0.1:3920/?autostart=1&debug=1 in Chrome or Edge
```

`?autostart=1` melewati layar "Sentuh untuk mengaktifkan asisten" (browser butuh satu sentuhan
sebelum audio), `?debug=1` menampilkan panel debug (apa yang didengar / diucapkan) dan
mengekspos `window.assistant`.

### 4.5 Package

```bash
npm run build
# → dist/Avatar-win32-x64/Avatar.exe  (~3,4 GB dengan tools + models)
```

Build tidak menyertakan `dist`, `cache`, `logs` dan `config.json`.
Karena `--no-asar`, perbaikan kode bisa langsung disalin ke `resources/app/`. Untuk zip
portable: build ke folder bersih, tambahkan readme, pastikan tidak ada `config.json`, log atau
key di dalamnya, lalu zip dengan .NET `ZipFile.CreateFromDirectory` (zip64 buatan `tar` tidak
bisa dibaca Windows).

---

## 5. Tiap bagian secara rinci

### 5.1 Jendela overlay (`electron/main.js`)

- **Menutupi seluruh layar** (`display`), transparan, tanpa bingkai, `alwaysOnTop` di level
  `screen-saver`, ditegaskan ulang tiap 1,5 detik (aplikasi booth menaikkan jendela kiosk-nya
  saat event dibuka). Ditampilkan dengan `showInactive()`: aplikasi booth tetap memegang fokus
  keyboard.
- **`setBounds(display.bounds)` setelah ditampilkan dan di loop 1,5 detik**: kalau tidak,
  Windows mengecilkan jendela tanpa bingkai ke work area (1032 px, bukan 1080, di atas taskbar).
- **Dipotong sesuai yang tampil** (`win.setShape(rects)`): halaman mengirim persegi panjang ke
  `POST /app/shape` tiap 250 ms kalau ada yang bergeser (langkah 8 px): kotak karakter dari
  tulangnya (`Avatar.screenBox`), gelembung berpikir, kedua tombol, daftar bahasa, kotak boot.
  Bagian layar lainnya sama sekali tidak punya jendela. Selama pengaturan, layar bahasa, editor
  avatar atau mode atur posisi terbuka, bentuknya seluruh layar.
- **Shortcut global** (aplikasi booth memegang fokus, jadi tombol keyboard di halaman tidak akan
  sampai): Ctrl+Alt+Shift+S pengaturan, Ctrl+Alt+Shift+P atur posisi, Ctrl+Alt+Shift+Q keluar.
- **Hanya satu salinan sekaligus** (`requestSingleInstanceLock`); urutan start: server →
  jendela → server AI setelah paint pertama (atau 10 detik).
- **Pemulihan**: proses halaman hilang → reload; tidak responsif 10 detik → crash dan reload;
  proses GPU hilang → reload; watchdog frame (`window.__frames` diam 8 detik) → restart proses
  GPU.
- `screenGpu`: `auto`, `nvidia` (`force_high_performance_gpu`), `software` (SwiftShader).

### 5.2 Layout (`public/layout.js`)

- Posisi berupa **pecahan layar**: `overlay.layout = { char: { x, y, h }, lang: { x, y },
  menu: { x, y } }`, disimpan lewat `POST /app/layout`.
- Sebelum atur posisi pertama: `overlay.side` (pojok kanan / kiri bawah) dan `overlay.size`
  (% tinggi layar); tombol-tombol berada di pojok atas karakter.
- Mode atur posisi (Ctrl+Alt+Shift+P atau Pengaturan → Tampilan → "Atur posisi karakter &
  tombol…"): bingkai putus-putus di sekitar karakter dan tiap tombol, geser masing-masing
  sendiri-sendiri, − / + untuk ukuran karakter, Atur ulang, Selesai.

### 5.3 Kontrol

| | |
|---|---|
| Ketuk karakter | Bicara (atau hands-free: `listenMode` auto / wake) |
| Tahan karakter 5 detik | Pengaturan (PIN kalau diisi) |
| Tombol bahasa (globe) | Bahasa Indonesia / English / 中文; minta PIN kalau diisi (`overlay.langPin`) |
| Tombol menu (☰) | Pengaturan (PIN kalau diisi). Kedua tombol bisa dimatikan |
| Ctrl+Alt+Shift+S / P / Q | Pengaturan / atur posisi / keluar (global) |
| F12, Ctrl+Q, D, T | DevTools, keluar, panel debug, ketik pertanyaan (jendela sedang fokus) |

### 5.4 Route server (`server.js`)

| Route | Fungsi |
|---|---|
| `GET /`, file statis | halaman; `/vendor/three/`, `/vendor/three-vrm/` dari node_modules |
| `GET /config.json` | config publik untuk halaman (tidak pernah berisi key, password atau PIN) |
| `GET /services` | status speech-to-text, LLM (lokal / cloud) dan unduhan start pertama |
| `GET /speak?lang=&text=` | WAV dari teks (klip / cache / engine) |
| `POST /listen?lang=` | WAV masuk → `{ text, ms }` (prompt kosakata dari layar saat ini) |
| `POST /chat` | `{ text, lang }` → stream NDJSON: kalimat yang diucapkan, aksi, timing |
| `/qb/*` | proxy ke Local API aplikasi booth `/api/v1/*` (password Bearer ditambahkan di server) |
| `POST /app/shape`, `/app/layout`, `/app/pick-part` | bentuk jendela, layout, file "sudah punya" |
| `GET/POST /settings`, `/settings/unlock`, `/settings/test`, `/settings/booth`, `/settings/test-llm`, `/settings/openrouter-login`, `/settings/language`, `/settings/quit` | pengaturan (header PIN), Local API hubungkan / jalankan / hentikan, tes LLM, login OpenRouter, bahasa (tanpa PIN), keluar |
| `GET/POST /avatars`, `/avatar-thumb` | daftar dan upload VRM, thumbnail |
| WebSocket `/live` | proxy Gemini Live (key tetap di server) |

### 5.5 Local API aplikasi booth

- Aplikasi booth hadir dalam tiga build brand dengan Local API yang sama: QBooth.exe (melapor
  "QBooth", ditulis "Q-Booth"), BleepShare.exe ("BleepShareAI") dan XBooth.exe ("XBooth"). Nama
  yang tampil dan diucapkan berasal dari `status.app.name` (`public/brand.js`), atau pengaturan
  **Nama brand** (`brandName`), atau sebelum pernah tersambung kata netral ("aplikasi booth" /
  "the booth app" / "拍照亭应用"). Tab pertama pengaturan memakai nama itu (mis. "XBooth"; "Booth"
  sebelum tersambung). Mock melapor "QBooth" kecuali `mockBrand` atau `QBA_MOCK_BRAND` menyebut
  yang lain.
- Di aplikasi booth: Settings → Advanced → **Local API** (mode Expert): nyalakan; ia
  mendengarkan di sebuah port (default 8730) dengan password.
- Panggilan: `GET /api/v1/status`, `GET /api/v1/events`, `GET /api/v1/templates`,
  `POST /api/v1/<command>` dengan `Authorization: Bearer <password>`.
- Status memberi halaman (`welcome`, `templatePicker`, `camera`, `result`…), sesi, fase kamera
  (`liveIdle`, `counting`, `capturing`, `review`), flag sibuk dan perintah yang `available`.
  App hanya menawarkan tool yang ada di `available`.
- Pengaturan → tab booth (bernama brand-nya): alamat, port, password → **Hubungkan** mengisi daftar **Event** (jumlah
  template, yang sedang berjalan ditandai); **Jalankan** / **Hentikan** memulai dan mengakhiri
  event; "Jalankan event ini saat app dibuka" (`qbooth.autoStart`) menjalankannya begitu aplikasi
  booth menjawab, kalau belum ada yang berjalan. Error datang sebagai kode (`offline`, `unauthorized`,
  `too_many_attempts`, `event_running`, `editor_open`, `dialog_open`, …) yang ditampilkan dalam
  bahasa UI.
- Di editor event aplikasi booth, monitor output event = layar tempat karakter berada.
- `mock-qbooth.js` mengimplementasikan API yang sama di port 8739 (`--mock` atau Pengaturan →
  Koneksi → Mock). Hubungkan selalu mengetes field alamat yang asli.

### 5.6 Cara ia memandu (`public/brain.js`, `lines.js`, `chat.js`)

- **brain.js**: halaman mem-poll `/qb/status` tiap 400 ms; tiap halaman aplikasi booth atau fase
  kamera yang baru memberi satu kalimat tetap dengan gestur (welcome, template picker, siap,
  hitung mundur, review, proses, hasil). Diam di Welcome → ajakan tiap `idleInviteSec`.
- **chat.js**: kata-kata tamu + status aplikasi booth → LLM dengan tool untuk persis perintah
  yang diterima aplikasi booth saat itu. Tool: `start_session` → `session/start`, `choose_template` →
  `template/select`, `take_photo` → `camera/capture`, `retake_photo` → `camera/retake`,
  `process_photo` → `camera/process`, `print_photo` → `result/print`, `show_qr` → `result/qr`,
  `start_over` / `finish_session` → `session/end`.
- **Intent router di kode** (`routeIntent`) sebelum LLM mana pun: regex per bahasa (`INTENTS`,
  `INTENTS_ZH`), kata "lanjut" ("lanjut", "proses", "ayo", "mulai"), fuzzy matching terhadap
  kata-kata di layar saat ini (edit distance), `START_OVER` ("mulai lagi", "let's start over").
  **Tidak ada lompat layar**: template hanya dipilih di template picker; menyebut nama template
  di Welcome justru memulai sesi. Pertanyaan dan kalimat negatif ("bisa cetak?", "jangan foto
  dulu") bukan perintah. Angka menghitung kartu aplikasi booth sesuai urutannya di layar.
- **Intent picker**: kalimat yang terlewat oleh regex masuk ke klasifikasi JSON-schema kecil di
  slot kedua LLM (`id_slot` 1); ia tidak pernah memilih cetak atau selesai sendiri.
- **Perintah yang dirutekan dijawab dengan kalimat tetap** (`ACK`), tanpa menunggu LLM
  (0,01 detik).
- **Harga**: model kecil suka mengarang harga, jadi pertanyaan harga mendapat jawaban tetap
  (`PRICE`).
- **System prompt**: nama, persona, gaya bicara, bahasa, nama dan alur aplikasi booth, info acara (satu-satunya
  fakta yang boleh ia berikan), aturan (kalimat lisan pendek, jangan pernah mengaku melakukan
  aksi yang tidak dilakukan, jangan pernah menyebut model atau software). Isinya tetap sama
  sepanjang percakapan (prompt cache); status booth ikut di tiap pesan pengguna.

### 5.7 Gaya bicara (`talk`)

| Level | Aturan prompt | Batas kalimat | Budget token lokal |
|---|---|---|---|
| `short` | 1-2 kalimat, ≤ 25 kata | 2 | 120 |
| `normal` (default) | 2-3 kalimat, ≤ 45 kata, boleh bertanya balik | 3 | 200 |
| `chatty` | 3-5 kalimat, ≤ 70 kata, obrolan ringan, selalu bertanya balik | 5 | 320 |

Rata-rata terukur dengan model 0.8B: 10 / 20 / 35 kata.

### 5.8 Kecepatan

| (LLM lokal di CPU, i7-13700HX) | sebelum | sekarang |
|---|---|---|
| pertanyaan pertama setelah app dibuka | 5,7 dtk | 0,6 dtk |
| sebuah pertanyaan | 1-2 dtk | sekitar 1 dtk |
| perintah yang jelas | menunggu LLM | 0,01 dtk |

- llama.cpp `--parallel 2 -c 12288`: slot 0 percakapan, slot 1 intent picker, keduanya di-cache.
- **Warm-up prompt cache** (`Chat.warm`, `warmUp`): setelah start dan setelah ganti bahasa,
  avatar, gaya bicara, persona, nama atau info acara.
- **Kalimat tetap disuarakan saat start** di background (`cache/tts`).
- **Prefetch suara per kalimat**: kalimat berikutnya dirender selagi kalimat saat ini diputar.
- Sampling untuk Qwen: `top_p 0.8, top_k 20, presence_penalty 1.5` (model 2B Q3 berputar-putar
  tanpanya).
- **Isyarat berpikir**: dari kata terakhir tamu sampai kalimat jawaban pertama, karakter
  menaruh tangan di dagu, melihat ke atas, dan gelembung "•••" muncul di dekat kepalanya
  (`setThinking`).

### 5.9 Speech to text (`services.js`, `stt.js`, `public/mic.js`)

- whisper-server di :3921. GPU NVIDIA: build CUDA + large-v3-turbo (`-ac 0`); selain itu build
  CPU + small (`-ac 640`). Keduanya `-l auto -bo 1 -nt -nf` (tanpa temperature fallback: pada
  noise ia men-decode ulang selama 30 detik). Build CUDA yang mencatat "no GPU found" diganti
  dengan build CPU.
- **Prompt kosakata per layar** (kata `SCREEN`, nama template, nama asisten).
- **Filter halusinasi**: kredit subtitle, "terima kasih telah menonton", frasa iklan berbahasa
  Mandarin, kata berulang, output yang hanya tanda baca (sadar Unicode: filter `\W` pernah
  membuang semua kalimat Mandarin).
- **Filter gema** hanya untuk 4 kata atau lebih (jawaban pendek seperti "Proses." dulu terbuang
  sebagai gema).
- Deteksi suara di halaman: noise floor = 300 ms paling sunyi, ambang mulai / tahan terpisah,
  selesai setelah 1,1 detik hening, maksimal 12 detik; sensitivitas 1-10.
- Mode mendengar: `tap`, `auto` (selalu), `wake` (setelah namanya dipanggil).

### 5.10 Suara (`tts.js`, `pronounce.js`, `public/voice.js`)

- Urutan: klip pra-render (`public/voice/<lang>/`, hanya wanita) → cache → engine.
- **Suara mengikuti gender avatar** (`avatars.json`, atau Suara di editor avatar;
  `tts.voices[lang][female|male]`):

  | | wanita | pria |
  |---|---|---|
  | id | Piper news_tts | Windows OneCore "Andika" (`winrt`) |
  | en | Windows Zira | Windows David |
  | zh | Piper huayan | Windows OneCore "Kangkang" |

  Tidak terpasang (language pack Windows tidak ada) → suara gender lainnya, dan pengaturan
  menjelaskan cara memasangnya (Windows Settings → Time & language → Language & region → tambah
  bahasanya → Text-to-speech). Gemini Live memakai Puck (pria) / Kore (wanita) kalau suara yang
  dipilih bergender lain.
- **Pelafalan** (`pronounce.js`, sebelum sintesis): id `QR` → kyu ar,
  `QRIS` → kris, photobooth → fotobut, template → templet, scan → sken, upload → aplod, online
  → onlen; zh QR → 二维码, QRIS → 克里斯; kalau brand-nya Q-Booth juga id `Q-Booth` → Kyubuth,
  zh `Q-Booth` → 丘布斯; ditambah daftar milik owner sendiri
  (`pronunciations`, "tulisan = cara membacanya" per baris). Dicek dengan mengucapkannya pakai
  Piper lalu mendengarkannya kembali dengan whisper.
- Lip sync dari audio yang diputar (kekerasan suara + spektrum → VRM `aa ih ou ee oh`).

### 5.11 Avatar (`public/avatar.js`, `avatar-editor.js`)

- 8 model bawaan (`public/avatars/avatars.json`): Luma (sampel VRM 1.0, pixiv), Seed-san
  (VirtualCast; wajib mencantumkan kredit), dan enam model sampel VRoid Studio (CC0 / bebas
  dipakai sesuai meta VRM-nya): Fumiriya, Ren (pria), Shibu, Bibi, Vita, Victoria (wanita).
- **Rotasi tulang VRM 0.x dicerminkan** (X dan Z) karena `rotateVRM0` memutarnya balik: tanpa
  ini model VRoid mengangkat lengannya.
- Hanya animasi prosedural: bernapas, bergoyang, berkedip, look-at, gestur (melambai,
  mengangguk, mempersilakan), pose berpikir, pose mendengarkan.
- Editor: galeri model dengan lisensi, warna (warna kulit, rambut, mata, baju), kacamata,
  **gender suara**; disimpan per model di `avatarStyle`. File `.vrm` sendiri lewat "Tambah VRM…".

### 5.12 Pengaturan (`settings.js`, `public/settings.js`)

- Tab: **nama aplikasi booth (mis. "XBooth"), Asisten, Otak AI, Tampilan, Mikrofon, Keamanan**; menu samping di layar
  landscape, deretan tab di layar portrait; tiap tab muat tanpa scroll.
- Tabel field (`FIELDS`) menentukan tipe tiap key dan apakah perlu restart. Hanya field yang
  berubah yang dikirim; rahasia bersifat write-only (kosong = tetap).
- **PIN pengaturan** opsional (header `x-settings-pin` di setiap perubahan).
- Tab booth juga berisi **Nama brand** (`brandName`): nama yang ditampilkan dan diucapkan;
  kosong = nama yang dilaporkan aplikasi booth.
- Tes bawaan: hubungkan Local API, "Tes otak AI", meter level mic.
- Semua label dalam id / en / zh; error server datang sebagai kode yang diterjemahkan di halaman.

### 5.13 Gemini Live (`live.js`, `public/live.js`)

- Halaman membuka `ws://127.0.0.1:3920/live`; server membuka WebSocket `BidiGenerateContent`
  milik Google dengan key-nya (key tidak pernah sampai ke halaman).
- Setup: model, output audio, suara (Kore, Aoede, Leda, Zephyr, Sulafat; Puck, Charon, Fenrir,
  Orus, Achird), system instruction, tool yang sama sebagai function declaration, VAD di server,
  transkripsi aktif. Kejadian di booth dikirim sebagai giliran teks supaya Live mengucapkannya
  dengan suaranya sendiri.
- Kalau Live gagal tersambung 4 kali, mode lokal mengambil alih; Live dicoba lagi tiap 30 detik.
- "Tamu boleh memotong" (`bargeIn`) hanya dengan headset atau mic searah.

---

## 6. Referensi konfigurasi (`config.json` meng-override `config.example.json`)

| Key | Default | Arti |
|---|---|---|
| `port` | 3920 | server halaman (speech-to-text 3921, LLM 3922) |
| `mock / mockBrand` | false / (tidak diisi) | aplikasi booth palsu bawaan; nama yang dilaporkannya (tidak diisi = QBooth) |
| `qbooth.host / port / password` | 127.0.0.1 / 8730 / "" | Local API aplikasi booth |
| `brandName` | "" | nama aplikasi booth yang ditampilkan dan diucapkan ("" = yang dilaporkannya) |
| `qbooth.eventId / autoStart` | "" / false | event yang dijalankan dari pengaturan; jalankan saat start |
| `language / askLanguage` | en / true | `id`, `en`, `zh`; layar pilihan saat app dibuka |
| `assistantName / persona / talk / eventInfo` | Luma / ceria / normal / "" | siapa dia, cara bicaranya, seberapa banyak, apa yang boleh diceritakan |
| `pronunciations` | "" | baris pelafalan sendiri |
| `avatar / avatarStyle` | avatars/sample.vrm / {} | model; warna, kacamata, gender suara per model |
| `overlay.side / size / layout` | right / 70 / null | pojok awal, % tinggi layar, posisi yang sudah diatur |
| `overlay.menuButton / langButton / langPin` | true / true / true | tombol ☰ dan globe; globe minta PIN |
| `display / screenGpu` | 0 / auto | layar mana; siapa yang menggambar karakter |
| `listenMode / micDevice / micSensitivity / saveRecordings` | tap / "" / 5 / false | pendengaran |
| `idleInviteSec / pollMs` | 30 / 400 | interval ajakan; poll status |
| `llm.provider` | local | `local`, `gemini`, `openrouter`, `gemini-live` |
| `llm.fallbackLocal` | true | pertahankan LLM lokal sebagai cadangan untuk otak cloud |
| `llm.gemini.apiKey / model` | "" / gemini-3.5-flash | Gemini (bagian 7.1) |
| `llm.openrouter.apiKey / model` | "" / google/gemini-2.5-flash | OpenRouter (bagian 7.2) |
| `llm.live.model / voice / bargeIn` | gemini-3.8-live / Kore / false | Gemini Live (memakai key Gemini) |
| `llm.model / ctx / device` | models/Qwen3.5-0.8B-Q8_0.gguf / 12288 / auto | LLM lokal |
| `stt.*` | CPU small; GPU large-v3-turbo | speech to text |
| `tts.voices / tts.piper / tts.sapi` | lihat 5.10 | suara per bahasa dan gender |
| `autoDownload` | true | unduhan start pertama (4.3) |
| `settingsPin` | "" | melindungi pengaturan |

`config.json` menyimpan password Local API dan API key: jauhkan dari git, screenshot dan paket
yang dibagikan.

---

## 7. Mendapatkan API key cloud

App ini berfungsi penuh secara offline dengan AI lokalnya. Otak cloud menjawab obrolan ringan
dengan lebih baik dan butuh API key. Key ditempel di **Pengaturan → Otak AI** (tahan karakter 5
detik, atau Ctrl+Alt+Shift+S), hanya disimpan di `config.json` di PC itu, dan tidak pernah
ditampilkan lagi (field-nya bertuliskan "tersimpan (kosongkan = tetap)").

| Otak (Pengaturan → Otak AI → "Dijalankan oleh") | Key dari | Catatan |
|---|---|---|
| Gemini (cloud, Google) | Google AI Studio | free tier dengan batas harian; billing untuk acara |
| OpenRouter (cloud) | OpenRouter | satu key untuk banyak model; bayar per pemakaian dengan kredit |
| Gemini Live (suara realtime, cloud) | **key Google AI Studio yang sama** | key OpenRouter tidak bisa dipakai untuk Live |
| Komputer ini (offline) | tidak perlu | default |

### 7.1 API key Google Gemini (Google AI Studio)

1. Buka **https://aistudio.google.com/apikey** di browser dan login dengan akun Google
   (pakai akun bisnis yang akan menerima tagihan).
2. Pertama kali: setujui Terms of Service. AI Studio lalu membuatkan project Google Cloud
   default untukmu. (Pengguna Google Cloud yang sudah ada bisa memakai **Dashboard → Projects →
   Import projects** untuk memilih project yang sudah ada.)
3. Klik **Create API key**, pilih project-nya, lalu buat. Salin key-nya (berupa string
   panjang; perlakukan seperti password).
4. Disarankan: di halaman API Keys, di sebelah label **Unrestricted** milik key itu, klik **Add
   restrictions → Restrict to Gemini API only → Restrict key**. Google menolak atau memblokir
   key tanpa batasan dalam beberapa kasus, dan key yang dibatasi lebih aman kalau bocor.
5. Di Avatar: **Pengaturan → Otak AI → Dijalankan oleh: Gemini (cloud, Google)**, tempel
   key di **API key**, biarkan model `gemini-3.5-flash` (atau nama model Gemini lain), biarkan
   **"Pakai AI lokal kalau cloud gagal"** menyala, tekan **Tes otak AI**, lalu **Simpan**.
6. Untuk **Gemini Live**: pilih **Dijalankan oleh: Gemini Live (suara realtime, cloud)**; field
   key yang sama dipakai. Pilih suara; biarkan "Tamu boleh memotong" mati kecuali tamu bicara
   lewat headset atau mic searah.

**Free tier dan billing.** Project baru berada di Free Tier: gratis, tapi punya batas request
per menit dan per hari yang kecil untuk tiap model (lihat halaman rate limit project di AI
Studio), dan batas itu bisa habis saat acara ramai; app lalu menjawab dengan AI lokal dan
menampilkan peringatan "quota / 429". Untuk acara:
1. Di AI Studio buka **API keys** atau **Projects** dan klik **Set up billing** di kolom
   *Billing Tier* milik project itu.
2. Pilih negara, konfirmasi detail kontak dan metode pembayaran.
3. Bayar dengan **Prepay** (beli kredit di halaman Billing AI Studio: **Buy credits**, minimal
   $5; request gagal dengan HTTP 402 kalau saldo $0; tersedia auto-reload) atau **Postpay**
   (ditagih bulanan), mana saja yang ditawarkan AI Studio.
4. Menautkan akun billing memindahkan project ke **Tier 1** (batas lebih tinggi) hampir seketika.
   Pasang billing alert di Google Cloud console.

Di tier berbayar Google tidak memakai prompt dan jawaban untuk meningkatkan produknya; di free
tier, cek ketentuan yang berlaku saat ini. Bagaimanapun juga, kata-kata tamu dikirim ke Google:
sampaikan hal itu kalau acaranya memerlukan.

Kalau key bocor: buat key baru, masukkan ke app, lalu hapus atau nonaktifkan key lama di AI
Studio dan cek pemakaiannya.

### 7.2 API key OpenRouter

OpenRouter adalah satu akun dan satu key untuk model dari banyak penyedia (Google, OpenAI,
Anthropic, Meta, …). Ada dua cara memasukkan key ke app:

**A. "Login dengan OpenRouter" (paling mudah, di dalam app)**
1. Pengaturan → Otak AI → Dijalankan oleh: **OpenRouter (cloud)** → **Login dengan OpenRouter**.
2. Browser membuka halaman sign-in OpenRouter; login (atau buat akun) dan setujui
   "Avatar". Key yang dibuat OpenRouter dengan cara ini diberi label "Avatar" di
   daftar Keys-mu.
3. App menerima key-nya sendiri (OAuth PKCE lewat callback lokal sekali pakai) dan menampilkan
   "✓ Terhubung, key tersimpan". Tekan **Tes otak AI**, lalu **Simpan**.

**B. Membuat key secara manual**
1. Login di **https://openrouter.ai** dan buka **https://openrouter.ai/settings/keys**
   (Keys).
2. Klik **Create Key**, beri nama (mis. "Avatar – booth 1") dan **pasang batas kredit**
   (OpenRouter menyarankan batas di setiap key: kalau tidak, key yang bocor bisa menghabiskan
   seluruh saldo).
3. Salin key-nya (diawali `sk-or-v1-`; hanya ditampilkan sekali).
4. Tempel di Pengaturan → Otak AI → **API key**, atur **Model** (default
   `google/gemini-2.5-flash`; id model apa pun dari https://openrouter.ai/models bisa dipakai),
   tekan **Tes otak AI**, lalu **Simpan**.

**Kredit.** Model berbayar butuh kredit: **https://openrouter.ai/settings/credits** → tambah
kredit dengan kartu (juga kripto; tersedia auto top-up; ada biaya kecil untuk pembelian,
inference tanpa mark-up). Kredit yang belum terpakai bisa di-refund dalam 24 jam. Model gratis
(id berakhiran `:free`) tidak butuh kredit tapi dibatasi total 50 request sehari (1000 sehari
setelah membeli minimal 10 kredit): terlalu sedikit untuk sebuah acara.

Kalau key bocor: hapus di https://openrouter.ai/settings/keys dan buat yang baru. OpenRouter
juga memindai GitHub untuk key yang terekspos dan mengirim e-mail ke pemiliknya.

### 7.3 Password Local API aplikasi booth

Bukan key cloud, tapi diatur dengan cara yang sama: aplikasi booth → Settings → Advanced →
**Local API** (mode Expert) → nyalakan, catat port dan password-nya → Pengaturan Avatar → tab
booth → alamat (127.0.0.1 di PC yang sama), port, password → **Hubungkan**.

### 7.4 Aturan untuk key

- Jangan pernah menaruh key di git, screenshot, video atau paket yang dibagikan. Build portable
  dan salinan source dicek untuk hal ini sebelum dibagikan (tidak ada `config.json` di dalamnya).
- Pakai key terpisah (atau batas kredit) per PC booth supaya satu key bisa dicabut sendiri.
- Biarkan "Pakai AI lokal kalau cloud gagal" menyala: internet di venue suka putus.

---

## 8. Pelajaran (lakukan ini sejak awal)

1. **Jangan pernah percaya model kecil untuk bertindak**: rutekan perintah yang jelas di kode,
   beri setiap hasil tool petunjuk `next`, larang mengaku melakukan aksi di prompt, jawab harga
   dengan kalimat tetap.
2. **Tidak ada lompat layar**: perintah hanya untuk layar yang ditampilkan aplikasi booth (`available`).
3. **Latensi**: awalan prompt yang konstan + warm-up cache, dua slot llama, kalimat tetap yang
   sudah disuarakan lebih dulu, prefetch suara per kalimat, whisper tanpa temperature fallback.
4. **Jendela overlay**: `setShape` untuk click-through, `setBounds` setelah ditampilkan (work
   area mengecil), tegaskan ulang always-on-top, `showInactive` (jangan pernah mencuri fokus
   aplikasi booth), shortcut global.
5. **VRM 0.x butuh rotasi tulang yang dicerminkan.**
6. **Pendengaran**: filter yang sadar Unicode, filter gema hanya untuk frasa panjang, kosakata
   layar.
7. **Ketahanan kiosk**: satu instance, retry port, matikan sisa server AI berdasarkan path
   (`Get-Process`; WMI butuh satu menit di laptop uji), watchdog.
8. **Rahasia** hanya ada di server; halaman mendapat config yang sudah difilter; paket dipindai.
9. **File besar diunduh, tidak dikirim di dalam source**, dengan resume dan "sudah punya".
10. **Tes tanpa hardware**: Local API mock, headless Chrome lewat DevTools untuk screenshot;
    jangan pernah membuka jendela app di layar kerja owner untuk tes.

---

## 9. Resep pengujian (tanpa booth, tanpa layar)

1. `node server.js --mock` (atau salinan dengan port `config.json` sendiri).
2. Headless Chrome dengan `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream
   --autoplay-policy=no-user-gesture-required --remote-debugging-port=…`, buka
   `/?autostart=1&lang=id&debug=1`.
3. Kendalikan: `fetch('/qb/session/start', {method:'POST'})`, `/qb/status`, `window.assistant`,
   `window.__qba.settings()`; screenshot dengan `Page.captureScreenshot`
   (`Emulation.setDefaultBackgroundColorOverride` transparan untuk ditumpuk di atas layar
   aplikasi booth).
4. Tes intent: script unit `routeIntent` dengan kalimat yang belum pernah dilihat di tiap bahasa.
5. Hentikan server dan server AI setelahnya dan pastikan port-nya kosong.

Headless Chrome memakai GPU software: tes juga overlay hasil package di PC tujuan.

---

## 10. Status dan masalah yang diketahui (2026-10-30)

Berfungsi dan sudah dites headless: alur Local API (mock), routing intent (id / en / zh), gaya
bicara, isyarat berpikir, tab pengaturan, tombol bahasa + PIN, atur posisi, editor avatar dan
gender suara, unduhan start pertama (dari kosong, resume, "sudah punya"), paket portable.

Belum selesai:
- Overlay Electron yang asli di atas event aplikasi booth yang berjalan, mikrofon asli dan dialog file
  "sudah punya" belum dites owner di PC booth.
- Suara pria Indonesia / Mandarin butuh language pack Windows (tidak terpasang di laptop uji:
  suara wanita yang bicara sebagai gantinya).
- Batas free tier Gemini kecil; pakai key berbayar di acara.
