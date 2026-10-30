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
  resetStylesheetLoadTracking,
  onceLinkStylesheetUpToDate,
  isStylesheetLink,
  genId,
} from './snapshot';
import rebuild, {
  buildNodeWithSN,
  adaptCssForReplay,
  createCache,
} from './rebuild';
export * from './types';
export * from './utils';
export * from './snapshot-cost';

export {
  snapshot,
  serializeNodeWithId,
  rebuild,
  buildNodeWithSN,
  adaptCssForReplay,
  createCache,
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
  resetStylesheetLoadTracking,
  onceLinkStylesheetUpToDate,
  isStylesheetLink,
  genId,
};
