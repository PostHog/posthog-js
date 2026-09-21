// This file replicates some of the types hidden inside `@posthog/rrweb-record`
// (the in-repo rrweb fork) so users can validate types without depending on it directly.
//
// NOTE: Keep this file in sync with `@posthog/rrweb-record` if we ever update it.
// NOTE²: The initial types are not exported, we're only exporting the two types at the bottom.
//        They're only here to allow the bottom types to be more easily defined.

import type {
    blockClass,
    eventWithTime,
    hooksParam,
    KeepIframeSrcFn,
    maskTextClass,
    PackFn,
    RecordPlugin,
    SamplingStrategy,
} from './rrweb-types'

// Replication of `MaskInputOptions` from inside `@posthog/rrweb-record`/`@posthog/rrweb-snapshot`
type MaskInputOptions = Partial<{
    color: boolean
    date: boolean
    'datetime-local': boolean
    email: boolean
    month: boolean
    number: boolean
    range: boolean
    search: boolean
    tel: boolean
    text: boolean
    time: boolean
    url: boolean
    week: boolean
    textarea: boolean
    select: boolean
    password: boolean
}>

// Replication of `MaskInputFn` from inside `@posthog/rrweb-record`/`@posthog/rrweb-snapshot`
type MaskInputFn = (text: string, element: HTMLElement) => string

// Replication of `MaskTextFn` from inside `@posthog/rrweb-record`/`@posthog/rrweb-snapshot`
type MaskTextFn = (text: string, element: HTMLElement | null) => string

// Replication of `MaskAttributeFn` from inside `@posthog/rrweb-record`/`@posthog/rrweb-snapshot`
type MaskAttributeFn = (name: string, value: string, element: Element) => string

// Replication of `CanvasMasking` from inside `@posthog/rrweb-types`
type CanvasMasking = {
    regionsFn?: (
        canvas: HTMLCanvasElement
    ) => Array<{ x: number; y: number; width: number; height: number }> | null | undefined
    configured?: () => boolean
}

// Replication of `SlimDOMOptions` from inside `@posthog/rrweb-record`/`@posthog/rrweb-snapshot`
type SlimDOMOptions = Partial<{
    script: boolean
    comment: boolean
    headFavicon: boolean
    headWhitespace: boolean
    headMetaDescKeywords: boolean
    headMetaSocial: boolean
    headMetaRobots: boolean
    headMetaHttpEquiv: boolean
    headMetaAuthorship: boolean
    headMetaVerification: boolean
    headTitleMutations: boolean
}>

// Replication of `DataURLOptions` from inside `@posthog/rrweb-record`/`@posthog/rrweb-snapshot`
type DataURLOptions = Partial<{
    type: string
    quality: number
}>

// Replication of `ErrorHandler` from inside `@posthog/rrweb-record`
type ErrorHandler = (error: unknown, context?: 'rrweb' | 'host') => void | boolean

// Replication of `recordOptions` from inside `@posthog/rrweb-record`
export type recordOptions = {
    emit?: (e: eventWithTime, isCheckout?: boolean) => void
    checkoutEveryNth?: number | undefined
    checkoutEveryNms?: number | undefined
    blockClass?: blockClass | undefined
    blockSelector?: string | undefined
    ignoreClass?: string | undefined
    ignoreSelector?: string | undefined
    maskTextClass?: maskTextClass | undefined
    maskTextSelector?: string | undefined
    maskAllInputs?: boolean | undefined
    maskInputOptions?: MaskInputOptions | undefined
    maskInputFn?: MaskInputFn | undefined
    maskTextFn?: MaskTextFn | undefined
    maskAllElementAttributes?: boolean | undefined
    maskAttributeFn?: MaskAttributeFn | undefined
    slimDOMOptions?: SlimDOMOptions | 'all' | true | undefined
    ignoreCSSAttributes?: Set<string> | undefined
    attributeFilter?: string[] | undefined
    inlineStylesheet?: boolean | undefined
    inlineStylesheetBudgetRules?: number | undefined
    hooks?: hooksParam | undefined
    packFn?: PackFn | undefined
    sampling?: SamplingStrategy | undefined
    dataURLOptions?: DataURLOptions | undefined
    canvasResolutionScale?: number | undefined
    canvasMasking?: CanvasMasking | undefined
    recordDOM?: boolean | undefined
    recordCanvas?: boolean | undefined
    recordCrossOriginIframes?: boolean | undefined
    recordAfter?: 'DOMContentLoaded' | 'load' | undefined
    userTriggeredOnInput?: boolean | undefined
    collectFonts?: boolean | undefined
    inlineImages?: boolean | undefined
    plugins?: RecordPlugin[] | undefined
    mousemoveWait?: number | undefined
    keepIframeSrcFn?: KeepIframeSrcFn | undefined
    errorHandler?: ErrorHandler | undefined
}

// Replication of `record` from inside `@posthog/rrweb-record`
export type rrwebRecord = {
    (options: recordOptions): (() => void) | undefined
    addCustomEvent: (tag: string, payload: any) => void
    takeFullSnapshot: () => void
    mirror: {
        getId(n: Node | undefined | null): number
        getNode(id: number): Node | null
    }
}
