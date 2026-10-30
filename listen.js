// server.listen() that waits for a busy port instead of failing straight away.
// Right after the app is closed, Windows can take some seconds to fully end the
// old process (on the owner's laptop, process teardown is slow), and its port
// stays taken until then; reopening the app at that moment should just wait.
export function listenRetry(server, port, host = '127.0.0.1', { tries = 40, delayMs = 500 } = {}) {
  return new Promise((resolve, reject) => {
    let left = tries;
    const attempt = () => server.listen(port, host);
    server.on('error', err => {
      if (err.code === 'EADDRINUSE' && --left > 0) setTimeout(attempt, delayMs);
      else reject(err);
    });
    server.once('listening', () => resolve(server));
    attempt();
  });
}
