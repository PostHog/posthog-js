import { h } from 'preact'
import { useState, useRef, useEffect } from 'preact/hooks'
import {
    ProductTour,
    ProductTourStep,
    ProductTourDismissReason,
    ProductTourSurveyQuestion,
} from '../../../posthog-product-tours-types'
import { mergeAppearance } from '../product-tours-utils'
import { cancelSVG, IconPosthogLogo } from '../../surveys/icons'
import {
    dissatisfiedEmoji,
    neutralEmoji,
    satisfiedEmoji,
    veryDissatisfiedEmoji,
    verySatisfiedEmoji,
} from '../../surveys/icons'

export interface ProductTourSurveyStepProps {
    tour: ProductTour
    step: ProductTourStep
    stepIndex: number
    totalSteps: number
    onSubmit: (response: string | number | null) => void
    onPrevious: () => void
    onDismiss: (reason: ProductTourDismissReason) => void
}

const threeScaleEmojis = [dissatisfiedEmoji, neutralEmoji, satisfiedEmoji]
const fiveScaleEmojis = [veryDissatisfiedEmoji, dissatisfiedEmoji, neutralEmoji, satisfiedEmoji, verySatisfiedEmoji]

function getScaleNumbers(scale: number): number[] {
    switch (scale) {
        case 5:
            return [1, 2, 3, 4, 5]
        case 10:
            return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
        default:
            return [1, 2, 3, 4, 5]
    }
}

function OpenTextInput({
    value,
    onChange,
    onSubmit,
}: {
    value: string
    onChange: (text: string) => void
    onSubmit: () => void
}): h.JSX.Element {
    const inputRef = useRef<HTMLTextAreaElement>(null)

    useEffect(() => {
        setTimeout(() => inputRef.current?.focus(), 100)
    }, [])

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Enter' && e.metaKey) {
            e.preventDefault()
            onSubmit()
        }
    }

    return (
        <textarea
            ref={inputRef}
            class="ph-tour-survey-textarea"
            rows={3}
            placeholder="Your feedback (optional)..."
            value={value}
            onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
            onKeyDown={handleKeyDown}
        />
    )
}

function RatingInput({
    survey,
    onSubmit,
}: {
    survey: ProductTourSurveyQuestion
    onSubmit: (rating: number) => void
}): h.JSX.Element {
    const [selectedRating, setSelectedRating] = useState<number | null>(null)
    const display = survey.display || 'emoji'
    const scale = survey.scale || 5

    const handleSelect = (rating: number) => {
        setSelectedRating(rating)
        // Auto-submit on selection for ratings
        onSubmit(rating)
    }

    if (display === 'emoji') {
        const emojis = scale === 3 ? threeScaleEmojis : fiveScaleEmojis
        return (
            <div class="ph-tour-survey-rating-container">
                <div class="ph-tour-survey-rating-emoji">
                    {emojis.map((emoji, idx) => {
                        const rating = idx + 1
                        const isActive = selectedRating === rating
                        return (
                            <button
                                key={idx}
                                type="button"
                                class={`ph-tour-survey-emoji-button ${isActive ? 'ph-tour-survey-emoji-button--active' : ''}`}
                                onClick={() => handleSelect(rating)}
                                aria-label={`Rate ${rating}`}
                            >
                                {emoji}
                            </button>
                        )
                    })}
                </div>
                {(survey.lowerBoundLabel || survey.upperBoundLabel) && (
                    <div class="ph-tour-survey-rating-labels">
                        <span>{survey.lowerBoundLabel}</span>
                        <span>{survey.upperBoundLabel}</span>
                    </div>
                )}
            </div>
        )
    }

    // Number display
    const numbers = getScaleNumbers(scale)
    return (
        <div class="ph-tour-survey-rating-container">
            <div
                class="ph-tour-survey-rating-numbers"
                style={{ gridTemplateColumns: `repeat(${numbers.length}, minmax(0, 1fr))` }}
            >
                {numbers.map((num) => {
                    const isActive = selectedRating === num
                    return (
                        <button
                            key={num}
                            type="button"
                            class={`ph-tour-survey-number-button ${isActive ? 'ph-tour-survey-number-button--active' : ''}`}
                            onClick={() => handleSelect(num)}
                            aria-label={`Rate ${num}`}
                        >
                            {num}
                        </button>
                    )
                })}
            </div>
            {(survey.lowerBoundLabel || survey.upperBoundLabel) && (
                <div class="ph-tour-survey-rating-labels">
                    <span>{survey.lowerBoundLabel}</span>
                    <span>{survey.upperBoundLabel}</span>
                </div>
            )}
        </div>
    )
}

export function ProductTourSurveyStep({
    tour,
    step,
    stepIndex,
    totalSteps,
    onSubmit,
    onPrevious,
    onDismiss,
}: ProductTourSurveyStepProps): h.JSX.Element {
    const [textValue, setTextValue] = useState('')
    const appearance = mergeAppearance(tour.appearance)
    const survey = step.survey
    const isFirstStep = stepIndex === 0
    const isOpenText = survey?.type === 'open'

    const handleTextSubmit = () => {
        onSubmit(textValue.trim() || null)
    }

    if (!survey) {
        return <div />
    }

    const handleOverlayClick = (e: MouseEvent) => {
        e.stopPropagation()
        onDismiss('user_clicked_outside')
    }

    const handleCardClick = (e: MouseEvent) => {
        e.stopPropagation()
    }

    const containerStyle = {
        '--ph-tour-background-color': appearance.backgroundColor,
        '--ph-tour-text-color': appearance.textColor,
        '--ph-tour-button-color': appearance.buttonColor,
        '--ph-tour-button-text-color': appearance.buttonTextColor,
        '--ph-tour-border-radius': `${appearance.borderRadius}px`,
        '--ph-tour-border-color': appearance.borderColor,
    } as h.JSX.CSSProperties

    return (
        <div class="ph-tour-container" style={containerStyle}>
            <div class="ph-tour-click-overlay" onClick={handleOverlayClick} />
            <div class="ph-tour-modal-overlay" />

            <div class="ph-tour-tooltip ph-tour-tooltip--modal ph-tour-survey-step" onClick={handleCardClick}>
                <button
                    class="ph-tour-dismiss"
                    onClick={() => onDismiss('user_clicked_skip')}
                    aria-label="Close survey"
                >
                    {cancelSVG}
                </button>

                <div class="ph-tour-survey-question">{survey.questionText}</div>

                {isOpenText ? (
                    <OpenTextInput value={textValue} onChange={setTextValue} onSubmit={handleTextSubmit} />
                ) : (
                    <RatingInput survey={survey} onSubmit={onSubmit} />
                )}

                <div class="ph-tour-footer">
                    <span class="ph-tour-progress">
                        {stepIndex + 1} of {totalSteps}
                    </span>

                    <div class="ph-tour-buttons">
                        {!isFirstStep && (
                            <button class="ph-tour-button ph-tour-button--secondary" onClick={onPrevious}>
                                Back
                            </button>
                        )}
                        {isOpenText && (
                            <button class="ph-tour-button ph-tour-button--primary" onClick={handleTextSubmit}>
                                Submit
                            </button>
                        )}
                    </div>
                </div>

                {!appearance.whiteLabel && (
                    <a
                        href="https://posthog.com/product-tours"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="ph-tour-branding"
                    >
                        Survey by {IconPosthogLogo}
                    </a>
                )}
            </div>
        </div>
    )
}
