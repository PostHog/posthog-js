export function createPostHogSpanContext(): never {
    throw new Error('PostHog span context requires the Next.js Node.js server runtime.')
}
