import type {
  Mirror,
  MaskInputOptions,
  SlimDOMOptions,
  MaskInputFn,
  MaskTextFn,
  MaskAttributeFn,
} from '@posthog/rrweb-snapshot';
import type { IframeManager } from './record/iframe-manager';
import type { ShadowDomManager } from './record/shadow-dom-manager';
import type { Replayer } from './replay';
import type { RRNode } from '@posthog/rrdom';
import type { CanvasManager } from './record/observers/canvas/canvas-manager';
import type { StylesheetManager } from './record/stylesheet-manager';
import type {
  CanvasMasking,
  DataURLOptions,
  addedNodeMutation,
  blockClass,
  canvasMutationCallback,
  customElementCallback,
  eventWithTime,
  fontCallback,
  hooksParam,
  inputCallback,
  IWindow,
  KeepIframeSrcFn,
  listenerHandler,
  maskTextClass,
  mediaInteractionCallback,
  mouseInteractionCallBack,
  mousemoveCallBack,
  mutationCallBack,
  RecordPlugin,
  SamplingStrategy,
  scrollCallback,
  selectionCallback,
  styleDeclarationCallback,
  styleSheetRuleCallback,
  viewportResizeCallback,
  PackFn,
  UnpackFn,
} from '@posthog/rrweb-types';
import type ProcessedNodeManager from './record/processed-node-manager';

export type recordOptions<T> = {
  emit?: (e: T, isCheckout?: boolean) => void;
  checkoutEveryNth?: number;
  checkoutEveryNms?: number;
  /**
   * Milliseconds of continuous main-thread work while serializing a full
   * snapshot before yielding to the event loop; large documents can
   * otherwise block the page for seconds in a single long task.
   *
   * The budget is cooperative, not a hard bound: the clock is only consulted
   * between nodes, so a single expensive node (a large stylesheet, a canvas
   * capture, a same-origin iframe document) can overshoot it within one
   * slice. Events observed while the sliced snapshot is in flight are held
   * and delivered after it, so their consumer-visible delivery is delayed by
   * up to the walk's duration. If the snapshot cannot complete within its
   * safety limits, the recorder retries once and then falls back to a
   * synchronous snapshot, reporting each degradation as a custom event
   * (tag: 'budgeted-full-snapshot').
   *
   * 0 (default) keeps the whole snapshot synchronous, exactly as before.
   * Non-finite or non-positive values are treated as 0.
   */
  fullSnapshotYieldBudgetMs?: number;
  blockClass?: blockClass;
  blockSelector?: string;
  ignoreClass?: string;
  ignoreSelector?: string;
  maskTextClass?: maskTextClass;
  maskTextSelector?: string;
  maskAllInputs?: boolean;
  maskInputOptions?: MaskInputOptions;
  maskInputFn?: MaskInputFn;
  maskTextFn?: MaskTextFn;
  maskAllElementAttributes?: boolean;
  maskAttributeFn?: MaskAttributeFn;
  slimDOMOptions?: SlimDOMOptions | 'all' | true;
  ignoreCSSAttributes?: Set<string>;
  /**
   * Limit which DOM attributes the MutationObserver watches, by passing the
   * list through to the native `MutationObserver.observe` `attributeFilter`.
   * When set, mutations to unlisted attributes never fire the observer
   * callback at all, so they cost no recording CPU - useful to exclude
   * high-frequency inline `style` mutations from JS-driven animations.
   *
   * Filtered attributes are invisible to replay, so only set this when that
   * loss of fidelity is acceptable. When omitted (or set to an empty array)
   * all attributes are observed, the default behaviour.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/observe#attributefilter
   */
  attributeFilter?: string[];
  inlineStylesheet?: boolean;
  /**
   * Caps how many CSSRules a single full snapshot may stringify.
   * `stringifyStylesheet` walks every CSSRule of every sheet, which on CSS-heavy
   * pages is the dominant cost of the (uninterruptible) snapshot task and can
   * freeze the UI for seconds.
   *
   * Once the cap is hit, remaining `<link rel=stylesheet>` elements are serialized
   * without `_cssText` - they keep `rel`/`href`, so replay loads them remotely -
   * and are then inlined one-per-idle-callback afterwards, arriving as attribute
   * mutations. Fidelity is preserved; the work just stops being one long blocking
   * task.
   *
   * Set to 0 to disable the cap and restore the previous unbounded behaviour.
   */
  inlineStylesheetBudgetRules?: number;
  hooks?: hooksParam;
  packFn?: PackFn;
  sampling?: SamplingStrategy;
  dataURLOptions?: DataURLOptions;
  // (0,1] fraction of canvas display size to capture FPS-snapshot frames at; replay upscales
  // back to display size, so playback dimensions are unchanged, just softer. defaults to 1.
  canvasResolutionScale?: number;
  canvasMasking?: CanvasMasking;
  recordDOM?: boolean;
  recordCanvas?: boolean;
  recordCrossOriginIframes?: boolean;
  recordAfter?: 'DOMContentLoaded' | 'load';
  userTriggeredOnInput?: boolean;
  collectFonts?: boolean;
  inlineImages?: boolean;
  plugins?: RecordPlugin[];
  // departed, please use sampling options
  mousemoveWait?: number;
  keepIframeSrcFn?: KeepIframeSrcFn;
  errorHandler?: ErrorHandler;
};

