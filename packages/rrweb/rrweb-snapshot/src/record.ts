import snapshot, {
    serializeNodeWithId,
    transformAttribute,
    ignoreAttribute,
    visitSnapshot,
    cleanupSnapshot,
    needMaskingText,
    classMatchesRegex,
    IGNORED_NODE,
    genId,
    DEFAULT_MAX_DEPTH,
    wasMaxDepthReached,
} from './snapshot'
export * from './types'
export * from './utils'

export {
    snapshot,
    serializeNodeWithId,
    transformAttribute,
    ignoreAttribute,
    visitSnapshot,
    cleanupSnapshot,
    needMaskingText,
    classMatchesRegex,
    IGNORED_NODE,
    genId,
    DEFAULT_MAX_DEPTH,
    wasMaxDepthReached,
}
