import type { EventMessage } from '../../types'
import type { ContextData } from './types'

const capturedContext = Symbol('capturedContext')
type ContextEvent = EventMessage & { [capturedContext]?: ContextData | null }

export function snapshotEventContext(context: ContextData | undefined): (event: EventMessage) => EventMessage {
  const snapshot = context ? { ...context, properties: { ...context.properties } } : null
  return (event) => Object.assign(event, { [capturedContext]: snapshot })
}

export function getEventContext(event: EventMessage, fallback: ContextData | undefined): ContextData | undefined {
  return capturedContext in event ? ((event as ContextEvent)[capturedContext] ?? undefined) : fallback
}
