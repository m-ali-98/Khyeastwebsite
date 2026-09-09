/* ==========================================================================
   useLoadingGate — decides *whether* and *when* to show a loading state.

   A loading indicator that appears on a fast connection is worse than none at
   all: it flashes for 80 ms and reads as a glitch. But a fixed delay is just a
   guess — 180 ms is far too eager on fibre and far too patient on 3G, where
   the user is left staring at a dead page wondering if their tap registered.

   So the delay is derived from the connection instead of hardcoded, and once
   the indicator does appear it is held for a minimum beat so it can never
   flash-and-vanish.

   Returns one of:
     'hidden'  — nothing yet; the content will probably win the race
     'visible' — show the loading state
   ========================================================================== */
import { useEffect, useRef, useState } from 'react';

/* How long to wait before conceding that this is a real wait, by connection
   quality. Below the threshold the content almost always arrives first, so
   showing anything would be pure noise. */
const DELAY_BY_TYPE = {
  'slow-2g': 60,
  '2g': 80,
  '3g': 140,
  '4g': 220,
};
const DEFAULT_DELAY = 180;

/* Once shown, keep it up at least this long. Prevents the "flash of skeleton"
   when the chunk lands 20 ms after we gave up waiting. */
const MIN_VISIBLE = 320;

export function loadingDelay() {
  if (typeof navigator === 'undefined') return DEFAULT_DELAY;
  const c = navigator.connection;
  if (!c) return DEFAULT_DELAY;

  /* Data Saver / very slow links: show feedback almost immediately, because
     the wait is guaranteed to be long and silence is the worst outcome. */
  if (c.saveData) return 60;

  const byType = DELAY_BY_TYPE[c.effectiveType];
  if (byType != null) return byType;

  /* Fall back to round-trip time when effectiveType is unavailable: roughly
     one RTT is how long we can afford to stay silent. */
  if (typeof c.rtt === 'number' && c.rtt > 0) {
    return Math.min(400, Math.max(80, Math.round(c.rtt)));
  }
  return DEFAULT_DELAY;
}

/**
 * @param {boolean} active  whether the thing we are waiting for is still pending
 * @param {{ skip?: boolean }} [opts]  skip=true never shows the indicator
 *        (used when the chunk is already in memory, so there is no real wait)
 */
export default function useLoadingGate(active = true, opts = {}) {
  const { skip = false } = opts;
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (!active || skip) return undefined;

    const id = setTimeout(() => {
      shownAt.current = Date.now();
      setVisible(true);
    }, loadingDelay());

    return () => clearTimeout(id);
  }, [active, skip]);

  /* Honour the minimum visible window on the way out. The component using this
     hook unmounts when Suspense resolves, so this mainly matters for callers
     that keep the element mounted and toggle on `active`. */
  useEffect(() => {
    if (active || !visible) return undefined;

    const held = Date.now() - shownAt.current;
    if (held >= MIN_VISIBLE) {
      setVisible(false);
      return undefined;
    }
    const id = setTimeout(() => setVisible(false), MIN_VISIBLE - held);
    return () => clearTimeout(id);
  }, [active, visible]);

  return visible ? 'visible' : 'hidden';
}
