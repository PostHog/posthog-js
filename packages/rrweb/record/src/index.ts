import { record } from '@posthog/rrweb';
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
} from '@posthog/rrweb';

export { record };
