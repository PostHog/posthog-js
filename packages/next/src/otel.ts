import type { IPostHog } from 'posthog-node'
import { PostHogContextSpanProcessor, enrichCurrentSpan } from 'posthog-node/otel'
import type { CreatePostHogConfig } from './server/createPostHog.js'
import { getConfiguredPostHogClient, resolvePostHogRequest } from './server/getPostHog.js'

export interface PostHogSpanContext {
    /** Add this processor to the application's existing Node.js tracer provider before it handles requests. */
    createContextSpanProcessor(): Promise<PostHogContextSpanProcessor>
    /**
     * Scope Node.js App Router work. Context ends when the callback settles, including on error.
     * Earlier server spans are enriched only through parent links observed by the processor;
     * a sampler-dropped intermediate span breaks that chain. New recording child spans still receive context.
     */
    withPostHogContext<T>(work: (posthog: IPostHog) => T | Promise<T>): Promise<T>
}

/** Reuse the same configuration as createPostHog; this entry point requires the Node.js runtime and OpenTelemetry. */
export function createPostHogSpanContext(config: CreatePostHogConfig = {}): PostHogSpanContext {
    let pendingProcessor: Promise<PostHogContextSpanProcessor> | undefined

    return {
        createContextSpanProcessor() {
            pendingProcessor ??= getConfiguredPostHogClient(config.apiKey, config.options).then(
                ({ client }) => new PostHogContextSpanProcessor(client)
            )
            return pendingProcessor
        },
        async withPostHogContext(work) {
            const { client, contextData } = await resolvePostHogRequest(
                config.apiKey,
                config.options,
                config.getDistinctId
            )
            return client.withContext(
                contextData ?? {},
                async () => {
                    if (contextData) {
                        enrichCurrentSpan(client)
                    }
                    return await work(client)
                },
                { fresh: true }
            )
        },
    }
}
