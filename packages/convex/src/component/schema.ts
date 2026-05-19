import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  /**
   * Singleton table holding the latest feature flag definitions fetched from the PostHog API.
   * The cron action upserts a single row; clients read it for local evaluation.
   *
   * `data` is a JSON-stringified `FlagDefinitions` object to bypass Convex's restriction on
   * field names beginning with `$` (flag conditions reference properties like `$device_id`).
   */
  flagDefinitions: defineTable({
    data: v.string(),
    fetchedAt: v.number(),
    etag: v.optional(v.string()),
  }),
})
