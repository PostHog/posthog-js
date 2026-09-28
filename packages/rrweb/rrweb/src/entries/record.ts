import record from '../record';
export { getObserverInitFailures } from '../record/observer';
export {
  wasMaxDepthReached,
  resetMaxDepthState,
  getLastSnapshotCost,
  getMutationCost,
  getDeferredStylesheetStats,
  getDiscardedDurationSamples,
  resetSnapshotCostState,
  type SnapshotCost,
  type MutationCost,
  type DeferredStylesheetStats,
} from '@posthog/rrweb-snapshot';

export { record };
