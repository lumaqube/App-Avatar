// "Login with OpenRouter": an API key through OAuth PKCE, the flow OpenRouter
// documents (same as SnazzyCut's src/main/ai-oauth.js):
//   1. open https://openrouter.ai/auth?callback_url=…&code_challenge=…&code_challenge_method=S256
//      in the browser, where the owner signs in and approves;
//   2. OpenRouter redirects to callback_url with ?code=… (and our state);
//   3. POST https://openrouter.ai/api/v1/auth/keys { code, code_verifier, code_challenge_method } -> { key }
// The callback is a one-shot server on the loopback interface (random port),
// listening only until the code arrives or the wait times out.
import http from 'node:http';
import crypto from 'node:crypto';

const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:16px system-ui,sans-serif;background:#161a30;color:#eee;display:grid;place-items:center;height:90vh">
<div style="text-align:center"><h2 style="margin:0 0 8px">${title}</h2><p style="color:#aab">${body}</p></div></body>`;

// Resolves with the key; rejects with an Error whose code is timeout, denied,
// state_mismatch, exchange_failed or network.
export function loginOpenRouter({ openExternal, timeoutMs = 5 * 60 * 1000, keyLabel = 'Avatar' }) {
  const fail = (code, msg) => Object.assign(new Error(msg || code), { code });
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  return new Promise((resolve, reject) => {
    const servers = [];
    let settled = false, timer = null;
    const finish = (err, key) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const s of servers) { try { s.close(); } catch { } }
      if (err) reject(err); else resolve(key);
    };
    const handler = async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const send = ok => res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' })
        .end(ok ? page('Terhubung / Connected', 'Tutup tab ini dan kembali ke Avatar.')
          : page('Gagal / Not connected', 'Kembali ke Avatar dan coba lagi.'));
      const code = url.searchParams.get('code');
      const gotState = url.searchParams.get('state');
      if (gotState && gotState !== state) { send(false); finish(fail('state_mismatch')); return; }
      if (!code) { send(false); finish(fail('denied', url.searchParams.get('error') || 'no code')); return; }
      try {
        const r = await fetch('https://openrouter.ai/api/v1/auth/keys', {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(30000),
          body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok || typeof body.key !== 'string' || !body.key) { send(false); finish(fail('exchange_failed', `HTTP ${r.status}`)); return; }
        send(true);
        finish(null, body.key);
      } catch (err) {
        send(false);
        finish(fail('network', err.message));
      }
    };

    const main = http.createServer(handler);
    servers.push(main);
    main.on('error', err => finish(fail('network', err.message)));
    main.listen(0, '127.0.0.1', () => {
      const port = main.address().port;
      // the same port on ::1, for a browser that resolves localhost there first
      const v6 = http.createServer(handler);
      v6.on('error', () => { });
      v6.listen(port, '::1');
      servers.push(v6);
      const u = new URL('https://openrouter.ai/auth');
      u.searchParams.set('callback_url', `http://localhost:${port}/callback`);
      u.searchParams.set('code_challenge', challenge);
      u.searchParams.set('code_challenge_method', 'S256');
      u.searchParams.set('key_label', keyLabel);
      u.searchParams.set('state', state);
      timer = setTimeout(() => finish(fail('timeout')), timeoutMs);
      Promise.resolve().then(() => openExternal(u.toString())).catch(err => finish(fail('network', 'browser: ' + err.message)));
    });
  });
}
