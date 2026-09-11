import type { CompatibleToolsListLike } from '../types'
import { getAnalyticsParameterOwnership } from './analytics-parameters'

/** Cold low-level servers have no registry; inspect the raw catalog without emitting discovery events. */
export async function findToolOwnership(
  toolName: string,
  listPage: (cursor?: string) => Promise<unknown>,
  onError?: () => void
): Promise<ReturnType<typeof getAnalyticsParameterOwnership> | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let expired = false
  const lookup = async () => {
    const seen = new Set<string>()
    let cursor: string | undefined
    for (let page = 0; page < 16; page++) {
      const result = (await listPage(cursor)) as CompatibleToolsListLike | undefined
      if (expired) return undefined
      if (!Array.isArray(result?.tools)) return undefined
      const tool = result.tools.find((candidate) => candidate?.name === toolName)
      if (tool) return getAnalyticsParameterOwnership(tool.inputSchema, tool.outputSchema)
      cursor = result.nextCursor
      if (!isNextPage(cursor, seen)) return undefined
      seen.add(cursor)
    }
    return undefined
  }
  try {
    return await Promise.race([
      lookup(),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          expired = true
          resolve(undefined)
        }, 250)
      }),
    ])
  } catch {
    onError?.()
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

function isNextPage(cursor: unknown, seen: Set<string>): cursor is string {
  return typeof cursor === 'string' && cursor.length > 0 && !seen.has(cursor)
}
