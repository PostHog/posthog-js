import { PropertyMatchType } from './types'

export interface JSONContent {
    type?: string
    attrs?: Record<string, any>
    content?: JSONContent[]
    marks?: { type: string; attrs?: Record<string, any> }[]
    text?: string
}

export type ProductTourSurveyQuestionType = 'open' | 'rating'

export interface ProductTourSurveyQuestion {
    type: ProductTourSurveyQuestionType
    questionText: string
    /** Rating display type - emoji or number */
    display?: 'emoji' | 'number'
    /** Rating scale - 3 or 5 for emoji, 5 or 10 for number */
    scale?: 3 | 5 | 10
    /** Label for low end of rating scale (e.g., "Not likely") */
    lowerBoundLabel?: string
    /** Label for high end of rating scale (e.g., "Very likely") */
    upperBoundLabel?: string
}

export interface ProductTourStep {
    id: string
    selector?: string
    content: JSONContent | null
    /** Inline survey question config - if present, this is a survey step */
    survey?: ProductTourSurveyQuestion
    /** ID of the auto-created survey for this step (set by backend) */
    linkedSurveyId?: string
    /** ID of the survey question (set by backend, used for event tracking) */
    linkedSurveyQuestionId?: string
}

export interface ProductTourConditions {
    url?: string
    urlMatchType?: PropertyMatchType
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
    auto_launch?: boolean
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
