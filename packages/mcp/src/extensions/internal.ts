import type {
  CompatibleRequestHandlerExtra,
  MCPAnalyticsData,
  MCPRequestLike,
  MCPServerLike,
  UnredactedEvent,
  UserIdentity,
} from '../types'
import { MCPAnalyticsEventType } from './event-types'
import { log } from './logger'
import { captureEvent } from './capture'

/**
 * Simple LRU cache for session identities.
 * Prevents memory leaks by capping at maxSize entries.
 * This cache persists across server instance restarts.
 */
class IdentityCache {
  private readonly _cache: Map<string, { identity: UserIdentity; timestamp: number }>
  private readonly _maxSize: number

  constructor(maxSize = 1000) {
    this._cache = new Map()
    this._maxSize = maxSize
  }

  get(sessionId: string): UserIdentity | undefined {
    const entry = this._cache.get(sessionId)
    if (entry) {
      entry.timestamp = Date.now()
      this._cache.delete(sessionId)
      this._cache.set(sessionId, entry)
      return entry.identity
    }
    return
  }

  set(sessionId: string, identity: UserIdentity): void {
    this._cache.delete(sessionId)

    if (this._cache.size >= this._maxSize) {
      const oldestKey = this._cache.keys().next().value
      if (oldestKey !== undefined) {
        this._cache.delete(oldestKey)
      }
    }

    this._cache.set(sessionId, { identity, timestamp: Date.now() })
  }

  has(sessionId: string): boolean {
    return this._cache.has(sessionId)
  }

  size(): number {
    return this._cache.size
  }
}

// Global identity cache shared across all server instances so dedupe survives
// server-instance recreation.
const _globalIdentityCache = new IdentityCache(1000)

// Internal tracking storage
const _serverTracking = new WeakMap<MCPServerLike, MCPAnalyticsData>()

export function getServerTrackingData(server: MCPServerLike): MCPAnalyticsData | undefined {
  return _serverTracking.get(server)
}

export function setServerTrackingData(server: MCPServerLike, data: MCPAnalyticsData): void {
  _serverTracking.set(server, data)
}

export function areIdentitiesEqual(a: UserIdentity, b: UserIdentity): boolean {
  if (a.userId !== b.userId) {
    return false
  }
  if (a.userName !== b.userName) {
    return false
  }

  const aData = a.userData || {}
  const bData = b.userData || {}

  const aKeys = Object.keys(aData)
  const bKeys = Object.keys(bData)

  if (aKeys.length !== bKeys.length) {
    return false
  }

  for (const key of aKeys) {
    if (!(key in bData)) {
      return false
    }
    if (JSON.stringify(aData[key]) !== JSON.stringify(bData[key])) {
      return false
    }
  }

  return true
}

export function mergeIdentities(previous: UserIdentity | undefined, next: UserIdentity): UserIdentity {
  if (!previous) {
    return next
  }

  return {
    userId: next.userId,
    userName: next.userName,
    userData: {
      ...(previous.userData || {}),
      ...(next.userData || {}),
    },
  }
}

/**
 * Resolves the optional `identify` callback, dedupes against the global identity cache,
 * and publishes an `$identify` event only when the identity has materially changed.
 */
export async function handleIdentify(
  server: MCPServerLike,
  data: MCPAnalyticsData,
  sessionId: string,
  request: MCPRequestLike,
  extra?: CompatibleRequestHandlerExtra
): Promise<void> {
  if (!data.options.identify) {
    return
  }

  const identifyEvent: UnredactedEvent = {
    sessionId,
    resourceName: getRequestResourceName(request),
    eventType: MCPAnalyticsEventType.identify,
    parameters: { request, extra },
    timestamp: new Date(),
    redactionFn: data.options.redactSensitiveInformation,
  }

  try {
    const identityResult =
      typeof data.options.identify === 'function' ? await data.options.identify(request, extra) : data.options.identify

    if (identityResult) {
      const previousIdentity = _globalIdentityCache.get(sessionId)
      const mergedIdentity = mergeIdentities(previousIdentity, identityResult)
      const hasChanged = !(previousIdentity && areIdentitiesEqual(previousIdentity, mergedIdentity))

      _globalIdentityCache.set(sessionId, mergedIdentity)
      data.identifiedSessions.set(sessionId, mergedIdentity)

      if (hasChanged) {
        log(`Identified session ${sessionId} with identity: ${JSON.stringify(mergedIdentity)}`)
        captureEvent(server, identifyEvent)
      }
    } else {
      log(`Warning: Supplied identify function returned null for session ${sessionId}`)
    }
  } catch (error) {
    log(`Error: User supplied identify function threw an error while identifying session ${sessionId} - ${error}`)
  }
}

/**
 * Resolves the eventProperties callback and returns the result.
 * Returns null if no callback is configured, the callback returns nullish, or the callback throws.
 */
export async function resolveEventProperties(
  data: MCPAnalyticsData,
  request: MCPRequestLike,
  extra?: CompatibleRequestHandlerExtra
): Promise<Record<string, unknown> | null> {
  if (!data.options.eventProperties) {
    return null
  }
  try {
    return (await data.options.eventProperties(request, extra)) ?? null
  } catch (e) {
    log(`eventProperties callback error: ${e}`)
    return null
  }
}

function getRequestResourceName(request: unknown): string {
  if (!request || typeof request !== 'object' || !('params' in request)) {
    return 'Unknown'
  }

  const params = request.params
  if (!params || typeof params !== 'object' || !('name' in params)) {
    return 'Unknown'
  }

  return typeof params.name === 'string' ? params.name : 'Unknown'
}
