/** Serialized event bytes a lane aims to fit in one request. */
export const CAPTURE_BATCH_TARGET_BYTES = 5 * 1024 * 1024

/** Capture's request body limit: a larger analytics event can never be accepted. */
export const ANALYTICS_MAX_EVENT_BYTES = 10 * 1024 * 1024

/** The AI endpoint rejects an event whose serialized `properties` are larger than this. */
export const AI_MAX_PROPERTIES_BYTES = 8 * 1024 * 1024
