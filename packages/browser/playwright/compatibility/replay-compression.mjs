// Runs in the page before the SDK loads. Native gzip consumes its stream through
// Response.blob(), then reads the Blob for validation and serialization.
export function trackReplayCompression() {
    let pending = 0
    for (const [prototype, method] of [
        [Response.prototype, 'blob'],
        [Blob.prototype, 'arrayBuffer'],
    ]) {
        const original = prototype[method]
        prototype[method] = function (...args) {
            const result = original.apply(this, args)
            pending++
            return result.finally(() => pending--)
        }
    }
    window.__compatPendingBlobReads = () => pending
}

export async function settleReplayCompression(page, expect) {
    // Evaluate in a new browser task: promise continuations can start another
    // native read after the preceding read settles. Do not advance fake timers
    // while those continuations are still filling the recorder's buffer.
    await expect.poll(() => page.evaluate(() => window.__compatPendingBlobReads())).toBe(0)
}
