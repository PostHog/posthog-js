export type IdleTask = { cancel: () => void };
export type IdleDeadline = { didTimeout: boolean; timeRemaining: () => number };

export function whenIdle(cb: (deadline?: IdleDeadline) => void): IdleTask {
  const win = window as Window &
    typeof globalThis & {
      requestIdleCallback?: (
        cb: (deadline: IdleDeadline) => void,
        opts?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
  if (typeof win.requestIdleCallback === 'function') {
    // the timeout keeps a permanently busy main thread from starving the CSS
    const handle = win.requestIdleCallback(cb, { timeout: 2000 });
    return { cancel: () => win.cancelIdleCallback?.(handle) };
  }
  // no idle scheduling (e.g. Safari <= 17): space the chunks out instead, so
  // they don't run back-to-back inside the page-load busy window
  const handle = setTimeout(cb, 250);
  return { cancel: () => clearTimeout(handle) };
}

// CSSRules stringified per slice before re-checking the idle deadline. A rule
// stringifies in single-digit microseconds, so a slice stays around a
// millisecond even on slow devices - small enough that overshooting a deadline
// by one slice is negligible, big enough that a permanently busy page still
// finishes real work with its one guaranteed slice per callback.
export const DEFERRED_STYLESHEET_RULES_PER_SLICE = 200;

// Without idle deadlines (the setTimeout fallback in whenIdle) each tick gets a
// fixed slice allowance instead: a tick stays a few ms, while a giant sheet
// still completes in seconds rather than minutes.
export const DEFERRED_STYLESHEET_SLICES_PER_FALLBACK_TICK = 10;
