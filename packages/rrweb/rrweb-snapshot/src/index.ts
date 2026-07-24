import snapshot, {
  snapshotWithBudget,
  type SnapshotWithBudgetOptions,
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
  genId,
} from './snapshot';
import rebuild, {
  buildNodeWithSN,
  adaptCssForReplay,
  createCache,
} from './rebuild';
export * from './types';
export * from './utils';

export {
  snapshot,
  snapshotWithBudget,
  type SnapshotWithBudgetOptions,
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
  genId,
};
