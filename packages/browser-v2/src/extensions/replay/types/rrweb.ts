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
type ErrorHandler = (error: unknown) => void | boolean

// Replication of `recordOptions` from inside `@posthog/rrweb-record`
export type recordOptions = {
    emit?: (e: eventWithTime, isCheckout?: boolean) => void
    checkoutEveryNth?: number
    checkoutEveryNms?: number
    blockClass?: blockClass
    blockSelector?: string
    ignoreClass?: string
    ignoreSelector?: string
    maskTextClass?: maskTextClass
    maskTextSelector?: string
    maskAllInputs?: boolean
    maskInputOptions?: MaskInputOptions
    maskInputFn?: MaskInputFn
    maskTextFn?: MaskTextFn
    slimDOMOptions?: SlimDOMOptions | 'all' | true
    ignoreCSSAttributes?: Set<string>
    inlineStylesheet?: boolean
    hooks?: hooksParam
    packFn?: PackFn
    sampling?: SamplingStrategy
    dataURLOptions?: DataURLOptions
    recordDOM?: boolean
    recordCanvas?: boolean
    recordCrossOriginIframes?: boolean
    recordAfter?: 'DOMContentLoaded' | 'load'
    userTriggeredOnInput?: boolean
    collectFonts?: boolean
    inlineImages?: boolean
    plugins?: RecordPlugin[]
    mousemoveWait?: number
    keepIframeSrcFn?: KeepIframeSrcFn
    errorHandler?: ErrorHandler
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
