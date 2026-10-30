// QBooth Avatar (overlay): one exe that runs the page server and the AI servers
// (speech to text, LLM, Piper: child processes) and shows only the character, on
// top of everything, QBooth's event (kiosk) window included. Closing it stops everything.
//   QBooth Avatar.exe          -> the real QBooth (config.json)
//   QBooth Avatar.exe --mock   -> the built-in fake booth (or "mock": true in config.json)
// The window is transparent and frameless, cut to the character's outline (the page
// sends it, /app/shape), so a touch anywhere else reaches QBooth underneath.
// Secret keys, from anywhere (QBooth usually has the focus):
//   Ctrl+Alt+Shift+S settings · Ctrl+Alt+Shift+P positions & size · Ctrl+Alt+Shift+Q quit
// With the window focused: F12 developer tools, Ctrl+Q quit.
import { app, BrowserWindow, session, screen, dialog, shell, globalShortcut } from 'electron';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, stopAll, setAppHooks, beginServices } from '../server.js';
import { loadOwnConfig } from '../config.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// No console in the packaged app: keep the server's messages in logs/app.log.
fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
const logPath = path.join(ROOT, 'logs', 'app.log');
for (const level of ['log', 'warn', 'error']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    try { fs.appendFileSync(logPath, `${new Date().toISOString().slice(11, 23)} [${process.pid}] ${args.join(' ')}\n`); } catch { }
    orig(...args);
  };
}
console.log('--- start');

