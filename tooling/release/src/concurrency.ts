// Bound open requests and buffered assets. Drain started work before failing so a
// caller never begins a new phase while writes from the previous one are still active.
export async function mapConcurrent<T, R>(
    items: readonly T[],
    run: (item: T) => Promise<R>,
    concurrency = 8
): Promise<R[]> {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
        throw new Error('Concurrency must be a positive integer')
    }
    const results: R[] = new Array(items.length)
    let next = 0
    let failed = false
    let failure: unknown
    await Promise.all(
        Array.from({ length: Math.min(concurrency, items.length) }, async () => {
            while (!failed && next < items.length) {
                const index = next++
                try {
                    results[index] = await run(items[index])
                } catch (error) {
                    if (!failed) failure = error
                    failed = true
                }
            }
        })
    )
    if (failed) throw failure
    return results
}
