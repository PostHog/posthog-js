// Type definitions copied from the in-repo @posthog/rrweb-types and @posthog/rrweb-snapshot packages
// (a fork of upstream @rrweb/types and rrweb-snapshot, both MIT licensed: https://github.com/rrweb-io/rrweb)
//
// These types are inlined here to avoid requiring users to install peer dependencies
// solely for TypeScript type information.

// ===== Types from rrweb-snapshot =====
// These are needed by the rrweb types

export type DataURLOptions = Partial<{
    type: string
    quality: number
}>

export interface INode extends Node {
    __sn: serializedNodeWithId
}

export interface IMirror<TNode> {
    getId(n: TNode | undefined | null): number
    getNode(id: number): TNode | null
    getIds(): number[]
    getMeta(n: TNode): serializedNodeWithId | null
    removeNodeFromMap(n: TNode): void
    has(id: number): boolean
    hasNode(node: TNode): boolean
    add(n: TNode, meta: serializedNodeWithId): void
    replace(id: number, n: TNode): void
    reset(): void
}

export declare class Mirror implements IMirror<Node> {
    // oxlint-disable-next-line posthog-js/private-members-leading-underscore
    private idNodeMap
    // oxlint-disable-next-line posthog-js/private-members-leading-underscore
    private nodeMetaMap
    getId(n: Node | undefined | null): number
    getNode(id: number): Node | null
    getIds(): number[]
    getMeta(n: Node): serializedNodeWithId | null
    removeNodeFromMap(n: Node): void
    has(id: number): boolean
    hasNode(node: Node): boolean
    add(n: Node, meta: serializedNodeWithId): void
    replace(id: number, n: Node): void
    reset(): void
}

export type attributes = {
    [key: string]: string | number | true | null
}

export const NodeType = {
    Document: 0,
    DocumentType: 1,
    Element: 2,
    Text: 3,
    CDATA: 4,
    Comment: 5,
} as const
export type NodeType = (typeof NodeType)[keyof typeof NodeType]

export type documentNode = {
    type: typeof NodeType.Document
    childNodes: serializedNodeWithId[]
    compatMode?: string | undefined
}

export type documentTypeNode = {
    type: typeof NodeType.DocumentType
    name: string
    publicId: string
    systemId: string
}

export type elementNode = {
    type: typeof NodeType.Element
    tagName: string
    attributes: attributes
    childNodes: serializedNodeWithId[]
    isSVG?: true | undefined
    needBlock?: boolean | undefined
    isCustom?: true | undefined
}

export type textNode = {
    type: typeof NodeType.Text
    textContent: string
    isStyle?: true | undefined
}

export type cdataNode = {
    type: typeof NodeType.CDATA
    textContent: ''
}

export type commentNode = {
    type: typeof NodeType.Comment
    textContent: string
}

export type serializedNode = (documentNode | documentTypeNode | elementNode | textNode | cdataNode | commentNode) & {
    rootId?: number | undefined
    isShadowHost?: boolean | undefined
    isShadow?: boolean | undefined
}

export type serializedNodeWithId = serializedNode & {
    id: number
}

// ===== Types from rrweb-types =====

export type blockClass = string | RegExp

export type maskTextClass = string | RegExp

export type IWindow = Window & typeof globalThis

export type listenerHandler = () => void

export type KeepIframeSrcFn = (src: string) => boolean

export type PackFn = (event: eventWithTime) => string

export const EventType = {
    DomContentLoaded: 0,
    Load: 1,
    FullSnapshot: 2,
    IncrementalSnapshot: 3,
    Meta: 4,
    Custom: 5,
    Plugin: 6,
} as const
export type EventType = (typeof EventType)[keyof typeof EventType]

export const IncrementalSource = {
    Mutation: 0,
    MouseMove: 1,
    MouseInteraction: 2,
    Scroll: 3,
    ViewportResize: 4,
    Input: 5,
    TouchMove: 6,
    MediaInteraction: 7,
    StyleSheetRule: 8,
    CanvasMutation: 9,
    Font: 10,
    Log: 11,
    Drag: 12,
    StyleDeclaration: 13,
    Selection: 14,
    AdoptedStyleSheet: 15,
    CustomElement: 16,
} as const
export type IncrementalSource = (typeof IncrementalSource)[keyof typeof IncrementalSource]

