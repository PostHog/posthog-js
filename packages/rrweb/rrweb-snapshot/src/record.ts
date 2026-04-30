import snapshot, {
  serializeNodeWithId,
  transformAttribute,
  ignoreAttribute,
  visitSnapshot,
  cleanupSnapshot,
  needMaskingText,
  classMatchesRegex,
  slimDOMDefaults,
  IGNORED_NODE,
  DEFAULT_MAX_DEPTH,
  wasMaxDepthReached,
  resetMaxDepthState,
  genId,
} from './snapshot';
export * from './types';
export * from './utils';

export {
  snapshot,
  serializeNodeWithId,
  transformAttribute,
  ignoreAttribute,
  visitSnapshot,
  cleanupSnapshot,
  needMaskingText,
  classMatchesRegex,
  slimDOMDefaults,
  IGNORED_NODE,
  DEFAULT_MAX_DEPTH,
  wasMaxDepthReached,
  resetMaxDepthState,
  genId,
};