// One copy at a time. A copy started by our own restart waits for the old one to let go.
async function getLock() {
  const tries = process.argv.includes('--relaunch') ? 80 : 1;
  for (let i = 0; i < tries; i++) {
    if (app.requestSingleInstanceLock()) return true;
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

// Restart (after a setting that needs it): start a new copy, then quit this one.
// --mock is dropped so that config.json decides (the settings screen may have changed it).
function restart() {
  const args = process.argv.slice(1).filter(a => a !== '--mock' && a !== '--relaunch').concat('--relaunch');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(process.execPath, args, { detached: true, stdio: 'ignore', env }).unref();
  app.quit();
}

if (!(await getLock())) {
  app.quit(); // already running
} else {
  // Speak without a tap first (a kiosk has nobody to tap "activate").
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  // Which GPU draws the character (config "screenGpu"): auto = Windows' choice, nvidia =
  // the discrete GPU, software = the CPU (slow, but no GPU driver involved).
  let screenGpu = 'auto';
  try { screenGpu = loadOwnConfig().screenGpu || 'auto'; } catch { }
  if (screenGpu === 'nvidia') app.commandLine.appendSwitch('force_high_performance_gpu');
  if (screenGpu === 'software') { app.commandLine.appendSwitch('use-angle', 'swiftshader'); app.commandLine.appendSwitch('enable-unsafe-swiftshader'); }
  console.log('screen GPU setting: ' + screenGpu);
  let win = null;

  app.whenReady().then(async () => {
    app.getGPUInfo('basic').then(g => {
      const act = (g.gpuDevice || []).find(d => d.active) || (g.gpuDevice || [])[0];
      console.log(`screen GPU: ${act ? `${act.deviceString || ''} (vendor 0x${(act.vendorId || 0).toString(16)})` : 'unknown'}${(g.gpuDevice || []).length > 1 ? `, ${g.gpuDevice.length} GPUs` : ''}`);
    }).catch(() => { });
    // The microphone, without a prompt: the page only ever comes from our own server.
    const allowed = ['media'];
    session.defaultSession.setPermissionRequestHandler((wc, permission, done) => done(allowed.includes(permission)));
    session.defaultSession.setPermissionCheckHandler((wc, permission) => allowed.includes(permission));

    const primary = screen.getPrimaryDisplay();
    setAppHooks({
      restart,
      quit: () => app.quit(),
      open: url => shell.openExternal(url),
      info: {
        desktop: true,
        displays: screen.getAllDisplays().map((d, i) => ({ index: i, label: `${i + 1}: ${d.size.width}×${d.size.height}${d.id === primary.id ? ' (main)' : ''}` })),
      },
    });
    let port, cfg;
    try {
      ({ port, cfg } = await startServer({ mock: process.argv.includes('--mock') || undefined, deferServices: true }));
    } catch (err) {
      dialog.showErrorBox('QBooth Avatar', err.message);
      app.quit();
      return;
    }

    // The window covers the whole chosen screen ("display"), transparent. Where the character
    // and its two buttons stand on it is the page's business (public/layout.js, "overlay.layout");
    // the window is cut to them (/app/shape), so everything else stays QBooth's.
    const displays = screen.getAllDisplays();
    const box = (displays[cfg.display ?? 0] || primary).bounds;

    win = new BrowserWindow({
      ...box,
      show: false, // shown once the start-up screen is painted
      transparent: true, frame: false, resizable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true,
      backgroundColor: '#00000000',
      title: 'QBooth Avatar',
      webPreferences: { backgroundThrottling: false },
    });
    win.setMenu(null);
    // nothing of it catches a touch until the page says what it shows
    win.setShape([{ x: 0, y: 0, width: 1, height: 1 }]);
    // QBooth raises its kiosk window to the top once, when an event opens: take the top back.
    win.setAlwaysOnTop(true, 'screen-saver');
    // Windows shrinks the window to the work area (above the taskbar) when it first shows:
    // the whole screen again, and kept so (measured: 1032 -> 1080 px on a 1080 px screen).
    const fullScreen = () => {
      const b = win.getBounds();
      if (b.x !== box.x || b.y !== box.y || b.width !== box.width || b.height !== box.height) win.setBounds(box);
    };
    setInterval(() => { if (win && !win.isDestroyed() && win.isVisible()) { fullScreen(); win.setAlwaysOnTop(true, 'screen-saver'); win.moveTop(); } }, 1500);
    console.log(`window: ${box.width}x${box.height} at ${box.x},${box.y}`);

    setAppHooks({ shape: rects => { if (win && !win.isDestroyed()) win.setShape(rects); } });
    // First start from source: the user's own copy of a model or program instead of downloading it.
    setAppHooks({
      pick: async want => {
        const exts = [...new Set([want.name.split('.').pop(), want.zip && 'zip'].filter(Boolean))];
        const r = await dialog.showOpenDialog(win, {
          title: want.zip ? `${want.name} or ${want.zip}` : want.name,
          filters: [{ name: want.name, extensions: exts }], properties: ['openFile'],
        });
        return r.canceled ? null : r.filePaths[0];
      },
    });
    const page = js => win && !win.isDestroyed() && win.webContents.executeJavaScript(js).catch(() => { });
    globalShortcut.register('Control+Alt+Shift+S', () => page('window.__qba?.settings()'));
    globalShortcut.register('Control+Alt+Shift+P', () => page('window.__qba?.position()'));
    globalShortcut.register('Control+Alt+Shift+Q', () => app.quit());

    win.webContents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'F12') { win.webContents.toggleDevTools(); e.preventDefault(); }
      else if (input.control && input.key.toLowerCase() === 'q') { app.quit(); e.preventDefault(); }
    });
    win.on('closed', () => { win = null; app.quit(); });
    // shown without taking the focus from QBooth
    win.once('ready-to-show', () => {
      win.showInactive();
      fullScreen();
      console.log(`window shown: ${JSON.stringify(win.getBounds())}`);
      beginServices();
    });
    // Frame watchdog: the page counts its animation frames (window.__frames). If its code
    // answers but the count stands still for 8 s while the window is on screen, the GPU
    // process has stopped presenting: kill it (Electron restarts it; we reload the page).
    let lastFrames = -1, stillSince = 0, lastKill = 0;
    setInterval(async () => {
      if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) { stillSince = 0; return; }
      let n;
      try { n = await Promise.race([win.webContents.executeJavaScript('window.__frames || 0', true), new Promise(r => setTimeout(() => r(null), 2000))]); } catch { n = null; }
      if (n === null) return; // the page itself is stuck: the unresponsive handler covers that
      if (n !== lastFrames) { lastFrames = n; stillSince = 0; return; }
      stillSince ||= Date.now();
      if (Date.now() - stillSince > 8000 && Date.now() - lastKill > 60000) {
        const gpu = app.getAppMetrics().find(m => m.type === 'GPU');
        console.error(`screen frozen (no frame for ${Math.round((Date.now() - stillSince) / 1000)} s): restarting the GPU process${gpu ? ' ' + gpu.pid : ''}`);
        lastKill = Date.now(); stillSince = 0;
        if (gpu) { try { process.kill(gpu.pid); } catch { } } else win.reload();
      }
    }, 2000);
    setTimeout(beginServices, 10000); // no paint yet: load anyway
    // A page that dies leaves an empty window: log why and load it again.
    const wc = win.webContents;
    wc.on('render-process-gone', (e, d) => {
      console.error(`page process gone: ${d.reason} (exit ${d.exitCode}), reloading`);
      setTimeout(() => win?.reload(), 1000);
    });
    // A kiosk must not stay frozen: a page stuck for 10 s is restarted (and reloaded above).
    let stuck = null;
    wc.on('unresponsive', () => {
      console.error('page not responding');
      clearTimeout(stuck);
      stuck = setTimeout(() => { console.error('page still stuck: restarting it'); wc.forcefullyCrashRenderer(); }, 10000);
    });
    wc.on('responsive', () => { clearTimeout(stuck); console.log('page responding again'); });
    wc.on('did-fail-load', (e, code, desc, url) => {
      console.error(`page load failed: ${code} ${desc} ${url}, retrying`);
      setTimeout(() => win?.loadURL(`http://127.0.0.1:${port}/?autostart=1`), 1500);
    });
    wc.on('did-finish-load', () => console.log('page loaded'));
    wc.on('console-message', e => { if (e.level === 'error' || e.level === 'warning') console.error(`page ${e.level}: ${e.message} (${e.sourceId}:${e.lineNumber})`); });
    win.loadURL(`http://127.0.0.1:${port}/?autostart=1`);
  });

  app.on('child-process-gone', (e, d) => {
    console.error(`electron ${d.type} process gone: ${d.reason} (exit ${d.exitCode})${d.name ? ' ' + d.name : ''}`);
    // The GPU process comes back by itself, but the avatar's 3D view does not: reload the page.
    if (d.type === 'GPU' && win && !win.isDestroyed()) setTimeout(() => win?.reload(), 1500);
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    console.log('quitting: stopping the AI servers');
    globalShortcut.unregisterAll();
    stopAll();
    // On some PCs Electron takes minutes to wind down after this (on the owner's
    // laptop: 2.5 min). Meanwhile it still holds the single-instance lock, so opening
    // the app again did nothing. Everything that matters is stopped: release the lock
    // and end Electron's own helper processes (GPU, renderer, ...) and this one now.
    app.releaseSingleInstanceLock();
    const helpers = app.getAppMetrics().map(m => m.pid).filter(pid => pid !== process.pid);
    for (const pid of helpers) try { process.kill(pid); } catch { }
    console.log(`stopped ${helpers.length} helper processes; ending`);
    process.kill(process.pid);
  });
}
