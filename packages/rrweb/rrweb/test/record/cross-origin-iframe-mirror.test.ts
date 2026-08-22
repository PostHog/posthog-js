/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import CrossOriginIframeMirror from '../../src/record/cross-origin-iframe-mirror'

describe('CrossOriginIframeMirror', () => {
    it('preserves negative sentinels without allocating local IDs', () => {
        const generateId = vi.fn(() => 100)
        const mirror = new CrossOriginIframeMirror(generateId)
        const iframe = document.createElement('iframe')

        expect(mirror.getId(iframe, -1)).toBe(-1)
        expect(mirror.getRemoteId(iframe, -1)).toBe(-1)
        expect(mirror.getIds(iframe, [-1, -2])).toEqual([-1, -2])
        expect(mirror.getRemoteIds(iframe, [-1, -2])).toEqual([-1, -2])
        expect(generateId).not.toHaveBeenCalled()
    })

    it('keeps positive and zero remote IDs in a stable bidirectional map', () => {
        let nextId = 100
        const mirror = new CrossOriginIframeMirror(() => nextId++)
        const iframe = document.createElement('iframe')

        const localZero = mirror.getId(iframe, 0)
        const localPositive = mirror.getId(iframe, 42)

        expect(localZero).toBe(100)
        expect(localPositive).toBe(101)
        expect(mirror.getId(iframe, 0)).toBe(localZero)
        expect(mirror.getId(iframe, 42)).toBe(localPositive)
        expect(mirror.getRemoteId(iframe, localZero)).toBe(0)
        expect(mirror.getRemoteId(iframe, localPositive)).toBe(42)
        expect(mirror.getRemoteId(iframe, 999)).toBe(-1)
    })
})
