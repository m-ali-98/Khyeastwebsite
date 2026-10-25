/* SIGTERM must drain an active request before SQLite or other shared resources
   are closed, while a bounded timeout still handles a wedged connection. */
import { createGracefulShutdown } from '../../server/gracefulShutdown.js';

let pass = 0;
let fail = 0;
const check = (ok, name, detail = '') => {
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`LEAK ${name}${detail ? ` — ${detail}` : ''}`);
  }
};
const quiet = { log() {}, error() {} };

try {
  let finishHttp;
  let resourceCloses = 0;
  let idleCloses = 0;
  const exits = [];
  const server = {
    close(callback) { finishHttp = callback; },
    closeIdleConnections() { idleCloses += 1; },
    closeAllConnections() {},
  };
  const shutdown = createGracefulShutdown({
    server,
    closeResources: () => { resourceCloses += 1; },
    timeoutMs: 5_000,
    exit: (code) => exits.push(code),
    logger: quiet,
  });

  check(shutdown('SIGTERM') === true, 'the first signal starts graceful shutdown');
  check(resourceCloses === 0 && exits.length === 0, 'resources remain open while an HTTP request is active');
  check(idleCloses === 1, 'idle keep-alive sockets are reaped during drain');
  check(shutdown('SIGINT') === false, 'a second signal cannot start a competing shutdown');
  finishHttp();
  check(resourceCloses === 1 && exits.join(',') === '0', 'resources close once after HTTP drain completes');

  let forcedCloses = 0;
  let forcedResources = 0;
  const forcedExits = [];
  const wedged = createGracefulShutdown({
    server: {
      close() {},
      closeIdleConnections() {},
      closeAllConnections() { forcedCloses += 1; },
    },
    closeResources: () => { forcedResources += 1; },
    timeoutMs: 10,
    exit: (code) => forcedExits.push(code),
    logger: quiet,
  });
  wedged('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 30));
  check(
    forcedCloses === 1 && forcedResources === 1 && forcedExits.join(',') === '1',
    'a wedged connection is force-closed after the bounded grace period',
    JSON.stringify({ forcedCloses, forcedResources, forcedExits }),
  );
} catch (error) {
  check(false, 'graceful shutdown harness', error?.stack || String(error));
}

console.log(`${pass}/${pass + fail}`);
if (fail) process.exit(1);