export type domContentLoadedEvent = {
    type: typeof EventType.DomContentLoaded
    data: unknown
}

export type loadedEvent = {
    type: typeof EventType.Load
    data: unknown
}

export type fullSnapshotEvent = {
    type: typeof EventType.FullSnapshot
    data: {
        node: serializedNodeWithId
        initialOffset: {
            top: number
            left: number
        }
    }
}

export type metaEvent = {
    type: typeof EventType.Meta
    data: {
        href: string
        width: number
        height: number
    }
}

export type customEventData<T = unknown> = {
    tag: string
    payload: T
    href?: string | undefined
}

export type customEvent<T = unknown> = {
    type: typeof EventType.Custom
    data: customEventData<T>
}

export type pluginEvent<T = unknown> = {
    type: typeof EventType.Plugin
    data: {
        plugin: string
        payload: T
    }
}

export type styleOMValue = {
    [key: string]: styleValueWithPriority | string | false
}

export type styleValueWithPriority = [string, string]

export type textMutation = {
    id: number
    value: string | null
}

export type attributeMutation = {
    id: number
    attributes: {
        [key: string]: string | styleOMValue | null
    }
}

export type removedNodeMutation = {
    parentId: number
    id: number
    isShadow?: boolean | undefined
}

export type addedNodeMutation = {
    parentId: number
    previousId?: number | null | undefined
    nextId: number | null
    node: serializedNodeWithId
}

export type mutationCallbackParam = {
    texts: textMutation[]
    attributes: attributeMutation[]
    removes: removedNodeMutation[]
    adds: addedNodeMutation[]
    isAttachIframe?: true | undefined
}

export type mutationData = {
    source: typeof IncrementalSource.Mutation
} & mutationCallbackParam

export type mousePosition = {
    x: number
    y: number
    id: number
    timeOffset: number
}

export const MouseInteractions = {
    MouseUp: 0,
    MouseDown: 1,
    Click: 2,
    ContextMenu: 3,
    DblClick: 4,
    Focus: 5,
    Blur: 6,
    TouchStart: 7,
    TouchMove_Departed: 8,
    TouchEnd: 9,
    TouchCancel: 10,
} as const
export type MouseInteractions = (typeof MouseInteractions)[keyof typeof MouseInteractions]

export const PointerTypes = {
    Mouse: 0,
    Pen: 1,
    Touch: 2,
} as const
export type PointerTypes = (typeof PointerTypes)[keyof typeof PointerTypes]

type mouseInteractionParam = {
    type: MouseInteractions
    id: number
    x?: number | undefined
    y?: number | undefined
    pointerType?: PointerTypes | undefined
}

export type mouseInteractionData = {
    source: typeof IncrementalSource.MouseInteraction
} & mouseInteractionParam

export type mousemoveData = {
    source: typeof IncrementalSource.MouseMove | typeof IncrementalSource.TouchMove | typeof IncrementalSource.Drag
    positions: mousePosition[]
}

export type scrollPosition = {
    id: number
    x: number
    y: number
}

export type scrollData = {
    source: typeof IncrementalSource.Scroll
} & scrollPosition

export type viewportResizeDimension = {
    width: number
    height: number
}

export type viewportResizeData = {
    source: typeof IncrementalSource.ViewportResize
} & viewportResizeDimension

export type inputValue = {
    text: string
    isChecked: boolean
    userTriggered?: boolean | undefined
}

export type inputData = {
    source: typeof IncrementalSource.Input
    id: number
} & inputValue

export const MediaInteractions = {
    Play: 0,
    Pause: 1,
    Seeked: 2,
    VolumeChange: 3,
    RateChange: 4,
} as const
export type MediaInteractions = (typeof MediaInteractions)[keyof typeof MediaInteractions]

export type mediaInteractionParam = {
    type: MediaInteractions
    id: number
    currentTime?: number | undefined
    volume?: number | undefined
    muted?: boolean | undefined
    loop?: boolean | undefined
    playbackRate?: number | undefined
}

