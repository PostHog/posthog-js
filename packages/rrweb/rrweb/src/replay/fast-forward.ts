import type { eventWithTime } from '@posthog/rrweb-types';

export type ApplyEventsWithYieldOptions = {
  events: eventWithTime[];
  castEvent: (event: eventWithTime) => void;
  /** Max ms of continuous work before yielding; 0 never yields. */
  yieldBudgetMs: number;
  /** Runs a continuation asynchronously after a yield (e.g. setTimeout 0). */
  schedule: (continueApplying: () => void) => void;
  /** A cancelled application stops silently and never calls onComplete. */
  isCancelled: () => boolean;
  /** Called exactly once after the last event, unless cancelled; receives true when no yield was needed. */
  onComplete: (completedSynchronously: boolean) => void;
  now?: () => number;
};

/**
 * Applies events in order, yielding to the event loop whenever the time
 * budget is exhausted, so that long seek fast-forwards don't block the main
 * thread until the browser offers to kill the page. At least one event is
 * applied per chunk so progress is always made.
 */
export function applyEventsWithYield(
  options: ApplyEventsWithYieldOptions,
): void {
  const {
    events,
    castEvent,
    yieldBudgetMs,
    schedule,
    isCancelled,
    onComplete,
  } = options;
  const now = options.now ?? (() => performance.now());

  let index = 0;
  // true once every event has been applied
  const applyChunk = (): boolean => {
    const deadline = yieldBudgetMs > 0 ? now() + yieldBudgetMs : Infinity;
    while (index < events.length) {
      castEvent(events[index]);
      index++;
      // a cast runs plugins and event-cast listeners, which can
      // synchronously start a newer seek or go live — stop mid-chunk
      // rather than keep casting a superseded pass
      if (isCancelled()) {
        return false;
      }
      if (now() >= deadline) {
        break;
      }
    }
    return index >= events.length;
  };

  const step = (isFirstChunk: boolean) => {
    if (!isFirstChunk && isCancelled()) {
      return;
    }
    const done = applyChunk();
    // re-check: the final cast of a chunk can be what cancelled it, and a
    // superseded pass must never complete or reschedule
    if (isCancelled()) {
      return;
    }
    if (done) {
      onComplete(isFirstChunk);
      return;
    }
    schedule(() => step(false));
  };
  step(true);
}
