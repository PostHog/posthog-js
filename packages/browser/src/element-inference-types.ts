/** @deprecated Product tours were removed from PostHog. */
export interface SelectorGroup {
    cardinality: number
    cssSelectors: Array<{
        css: string
        offset: number
    }>
}

/** @deprecated Product tours were removed from PostHog. */
export interface AutoData {
    notextGroups: SelectorGroup[]
    textGroups: SelectorGroup[]
}

/** @deprecated Product tours were removed from PostHog. */
export interface InferredSelector {
    autoData: string
    text: string | null
    excludeText?: boolean
    precision?: number
}
