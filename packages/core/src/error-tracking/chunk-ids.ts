// Portions of this file are derived from getsentry/sentry-javascript
// Copyright (c) 2012 Functional Software, Inc. dba Sentry
// Licensed under the MIT License: https://github.com/getsentry/sentry-javascript/blob/develop/LICENSE

import type { StackParser } from './types'

type StackString = string
type CachedResult = string

type ChunkIdMapType = Record<string, string>

let parsedStackResults: Record<StackString, CachedResult> | undefined
let lastPostHogChunkIds: ChunkIdMapType | undefined
let lastNativeDebugIds: ChunkIdMapType | undefined
let cachedFilenameChunkIds: ChunkIdMapType | undefined

export function getFilenameToChunkIdMap(stackParser: StackParser): ChunkIdMapType | undefined {
  const posthogChunkIds = (globalThis as any)._posthogChunkIds as ChunkIdMapType | undefined
  const nativeDebugIds = (globalThis as any)._debugIds as ChunkIdMapType | undefined
  if (!posthogChunkIds && !nativeDebugIds) {
    return undefined
  }

  const posthogKeys = posthogChunkIds ? Object.keys(posthogChunkIds) : []
  const nativeKeys = nativeDebugIds ? Object.keys(nativeDebugIds) : []

  if (
    cachedFilenameChunkIds &&
    matchesSnapshot(posthogChunkIds, posthogKeys, lastPostHogChunkIds) &&
    matchesSnapshot(nativeDebugIds, nativeKeys, lastNativeDebugIds)
  ) {
    return cachedFilenameChunkIds
  }

  lastPostHogChunkIds = posthogChunkIds ? { ...posthogChunkIds } : undefined
  lastNativeDebugIds = nativeDebugIds ? { ...nativeDebugIds } : undefined
  cachedFilenameChunkIds = {}
  parsedStackResults ??= {}

  const addChunkIds = (keys: string[], chunkIds: ChunkIdMapType): void => {
    for (const stackKey of keys) {
      const chunkId = chunkIds[stackKey]
      if (!chunkId) {
        continue
      }

      const cachedFilename = parsedStackResults?.[stackKey]
      if (cachedFilename) {
        cachedFilenameChunkIds![cachedFilename] = chunkId
        continue
      }

      const parsedStack = stackParser(stackKey)
      for (let i = parsedStack.length - 1; i >= 0; i--) {
        const filename = parsedStack[i]?.filename
        if (filename) {
          cachedFilenameChunkIds![filename] = chunkId
          parsedStackResults![stackKey] = filename
          break
        }
      }
    }
  }

  if (nativeDebugIds) {
    addChunkIds(nativeKeys, nativeDebugIds)
  }
  if (posthogChunkIds) {
    addChunkIds(posthogKeys, posthogChunkIds)
  }

  return cachedFilenameChunkIds
}

function matchesSnapshot(
  chunkIds: ChunkIdMapType | undefined,
  keys: string[],
  snapshot: ChunkIdMapType | undefined
): boolean {
  if (!chunkIds || !snapshot) {
    return chunkIds === snapshot
  }
  return keys.length === Object.keys(snapshot).length && keys.every((key) => chunkIds[key] === snapshot[key])
}
