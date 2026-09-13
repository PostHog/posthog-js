/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import type { IWindow } from '@posthog/rrweb-types';
import { getRecordConsolePlugin } from '../src';

// The wrapper installed over each console method is an arrow function, so it
// cannot see the call-site receiver and has to name one explicitly. Native
// console implementations are free to reject a foreign receiver, so the only
// safe choice is the logger the method was taken from.
function record(cb: () => void) {
  const receivers: unknown[] = [];
  const logger = {
    log(this: unknown, ..._args: unknown[]) {
      receivers.push(this);
    },
  };

  const plugin = getRecordConsolePlugin({ level: ['log'], logger });
  const stop = plugin.observer!(
    cb,
    window as unknown as IWindow,
    plugin.options,
  );

  logger.log('hello');
  stop();

  return { receivers, logger };
}

describe('rrweb-plugin-console-record logger binding', () => {
  it('passes the logger through as the receiver', () => {
    const { receivers, logger } = record(() => undefined);

    expect(receivers).toEqual([logger]);
  });

  it('also passes the logger when reporting its own failure', () => {
    const { receivers, logger } = record(() => {
      throw new Error('log callback blew up');
    });

    // the pass-through call, then the 'rrweb logger error:' report
    expect(receivers).toEqual([logger, logger]);
  });
});
