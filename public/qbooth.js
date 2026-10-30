// QBooth Local API client. Goes through our own server (/qb/* -> /api/v1/*),
// which adds the password.
async function call(method, path, body) {
  try {
    const r = await fetch('/qb/' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await r.json();
    return { http: r.status, ...json };
  } catch (err) {
    return { http: 0, ok: false, error: { code: 'offline', message: String(err) } };
  }
}

export const qb = {
  status: () => call('GET', 'status'),
  templates: () => call('GET', 'templates'),
  action: (cmd, body) => call('POST', cmd, body),
};
