export interface JSONContent {
    type?: string
    attrs?: Record<string, any>
    content?: JSONContent[]
    marks?: { type: string; attrs?: Record<string, any> }[]
    text?: string
}

export interface ProductTourStep {
    id: string
    selector: string
    content: JSONContent | null
}

export interface ProductTourConditions {
    url?: string
    urlMatchType?: 'exact' | 'contains' | 'regex'
    selector?: string
}

export interface ProductTourAppearance {
    backgroundColor?: string
    textColor?: string
    buttonColor?: string
    buttonTextColor?: string
    borderRadius?: number
    borderColor?: string
    whiteLabel?: boolean
}

export interface ProductTour {
    id: string
    name: string
    description?: string
    type: 'product_tour'
    start_date: string | null
    end_date: string | null
    current_iteration?: number
    conditions?: ProductTourConditions
    appearance?: ProductTourAppearance
    steps: ProductTourStep[]
    internal_targeting_flag_key?: string
    linked_flag_key?: string
    trigger_selector?: string
}

export type ProductTourCallback = (tours: ProductTour[], context?: { isLoaded: boolean; error?: string }) => void

export type ProductTourSelectorError = 'not_found' | 'multiple_matches' | 'not_visible'

export type ProductTourDismissReason =
    | 'user_clicked_skip'
    | 'user_clicked_outside'
    | 'escape_key'
    | 'element_unavailable'

export type ProductTourRenderReason = 'auto' | 'api' | 'trigger'

export const DEFAULT_PRODUCT_TOUR_APPEARANCE: Required<ProductTourAppearance> = {
    backgroundColor: '#ffffff',
    textColor: '#1d1f27',
    buttonColor: '#1d1f27',
    buttonTextColor: '#ffffff',
    borderRadius: 8,
    borderColor: '#e5e7eb',
    whiteLabel: false,
}
