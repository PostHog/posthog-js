import record from './record';
import {
  Replayer,
  type playerConfig,
  type PlayerMachineState,
  type SpeedMachineState,
} from './replay';
import canvasMutation from './replay/canvas';
import { _mirror } from './utils';
import * as utils from './utils';

export {
  EventType,
  IncrementalSource,
  MouseInteractions,
  ReplayerEvents,
  type eventWithTime,
} from '@posthog/rrweb-types';

export { getObserverInitFailures } from './record/observer';

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

// exports style.css from replay
import './replay/styles/style.css';

export type { recordOptions, ReplayPlugin } from './types';

const addCustomEvent: typeof record.addCustomEvent = record.addCustomEvent;
const freezePage: typeof record.freezePage = record.freezePage;
const takeFullSnapshot: typeof record.takeFullSnapshot = record.takeFullSnapshot;

export {
  record,
  addCustomEvent,
  freezePage,
  takeFullSnapshot,
  Replayer,
  type playerConfig,
  type PlayerMachineState,
  type SpeedMachineState,
  canvasMutation,
  _mirror as mirror,
  utils,
};
