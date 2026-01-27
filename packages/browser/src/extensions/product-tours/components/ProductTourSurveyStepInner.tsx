import { h } from 'preact'
import { useState, useRef, useEffect } from 'preact/hooks'
import { ProductTourStep, ProductTourAppearance, ProductTourSurveyQuestion } from '../../../posthog-product-tours-types'
import { cancelSVG, IconPosthogLogo } from '../../surveys/icons'
import {
    dissatisfiedEmoji,
    neutralEmoji,
    satisfiedEmoji,
    veryDissatisfiedEmoji,
    verySatisfiedEmoji,
} from '../../surveys/icons'

export interface ProductTourSurveyStepInnerProps {
    step: ProductTourStep
    appearance?: ProductTourAppearance
    stepIndex: number
    totalSteps: number
    onPrevious?: () => void
    onSubmit?: (response: string | number | null) => void
    onDismiss?: () => void
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
    isInteractive,
}: {
    value: string
    onChange: (text: string) => void
    onSubmit?: () => void
    isInteractive: boolean
}): h.JSX.Element {
    const inputRef = useRef<HTMLTextAreaElement>(null)

    useEffect(() => {
        if (isInteractive) {
            setTimeout(() => inputRef.current?.focus(), 100)
        }
    }, [isInteractive])

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Enter' && e.metaKey && isInteractive) {
            e.preventDefault()
            onSubmit?.()
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
            disabled={!isInteractive}
            style={isInteractive ? undefined : { cursor: 'default' }}
        />
    )
}

function RatingInput({
    survey,
    onSubmit,
    isInteractive,
}: {
    survey: ProductTourSurveyQuestion
    onSubmit?: (rating: number) => void
    isInteractive: boolean
}): h.JSX.Element {
    const [selectedRating, setSelectedRating] = useState<number | null>(null)
    const display = survey.display || 'emoji'
    const scale = survey.scale || 5

    const handleSelect = (rating: number) => {
        if (!isInteractive) {
            return
        }
        setSelectedRating(rating)
        // Auto-submit on selection for ratings
        onSubmit?.(rating)
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
                                style={isInteractive ? undefined : { cursor: 'default' }}
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
                            style={isInteractive ? undefined : { cursor: 'default' }}
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

export function ProductTourSurveyStepInner({
    step,
    appearance,
    stepIndex,
    totalSteps,
    onPrevious,
    onSubmit,
    onDismiss,
}: ProductTourSurveyStepInnerProps): h.JSX.Element {
    const [textValue, setTextValue] = useState('')
    const survey = step.survey
    const whiteLabel = appearance?.whiteLabel ?? false
    const isFirstStep = stepIndex === 0
    const isOpenText = survey?.type === 'open'

    const isInteractive = !!(onPrevious || onSubmit || onDismiss)
    const cursorStyle = isInteractive ? undefined : { cursor: 'default' }

    const handleTextSubmit = () => {
        onSubmit?.(textValue.trim() || null)
    }

    if (!survey) {
        return <div />
    }

    return (
        <>
            <button class="ph-tour-dismiss" onClick={onDismiss} aria-label="Close survey" style={cursorStyle}>
                {cancelSVG()}
            </button>

            <div class="ph-tour-survey-question">{survey.questionText}</div>

            {isOpenText ? (
                <OpenTextInput
                    value={textValue}
                    onChange={setTextValue}
                    onSubmit={handleTextSubmit}
                    isInteractive={isInteractive}
                />
            ) : (
                <RatingInput survey={survey} onSubmit={onSubmit} isInteractive={isInteractive} />
            )}

            <div class="ph-tour-footer">
                <span class="ph-tour-progress">
                    {stepIndex + 1} of {totalSteps}
                </span>

                <div class="ph-tour-buttons">
                    {!isFirstStep && (
                        <button
                            class="ph-tour-button ph-tour-button--secondary"
                            onClick={onPrevious}
                            style={cursorStyle}
                        >
                            Back
                        </button>
                    )}
                    {isOpenText && (
                        <button
                            class="ph-tour-button ph-tour-button--primary"
                            onClick={handleTextSubmit}
                            style={cursorStyle}
                        >
                            Submit
                        </button>
                    )}
                </div>
            </div>

            {!whiteLabel && (
                <a
                    href={isInteractive ? 'https://posthog.com/product-tours' : undefined}
                    target={isInteractive ? '_blank' : undefined}
                    rel={isInteractive ? 'noopener noreferrer' : undefined}
                    class="ph-tour-branding"
                    style={isInteractive ? undefined : { cursor: 'default', pointerEvents: 'none' }}
                >
                    Survey by {IconPosthogLogo}
                </a>
            )}
        </>
    )
}