export type mediaInteractionData = {
    source: typeof IncrementalSource.MediaInteraction
} & mediaInteractionParam

export type styleSheetAddRule = {
    rule: string
    index?: number | number[] | undefined
}

export type styleSheetDeleteRule = {
    index: number | number[]
}

export type styleSheetRuleParam = {
    id?: number | undefined
    styleId?: number | undefined
    removes?: styleSheetDeleteRule[] | undefined
    adds?: styleSheetAddRule[] | undefined
    replace?: string | undefined
    replaceSync?: string | undefined
}

export type styleSheetRuleData = {
    source: typeof IncrementalSource.StyleSheetRule
} & styleSheetRuleParam

export const CanvasContext = {
    '2D': 0,
    WebGL: 1,
    WebGL2: 2,
} as const
export type CanvasContext = (typeof CanvasContext)[keyof typeof CanvasContext]

export type canvasMutationCommand = {
    property: string
    args: Array<unknown>
    setter?: true | undefined
}

export type canvasMutationParam =
    | {
          id: number
          type: CanvasContext
          commands: canvasMutationCommand[]
      }
    | ({
          id: number
          type: CanvasContext
      } & canvasMutationCommand)

export type canvasMutationData = {
    source: typeof IncrementalSource.CanvasMutation
} & canvasMutationParam

export type fontParam = {
    family: string
    fontSource: string
    buffer: boolean
    descriptors?: FontFaceDescriptors | undefined
}

export type fontData = {
    source: typeof IncrementalSource.Font
} & fontParam

export type SelectionRange = {
    start: number
    startOffset: number
    end: number
    endOffset: number
}

export type selectionParam = {
    ranges: Array<SelectionRange>
}

export type selectionData = {
    source: typeof IncrementalSource.Selection
} & selectionParam

export type styleDeclarationParam = {
    id?: number | undefined
    styleId?: number | undefined
    index: number[]
    set?: {
        property: string
        value: string | null
        priority: string | undefined
    }
    remove?: {
        property: string
    }
}

export type styleDeclarationData = {
    source: typeof IncrementalSource.StyleDeclaration
} & styleDeclarationParam

export type adoptedStyleSheetParam = {
    id: number
    styles?: {
        styleId: number
        rules: styleSheetAddRule[]
    }[]
    styleIds: number[]
}

export type adoptedStyleSheetData = {
    source: typeof IncrementalSource.AdoptedStyleSheet
} & adoptedStyleSheetParam

export type customElementParam = {
    define?: {
        name: string
    }
}

export type customElementData = {
    source: typeof IncrementalSource.CustomElement
} & customElementParam

export type incrementalData =
    | mutationData
    | mousemoveData
    | mouseInteractionData
    | scrollData
    | viewportResizeData
    | inputData
    | mediaInteractionData
    | styleSheetRuleData
    | canvasMutationData
    | fontData
    | selectionData
    | styleDeclarationData
    | adoptedStyleSheetData
    | customElementData

export type incrementalSnapshotEvent = {
    type: typeof EventType.IncrementalSnapshot
    data: incrementalData
}

export type eventWithoutTime =
    | domContentLoadedEvent
    | loadedEvent
    | fullSnapshotEvent
    | incrementalSnapshotEvent
    | metaEvent
    | customEvent
    | pluginEvent

export type eventWithTime = eventWithoutTime & {
    timestamp: number
    delay?: number | undefined
}

export type mutationCallBack = (m: mutationCallbackParam) => void

export type mousemoveCallBack = (
    p: mousePosition[],
    source: typeof IncrementalSource.MouseMove | typeof IncrementalSource.TouchMove | typeof IncrementalSource.Drag
) => void

export type mouseInteractionCallBack = (d: mouseInteractionParam) => void

export type scrollCallback = (p: scrollPosition) => void

export type viewportResizeCallback = (d: viewportResizeDimension) => void

export type inputCallback = (v: inputValue & { id: number }) => void

export type mediaInteractionCallback = (p: mediaInteractionParam) => void

export type styleSheetRuleCallback = (s: styleSheetRuleParam) => void

export type styleDeclarationCallback = (s: styleDeclarationParam) => void

export type canvasMutationCallback = (p: canvasMutationParam) => void

