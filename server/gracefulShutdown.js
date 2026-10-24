/* Stop accepting new HTTP work, let active requests finish, then close shared
   resources. This matters most for a payment callback that is already between
   gateway verification and its final SQLite commit when systemd sends SIGTERM. */
export function createGracefulShutdown({
  server,
  closeResources,
  timeoutMs = 90_000,
  exit = (code) => process.exit(code),
  logger = console,
} = {}) {
  if (!server || typeof server.close !== 'function') throw new TypeError('an HTTP server is required');
  if (typeof closeResources !== 'function') throw new TypeError('closeResources must be a function');

  let stopping = false;
  let completed = false;
  let resourcesClosed = false;

  const closeOnce = () => {
    if (resourcesClosed) return null;
    resourcesClosed = true;
    try {
      closeResources();
      return null;
    } catch (error) {
      logger.error?.('[content-api] resource shutdown failed:', error);
      return error;
    }
  };

  return (signal = 'shutdown') => {
    if (stopping) return false;
    stopping = true;
    logger.log?.(`[content-api] ${signal} received; draining active HTTP requests`);

    const forceTimer = setTimeout(() => {
      if (completed) return;
      completed = true;
      logger.error?.(`[content-api] graceful shutdown exceeded ${timeoutMs}ms; forcing close`);
      try { server.closeAllConnections?.(); } catch {}
      closeOnce();
      exit(1);
    }, Math.max(1, Number(timeoutMs) || 90_000));
    forceTimer.unref?.();

    const finished = (error) => {
      if (completed) return;
      completed = true;
      clearTimeout(forceTimer);
      const closeError = closeOnce();
      if (error) logger.error?.('[content-api] HTTP shutdown failed:', error);
      exit(error || closeError ? 1 : 0);
    };

    try {
      server.close(finished);
      /* server.close() stops new accepts. Explicitly reap idle keep-alive
         sockets so only requests that are genuinely active consume the grace
         period (and for compatibility with Node releases predating that
         behavior in server.close itself). */
      server.closeIdleConnections?.();
    } catch (error) {
      finished(error);
    }
    return true;
  };
}
