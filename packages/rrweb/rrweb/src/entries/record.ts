import record from '../record';
export {
  wasMaxDepthReached,
  resetMaxDepthState,
  getLastSnapshotCost,
  getMutationCost,
  getDeferredStylesheetStats,
  resetSnapshotCostState,
  type SnapshotCost,
  type MutationCost,
  type DeferredStylesheetStats,
} from '@posthog/rrweb-snapshot';

export { record };
