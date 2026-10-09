import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import { mapConcurrent } from './concurrency.ts'

test('bounds concurrency and preserves input ordering', async () => {
    let active = 0
    let peak = 0
    const items = Array.from({ length: 40 }, (_, i) => i)
    const results = await mapConcurrent(items, async (i) => {
        active++
        peak = Math.max(peak, active)
        await setImmediate()
        active--
        return i * 2
    })
    assert.equal(peak, 8)
    assert.deepEqual(
        results,
        items.map((i) => i * 2)
    )
})

test('stops scheduling on failure and drains every started operation before rejecting', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
        release = resolve
    })
    const started: number[] = []
    const failure = new Error('upload failed')
    let settled = false
    const done = mapConcurrent(
        [0, 1, 2, 3],
        async (i) => {
            started.push(i)
            if (i === 0) throw failure
            await gate
        },
        2
    ).catch((error) => {
        settled = true
        assert.equal(error, failure)
    })
    await setImmediate()
    assert.equal(settled, false)
    assert.deepEqual(started, [0, 1])
    release()
    await done
    assert.equal(settled, true)
    assert.deepEqual(started, [0, 1])
})

test('handles empty inputs and rejects invalid concurrency', async () => {
    assert.deepEqual(await mapConcurrent([], async () => undefined), [])
    for (const limit of [0, -1, 1.5, Infinity]) {
        await assert.rejects(
            mapConcurrent([1], async () => undefined, limit),
            /positive integer/
        )
    }
})
