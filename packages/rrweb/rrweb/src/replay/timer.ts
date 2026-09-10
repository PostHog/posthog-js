import {
  type actionWithDelay,
  type eventWithTime,
  EventType,
  IncrementalSource,
} from '@posthog/rrweb-types';

export class Timer {
  public timeOffset = 0;
  public speed: number;

  private actions: actionWithDelay[];
  private raf: number | true | null = null;
  private lastTimestamp: number;
  private onActionError?: (error: unknown) => void;

  constructor(
    actions: actionWithDelay[] = [],
    config: {
      speed: number;
      onActionError?: (error: unknown) => void;
    },
  ) {
    this.actions = actions;
    this.speed = config.speed;
    this.onActionError = config.onActionError;
  }
  /**
   * Add an action, possibly after the timer starts.
   */
  public addAction(action: actionWithDelay): void {
    const rafWasActive = this.raf === true;
    if (
      !this.actions.length ||
      this.actions[this.actions.length - 1].delay <= action.delay
    ) {
      // 'fast track'
      this.actions.push(action);
    } else {
      // binary search - events can arrive out of order in a realtime context
      const index = this.findActionIndex(action);
      this.actions.splice(index, 0, action);
    }
    if (rafWasActive) {
      this.raf = requestAnimationFrame(this.rafCheck.bind(this));
    }
  }

  public start(): void {
    this.timeOffset = 0;
    this.lastTimestamp = performance.now();
    this.raf = requestAnimationFrame(this.rafCheck.bind(this));
  }

  private rafCheck() {
    const time = performance.now();
    this.timeOffset += (time - this.lastTimestamp) * this.speed;
    this.lastTimestamp = time;
    while (this.actions.length) {
      const action = this.actions[0];

      if (this.timeOffset >= action.delay) {
        this.actions.shift();
        try {
          action.doAction();
        } catch (error) {
          // an uncaught throw from the frame callback leaves the rest of the
          // queue unrun: one bad action must not end playback
          this.onActionError?.(error);
        }
      } else {
        break;
      }
    }
    if (this.actions.length > 0) {
      this.raf = requestAnimationFrame(this.rafCheck.bind(this));
    } else {
      this.raf = true; // was active
    }
  }

  public clear(): void {
    if (this.raf) {
      if (this.raf !== true) {
        cancelAnimationFrame(this.raf);
      }
      this.raf = null;
    }
    this.actions.length = 0;
  }

  public setSpeed(speed: number): void {
    this.speed = speed;
  }

  public isActive(): boolean {
    return this.raf !== null;
  }

  private findActionIndex(action: actionWithDelay): number {
    let start = 0;
    let end = this.actions.length - 1;
    while (start <= end) {
      const mid = Math.floor((start + end) / 2);
      if (this.actions[mid].delay < action.delay) {
        start = mid + 1;
      } else if (this.actions[mid].delay > action.delay) {
        end = mid - 1;
      } else {
        // already an action with same delay (timestamp)
        // the plus one will splice the new one after the existing one
        return mid + 1;
      }
    }
    return start;
  }
}

/**
 * A position arrives with the recording and does not always match its type.
 * Without a numeric `timeOffset` the derived delay is `NaN`, which `rafCheck`
 * can never satisfy: playback stops at that action and the frame loop keeps
 * rescheduling with no work to do. Returns undefined when the offset cannot be
 * trusted, so callers can fall back to the event's own timestamp.
 */
export function positionTimeOffset(position: unknown): number | undefined {
  const timeOffset: unknown = (position as { timeOffset?: unknown } | null)
    ?.timeOffset;
  return typeof timeOffset === 'number' && !Number.isNaN(timeOffset)
    ? timeOffset
    : undefined;
}

export function firstPositionTimeOffset(data: {
  positions?: unknown;
}): number | undefined {
  const positions: unknown = data.positions;
  if (!Array.isArray(positions) || !positions.length) {
    return undefined;
  }
  return positionTimeOffset(positions[0]);
}

// TODO: add speed to mouse move timestamp calculation
export function addDelay(event: eventWithTime, baselineTime: number): number {
  // Mouse move events was recorded in a throttle function,
  // so we need to find the real timestamp by traverse the time offsets.
  if (
    event.type === EventType.IncrementalSnapshot &&
    event.data.source === IncrementalSource.MouseMove
  ) {
    const firstOffset = firstPositionTimeOffset(event.data);
    if (firstOffset !== undefined) {
      // timeOffset is a negative offset to event.timestamp
      const firstTimestamp = event.timestamp + firstOffset;
      event.delay = firstTimestamp - baselineTime;
      return firstTimestamp - baselineTime;
    }
  }

  event.delay = event.timestamp - baselineTime;
  return event.delay;
}
