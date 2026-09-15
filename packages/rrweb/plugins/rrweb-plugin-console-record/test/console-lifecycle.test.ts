/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import type { IWindow } from '@posthog/rrweb-types'
import { getRecordConsolePlugin } from '../src'

describe('console observer lifecycle', () => {
    it.each([false, true])('stays inactive beneath a foreign wrapper after restart (original marker: %s)', (marked) => {
        const receivers: unknown[] = []
        const original = vi.fn(function (this: unknown, ..._args: unknown[]) {
            receivers.push(this)
        })
        const logger = { log: original }
        const capture = vi.fn()
        const vendor = vi.fn()
        const plugin = getRecordConsolePlugin({ level: ['log'], logger })
        const start = () => plugin.observer!(capture, window as unknown as IWindow, plugin.options)
        const stop = start()
        const previous = logger.log
        // Unlike rrweb's mutable layers, foreign wrappers retain their predecessor.
        const foreign = function (this: unknown, ...args: unknown[]) {
            vendor(...args)
            return previous.apply(this, args)
        }
        if (marked) {
            Object.defineProperty(foreign, '__rrweb_original__', { value: previous })
        }
        logger.log = foreign as typeof logger.log
        let stopRestarted: (() => void) | undefined
        try {
            logger.log('active')
            expect(capture).toHaveBeenCalledTimes(1)
            stop()
            logger.log('stopped')
            expect.soft(capture).toHaveBeenCalledTimes(1)
            stopRestarted = start()
            logger.log('restarted')
            expect.soft(capture).toHaveBeenCalledTimes(2)
            stopRestarted()
            logger.log('stopped again')
            expect.soft(capture).toHaveBeenCalledTimes(2)
            expect(vendor.mock.calls).toEqual([['active'], ['stopped'], ['restarted'], ['stopped again']])
            expect(original.mock.calls).toEqual(vendor.mock.calls)
            expect(receivers).toEqual([logger, logger, logger, logger])
        } finally {
            stop()
            stopRestarted?.()
        }
    })
})
