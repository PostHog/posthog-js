// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

import type {
  CompatibleRequestHandlerExtra,
  MCPAnalyticsData,
  MCPRequestLike,
  MCPServerLike,
  SessionInfo,
  UserIdentity,
} from '../types'

/**
 * Bounded LRU cache, capped at `maxSize` entries so a long-lived server cannot
 * accumulate state for unboundedly many sessions. One instance lives on each
 * server's tracking data and is never shared across server instances.
 */
export class BoundedCache<T> {
  private readonly _cache = new Map<string, T>()
  private readonly _maxSize: number

  constructor(maxSize = 1000) {
    this._maxSize = maxSize
  }

  get(key: string): T | undefined {
    const value = this._cache.get(key)
    if (value === undefined) {
      return
    }
    // Touch: re-insert so it counts as most-recently-used.
    this._cache.delete(key)
    this._cache.set(key, value)
    return value
  }

  set(key: string, value: T): void {
    this._cache.delete(key)

    if (this._cache.size >= this._maxSize) {
      const oldestKey = this._cache.keys().next().value
      if (oldestKey !== undefined) {
        this._cache.delete(oldestKey)
      }
    }

    this._cache.set(key, value)
  }

  has(key: string): boolean {
    return this._cache.has(key)
  }

  size(): number {
    return this._cache.size
  }
}

export class IdentityCache extends BoundedCache<UserIdentity> {}

const _serverTracking = new WeakMap<MCPServerLike, MCPAnalyticsData>()

export function getServerTrackingData(server: MCPServerLike): MCPAnalyticsData | undefined {
  return _serverTracking.get(server)
}

export function setServerTrackingData(server: MCPServerLike, data: MCPAnalyticsData): void {
  _serverTracking.set(server, data)
}

export function mergeIdentities(previous: UserIdentity | undefined, next: UserIdentity): UserIdentity {
  if (!previous) {
    return next
  }

  return {
    distinctId: next.distinctId,
    properties: {
      ...(previous.properties || {}),
      ...(next.properties || {}),
    },
    groups: next.groups ?? previous.groups,
  }
}

/**
 * Resolves the optional `identify` callback on every request and caches the
 * merged identity per session. The caller stamps it onto each event as
 * `distinct_id`/`$set`, so no standalone `$identify` event is needed: without
 * an `$anon_distinct_id` it would not merge any person in ingestion.
 */
export async function handleIdentify(
  data: MCPAnalyticsData,
  sessionId: string,
  request: MCPRequestLike,
  extra?: CompatibleRequestHandlerExtra
): Promise<UserIdentity | undefined> {
  const identityBeforeRequest = data.identifiedSessions.get(sessionId)
  if (!data.options.identify) {
    return identityBeforeRequest
  }

  try {
    const identityResult =
      typeof data.options.identify === 'function' ? await data.options.identify(request, extra) : data.options.identify

    if (identityResult) {
      const mergedIdentity = mergeIdentities(data.identifiedSessions.get(sessionId), identityResult)
      data.identifiedSessions.set(sessionId, mergedIdentity)
      return mergedIdentity
    }

    data.logger(`Warning: Supplied identify function returned null for session ${sessionId}`)
  } catch (error) {
    data.logger(
      `Error: User supplied identify function threw an error while identifying session ${sessionId} - ${error}`
    )
  }
  return identityBeforeRequest
}

export function withIdentity(sessionInfo: SessionInfo, identity: UserIdentity | undefined): SessionInfo {
  return {
    ...sessionInfo,
    identifyActorGivenId: identity?.distinctId,
    identifyActorData: identity?.properties || {},
    identifyActorGroups: identity?.groups,
  }
}

/**
 * Resolves the `eventProperties` callback. Returns null when no callback is
 * configured, or when it returns nullish or throws — a throw never propagates
 * into the tool path.
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
    data.logger(`eventProperties callback error: ${e}`)
    return null
  }
}