export type observerParam = {
  mutationCb: mutationCallBack;
  mousemoveCb: mousemoveCallBack;
  mouseInteractionCb: mouseInteractionCallBack;
  scrollCb: scrollCallback;
  viewportResizeCb: viewportResizeCallback;
  inputCb: inputCallback;
  mediaInteractionCb: mediaInteractionCallback;
  selectionCb: selectionCallback;
  blockClass: blockClass;
  blockSelector: string | null;
  ignoreClass: string;
  ignoreSelector: string | null;
  maskTextClass: maskTextClass;
  maskTextSelector: string | null;
  maskInputOptions: MaskInputOptions;
  maskInputFn?: MaskInputFn;
  maskTextFn?: MaskTextFn;
  maskAllElementAttributes: boolean;
  maskAttributeFn?: MaskAttributeFn;
  keepIframeSrcFn: KeepIframeSrcFn;
  inlineStylesheet: boolean;
  styleSheetRuleCb: styleSheetRuleCallback;
  styleDeclarationCb: styleDeclarationCallback;
  canvasMutationCb: canvasMutationCallback;
  customElementCb: customElementCallback;
  fontCb: fontCallback;
  sampling: SamplingStrategy;
  recordDOM: boolean;
  recordCanvas: boolean;
  canvasMaskingConfigured: (() => boolean) | undefined;
  inlineImages: boolean;
  userTriggeredOnInput: boolean;
  collectFonts: boolean;
  slimDOMOptions: SlimDOMOptions;
  dataURLOptions: DataURLOptions;
  doc: Document;
  mirror: Mirror;
  iframeManager: IframeManager;
  stylesheetManager: StylesheetManager;
  shadowDomManager: ShadowDomManager;
  canvasManager: CanvasManager;
  processedNodeManager: ProcessedNodeManager;
  ignoreCSSAttributes: Set<string>;
  attributeFilter?: string[];
  // See rrweb-snapshot's serializeTextNode: reports whether a <style>'s
  // serialization carries the live CSSOM or the raw author text — which is
  // what decides whether a held CSSOM delta is already inside the snapshot.
  onStylesheetTextSerialized?: (textNode: Text, inlined: boolean) => void;
  plugins: Array<{
    observer: (
      cb: (...arg: Array<unknown>) => void,
      win: IWindow,
      options: unknown,
    ) => listenerHandler;
    callback: (...arg: Array<unknown>) => void;
    options: unknown;
  }>;
};

export type MutationBufferParam = Pick<
  observerParam,
  | 'mutationCb'
  | 'blockClass'
  | 'blockSelector'
  | 'maskTextClass'
  | 'maskTextSelector'
  | 'inlineStylesheet'
  | 'maskInputOptions'
  | 'maskTextFn'
  | 'maskInputFn'
  | 'maskAllElementAttributes'
  | 'maskAttributeFn'
  | 'keepIframeSrcFn'
  | 'recordCanvas'
  | 'canvasMaskingConfigured'
  | 'inlineImages'
  | 'slimDOMOptions'
  | 'dataURLOptions'
  | 'doc'
  | 'mirror'
  | 'iframeManager'
  | 'stylesheetManager'
  | 'shadowDomManager'
  | 'canvasManager'
  | 'processedNodeManager'
  | 'attributeFilter'
  | 'onStylesheetTextSerialized'
>;

export type ReplayPlugin = {
  handler?: (
    event: eventWithTime,
    isSync: boolean,
    context: { replayer: Replayer },
  ) => void;
  onBuild?: (
    node: Node | RRNode,
    context: { id: number; replayer: Replayer },
  ) => void;
  getMirror?: (mirrors: { nodeMirror: Mirror }) => void;
};
export type { Replayer } from './replay';
export type playerConfig = {
  speed: number;
  maxSpeed: number;
  root: Element;
  loadTimeout: number;
  skipInactive: boolean;
  inactivePeriodThreshold: number;
  showWarning: boolean;
  showDebug: boolean;
  blockClass: string;
  liveMode: boolean;
  insertStyleRules: string[];
  triggerFocus: boolean;
  UNSAFE_replayCanvas: boolean;
  pauseAnimation?: boolean;
  mouseTail:
    | boolean
    | {
        duration?: number;
        lineCap?: string;
        lineWidth?: number;
        strokeStyle?: string;
      };
  unpackFn?: UnpackFn;
  useVirtualDom: boolean;
  /**
   * Maximum milliseconds of continuous main-thread work while fast-forwarding
   * to a seek target before yielding to the event loop; long, event-dense
   * recordings can otherwise block the page for many seconds on a seek.
   * 0 (default) keeps the whole rebuild synchronous, so the target frame is
   * fully rendered when pause(t)/play(t) return.
   *
   * While a chunked rebuild is still applying, getCurrentTime() already
   * reports the seek target, but the rendered frame lags until the rebuild's
   * Flush — don't read the iframe DOM right after a seek with a budget set.
   */
  seekYieldBudgetMs?: number;
  logger: {
    log: (...args: Parameters<typeof console.log>) => void;
    warn: (...args: Parameters<typeof console.warn>) => void;
  };
  plugins?: ReplayPlugin[];
};

export type missingNode = {
  node: Node | RRNode;
  mutation: addedNodeMutation;
};
export type missingNodeMap = {
  [id: number]: missingNode;
};

declare global {
  interface Window {
    FontFace: typeof FontFace;
    Array: typeof Array;
  }
}

export type CrossOriginIframeMessageEventContent<T = eventWithTime> = {
  type: 'rrweb';
  event: T;
  // The origin of the iframe which originally emits this message. It is used to check the integrity of message and to filter out the rrweb messages which are forwarded by some sites.
  origin: string;
  isCheckout?: boolean;
};
export type CrossOriginIframeMessageEvent =
  MessageEvent<CrossOriginIframeMessageEventContent>;

export type ErrorHandlerContext = 'rrweb' | 'host';

export type ErrorHandler = (
  error: unknown,
  context?: ErrorHandlerContext,
) => void | boolean;
