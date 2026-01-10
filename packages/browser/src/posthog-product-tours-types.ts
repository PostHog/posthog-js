import { PropertyMatchType } from './types'
import { SurveyActionType, SurveyEventWithFilters } from './posthog-surveys-types'
import type { InferredSelector } from './extensions/product-tours/element-inference'
import { SurveyPosition } from '@posthog/core'

export interface JSONContent {
    type?: string
    attrs?: Record<string, any>
    content?: JSONContent[]
    marks?: { type: string; attrs?: Record<string, any> }[]
    text?: string
}

export type ProductTourStepType = 'element' | 'modal' | 'survey' | 'banner'

export interface ProductTourBannerConfig {
    behavior: 'sticky' | 'static'
    action?: {
        type: 'none' | 'link' | 'trigger_tour'
        link?: string
        tourId?: string
    }
}

/** Button actions available on modal steps */
export type ProductTourButtonAction = 'dismiss' | 'link' | 'next_step' | 'previous_step' | 'trigger_tour'

export interface ProductTourStepButton {
    text: string
    action: ProductTourButtonAction
    /** URL to open when action is 'link' */
    link?: string
    /** Tour ID to trigger when action is 'trigger_tour' */
    tourId?: string
}

export interface ProductTourStepButtons {
    primary?: ProductTourStepButton
    secondary?: ProductTourStepButton
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
    type: ProductTourStepType
    selector?: string
    progressionTrigger: 'button' | 'click'
    content: JSONContent | null
    /** Pre-rendered HTML content from the editor. If present, SDK should use this instead of rendering from JSONContent. */
    contentHtml?: string
    /** Inline survey question config - if present, this is a survey step */
    survey?: ProductTourSurveyQuestion
    /** ID of the auto-created survey for this step (set by backend) */
    linkedSurveyId?: string
    /** ID of the survey question (set by backend, used for event tracking) */
    linkedSurveyQuestionId?: string
    /** Enhanced element data for more reliable lookup at runtime */
    inferenceData?: InferredSelector
    /** Maximum tooltip width in pixels (defaults to 320px) */
    maxWidth?: number
    /** Position for modal/survey steps (defaults to middle_center) */
    modalPosition?: SurveyPosition
    /** Button configuration for modal steps */
    buttons?: ProductTourStepButtons
    /** Banner configuration (only for banner steps) */
    bannerConfig?: ProductTourBannerConfig
}

export interface ProductTourConditions {
    url?: string
    urlMatchType?: PropertyMatchType
    selector?: string
    autoShowDelaySeconds?: number
    events?: {
        values: SurveyEventWithFilters[]
    } | null
    cancelEvents?: {
        values: SurveyEventWithFilters[]
    } | null
    actions?: {
        values: SurveyActionType[]
    } | null
}

export interface ProductTourAppearance {
    backgroundColor?: string
    textColor?: string
    buttonColor?: string
    borderRadius?: number
    buttonBorderRadius?: number
    borderColor?: string
    fontFamily?: string
    boxShadow?: string
    showOverlay?: boolean
    whiteLabel?: boolean
    /** defaults to true, auto-set to false for announcements/banners */
    dismissOnClickOutside?: boolean
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
}

export type ProductTourCallback = (tours: ProductTour[], context?: { isLoaded: boolean; error?: string }) => void

export type ProductTourSelectorError = 'not_found' | 'multiple_matches' | 'not_visible'

export type ProductTourDismissReason =
    | 'user_clicked_skip'
    | 'user_clicked_outside'
    | 'escape_key'
    | 'element_unavailable'

export type ProductTourRenderReason = 'auto' | 'api' | 'trigger' | 'event'

export const DEFAULT_PRODUCT_TOUR_APPEARANCE: Required<ProductTourAppearance> = {
    backgroundColor: '#ffffff',
    textColor: '#1d1f27',
    buttonColor: '#1d1f27',
    borderRadius: 8,
    buttonBorderRadius: 6,
    borderColor: '#e5e7eb',
    fontFamily: 'system-ui',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    showOverlay: true,
    whiteLabel: false,
    dismissOnClickOutside: true,
}

export interface ShowTourOptions {
    reason?: ProductTourRenderReason
    enableStrictValidation?: boolean
}
