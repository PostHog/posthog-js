import { trace, SpanKind, type Attributes, type Context, type Span } from '@opentelemetry/api'
import type { PostHogBackendClient } from '../client'
import { addContextListener } from '../extensions/context/listeners'

export { enrichCurrentSpan } from '../extensions/context/listeners'

type ReadableSpan = Span & { readonly attributes: Attributes }

function hasReadableAttributes(span: Span | undefined): span is ReadableSpan {
  return !!span && 'attributes' in span && typeof span.attributes === 'object' && span.attributes !== null
}

export class PostHogContextSpanProcessor {
  private active = true
  private readonly snapshots = new WeakSet<Span>()
  private readonly parents = new WeakMap<Span, WeakRef<Span>>()
  private readonly unsubscribe: () => void

  constructor(private readonly posthog: PostHogBackendClient) {
    this.unsubscribe = addContextListener(posthog, (requestEntry) => {
      const span = trace.getActiveSpan()
      this.enrich(span, requestEntry)
      if (requestEntry) this.enrichNearestServerSpan(span)
    })
  }

  private enrich(span: Span | undefined, requestEntry = false): void {
    if (!this.active) return
    try {
      if (this.posthog.isDisabled || this.posthog.optedOut) return
      if (!hasReadableAttributes(span) || !span.isRecording() || (this.snapshots.has(span) && !requestEntry)) return
      const context = this.posthog.getContext()
      if (!context) return
      this.snapshots.add(span)
      if (context.sessionId && span.attributes.sessionId === undefined) {
        span.setAttribute('sessionId', context.sessionId)
      }
      if (context.distinctId && span.attributes.posthogDistinctId === undefined) {
        span.setAttribute('posthogDistinctId', context.distinctId)
      }
    } catch {}
  }

  private enrichNearestServerSpan(current: Span | undefined): void {
    let span = current
    while (span) {
      if ('kind' in span && span.kind === SpanKind.SERVER && span.isRecording()) {
        if (span !== current) this.enrich(span, true)
        return
      }
      span = this.parents.get(span)?.deref()
    }
  }

  onStart(span: Span, parentContext?: Context): void {
    if (!this.active) return
    const parent = parentContext && trace.getSpan(parentContext)
    if (parent && parent !== span) this.parents.set(span, new WeakRef(parent))
    this.enrich(span)
  }

  onEnd(): void {}

  forceFlush(): Promise<void> {
    return Promise.resolve()
  }

  shutdown(): Promise<void> {
    if (this.active) {
      this.active = false
      this.unsubscribe()
    }
    return Promise.resolve()
  }
}
