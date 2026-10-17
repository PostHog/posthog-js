import { context, trace, SpanKind, type Context, type Span } from '@opentelemetry/api'
import type { IPostHog, PostHog } from 'posthog-node'
import { PostHogContextSpanProcessor, enrichCurrentSpan } from 'posthog-node/otel'
import type { CreatePostHogConfig } from './server/createPostHog.js'
import { getConfiguredPostHogClient, resolvePostHogRequest, withRequestContext } from './server/getPostHog.js'

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

class NextPostHogContextSpanProcessor extends PostHogContextSpanProcessor {
    private readonly _parents = new WeakMap<Span, Span>()

    constructor(private readonly _client: PostHog) {
        super(_client)
    }

    override onStart(span: Span, parentContext?: Context): void {
        const parent = parentContext && trace.getSpan(parentContext)
        if (parent && parent !== span) {
            this._parents.set(span, parent)
        }
        super.onStart(span)
    }

    enrichNearestServerSpan(): void {
        let span = trace.getActiveSpan()
        while (span) {
            if ('kind' in span && span.kind === SpanKind.SERVER && span.isRecording()) {
                context.with(trace.setSpan(context.active(), span), () => enrichCurrentSpan(this._client))
                return
            }
            span = this._parents.get(span)
        }
    }
}

/** Reuse the same configuration as createPostHog; this entry point requires the Node.js runtime and OpenTelemetry. */
export function createPostHogSpanContext(config: CreatePostHogConfig = {}): PostHogSpanContext {
    let processor: NextPostHogContextSpanProcessor | undefined
    let pendingProcessor: Promise<NextPostHogContextSpanProcessor> | undefined

    return {
        createContextSpanProcessor() {
            pendingProcessor ??= getConfiguredPostHogClient(config.apiKey, config.options).then(({ client }) => {
                processor = new NextPostHogContextSpanProcessor(client)
                return processor
            })
            return pendingProcessor
        },
        async withPostHogContext(work) {
            const { client, contextData } = await resolvePostHogRequest(
                config.apiKey,
                config.options,
                config.getDistinctId
            )
            const controller = new AbortController()
            return client.withContext(
                contextData ?? {},
                async () => {
                    try {
                        if (contextData) {
                            enrichCurrentSpan(client)
                            processor?.enrichNearestServerSpan()
                        }
                        return await work(
                            contextData
                                ? withRequestContext(client, contextData, { signal: controller.signal })
                                : client
                        )
                    } finally {
                        controller.abort()
                    }
                },
                { fresh: true, signal: controller.signal }
            )
        },
    }
}