export type fontCallback = (p: fontParam) => void

export type selectionCallback = (p: selectionParam) => void

export type customElementCallback = (c: customElementParam) => void

export type adoptedStyleSheetCallback = (a: adoptedStyleSheetParam) => void

export type hooksParam = {
    mutation?: mutationCallBack | undefined
    mousemove?: mousemoveCallBack | undefined
    mouseInteraction?: mouseInteractionCallBack | undefined
    scroll?: scrollCallback | undefined
    viewportResize?: viewportResizeCallback | undefined
    input?: inputCallback | undefined
    mediaInteaction?: mediaInteractionCallback | undefined
    styleSheetRule?: styleSheetRuleCallback | undefined
    styleDeclaration?: styleDeclarationCallback | undefined
    canvasMutation?: canvasMutationCallback | undefined
    font?: fontCallback | undefined
    selection?: selectionCallback | undefined
    customElement?: customElementCallback | undefined
}

export type SamplingStrategy = Partial<{
    mousemove: boolean | number
    mousemoveCallback: number
    mouseInteraction: boolean | Record<string, boolean | undefined>
    scroll: number
    media: number
    input: 'all' | 'last'
    canvas: 'all' | number
}>

export interface ICrossOriginIframeMirror {
    getId(
        iframe: HTMLIFrameElement,
        remoteId: number,
        parentToRemoteMap?: Map<number, number> | undefined,
        remoteToParentMap?: Map<number, number> | undefined
    ): number
    getIds(iframe: HTMLIFrameElement, remoteId: number[]): number[]
    getRemoteId(iframe: HTMLIFrameElement, parentId: number, map?: Map<number, number>): number
    getRemoteIds(iframe: HTMLIFrameElement, parentId: number[]): number[]
    reset(iframe?: HTMLIFrameElement): void
}

export type RecordPlugin<TOptions = unknown> = {
    name: string
    observer?: (cb: (...args: Array<unknown>) => void, win: IWindow, options: TOptions) => listenerHandler
    eventProcessor?: <TExtend>(event: eventWithTime) => eventWithTime & TExtend
    getMirror?: (mirrors: {
        nodeMirror: Mirror
        crossOriginIframeMirror: ICrossOriginIframeMirror
        crossOriginIframeStyleMirror: ICrossOriginIframeMirror
    }) => void
    options: TOptions
}

// Keep these diagnostic data types in sync with packages/rrweb/rrweb-snapshot/src/snapshot-cost.ts.
export type SnapshotCost = {
    /** wall-clock ms of the whole tracked window (the full snapshot task) */
    durationMs: number
    /** of `durationMs`, ms spent stringifying stylesheets */
    stylesheetMs: number
    /** DOM nodes visited by the serializer */
    nodeCount: number
    /** CSSRules read while stringifying stylesheets, all sources */
    cssRuleCount: number
    /**
     * of `cssRuleCount`, rules from sources that can never be deferred
     * (CSSOM-only `<style>` elements, adoptedStyleSheets). These do not charge
     * the inlining budget: deferring other sheets buys them no freeze reduction.
     */
    nonDeferrableCssRuleCount: number
    /** `<link rel=stylesheet>` elements whose inlining was deferred past the budget */
    deferredStylesheetCount: number
}

export type MutationCost = {
    /** slowest single mutation batch, in ms, since the last reset */
    slowestBatchMs: number
}

/**
 * Session-cumulative accounting of budget-deferred stylesheets. `failedCount`
 * and `abandonedCount` are sheets that never made it back into the recording:
 * both leave the `<link>` serialized with only `rel`/`href`, so replay falls
 * back to loading the CSS from its original URL - which may 404 or have
 * changed by then.
 */
export type DeferredStylesheetStats = {
    /** deferral events across every snapshot (a re-deferred sheet counts again) */
    deferredCount: number
    /** deferred sheets whose idle-time stringification produced nothing */
    failedCount: number
    /** deferred sheets dropped when a teardown flush hit its safety cap */
    abandonedCount: number
    /** ms spent stringifying deferred sheets, across every slice */
    totalMs: number
    /** slowest single slice of deferred stringification, in ms */
    slowestSliceMs: number
}
