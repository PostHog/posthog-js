import { Fragment } from 'preact'
import { useMemo, useRef, useState } from 'preact/hooks'
import {
    BasicSurveyQuestion,
    LinkSurveyQuestion,
    MultipleSurveyQuestion,
    RatingSurveyQuestion,
    SurveyAppearance,
    SurveyQuestionType,
} from '../../../posthog-surveys-types'
import { isArray, isNull, isNumber, isString } from '../../../utils/type-utils'
import { dissatisfiedEmoji, neutralEmoji, satisfiedEmoji, veryDissatisfiedEmoji, verySatisfiedEmoji } from '../icons'
import { getDisplayOrderChoices, useSurveyContext } from '../surveys-extension-utils'
import { BottomSection } from './BottomSection'
import { QuestionHeader } from './QuestionHeader'

export interface CommonQuestionProps {
    forceDisableHtml: boolean
    appearance: SurveyAppearance
    onSubmit: (res: string | string[] | number | null) => void
    onPreviewSubmit: (res: string | string[] | number | null) => void
    initialValue?: string | string[] | number | null
}

// Enhanced TypeScript interfaces for better type safety
interface OpenEndedInputState {
    isSelected: boolean
    inputValue: string
}

// Type guards for better type safety
const isValidStringArray = (value: unknown): value is string[] => {
    return isArray(value) && value.every((item) => isString(item))
}

const initializeSelectedChoices = (
    initialValue: string | string[] | number | null | undefined,
    questionType: SurveyQuestionType
): string | string[] | null => {
    if (isString(initialValue)) {
        return initialValue
    }
    if (isValidStringArray(initialValue)) {
        return initialValue
    }
    return questionType === SurveyQuestionType.SingleChoice ? null : []
}

const initializeOpenEndedState = (
    initialValue: string | string[] | number | null | undefined,
    choices: string[]
): OpenEndedInputState => {
    if (isString(initialValue) && !choices.includes(initialValue)) {
        return {
            isSelected: true,
            inputValue: initialValue,
        }
    }
    if (isValidStringArray(initialValue)) {
        const openEndedValue = initialValue.find((choice) => !choices.includes(choice))
        if (openEndedValue) {
            return {
                isSelected: true,
                inputValue: openEndedValue,
            }
        }
    }
    return {
        isSelected: false,
        inputValue: '',
    }
}

export function OpenTextQuestion({
    question,
    forceDisableHtml,
    appearance,
    onSubmit,
    onPreviewSubmit,
    initialValue,
}: CommonQuestionProps & {
    question: BasicSurveyQuestion
}) {
    const [text, setText] = useState<string>(() => {
        if (isString(initialValue)) {
            return initialValue
        }
        return ''
    })

    return (
        <Fragment>
            <div className="question-container">
                <QuestionHeader
                    question={question.question}
                    description={question.description}
                    descriptionContentType={question.descriptionContentType}
                    forceDisableHtml={forceDisableHtml}
                />
                <textarea
                    rows={4}
                    placeholder={appearance?.placeholder}
                    onInput={(e) => {
                        setText(e.currentTarget.value)
                        e.stopPropagation()
                    }}
                    onKeyDown={(e) => {
                        e.stopPropagation()
                    }}
                    value={text}
                />
            </div>
            <BottomSection
                text={question.buttonText || 'Submit'}
                submitDisabled={!text && !question.optional}
                appearance={appearance}
                onSubmit={() => onSubmit(text)}
                onPreviewSubmit={() => onPreviewSubmit(text)}
            />
        </Fragment>
    )
}

export function LinkQuestion({
    question,
    forceDisableHtml,
    appearance,
    onSubmit,
    onPreviewSubmit,
}: CommonQuestionProps & {
    question: LinkSurveyQuestion
}) {
    return (
        <Fragment>
            <div className="question-container">
                <QuestionHeader
                    question={question.question}
                    description={question.description}
                    descriptionContentType={question.descriptionContentType}
                    forceDisableHtml={forceDisableHtml}
                />
            </div>
            <BottomSection
                text={question.buttonText || 'Submit'}
                submitDisabled={false}
                link={question.link}
                appearance={appearance}
                onSubmit={() => onSubmit('link clicked')}
                onPreviewSubmit={() => onPreviewSubmit('link clicked')}
            />
        </Fragment>
    )
}

export function RatingQuestion({
    question,
    forceDisableHtml,
    displayQuestionIndex,
    appearance,
    onSubmit,
    onPreviewSubmit,
    initialValue,
}: CommonQuestionProps & {
    question: RatingSurveyQuestion
    displayQuestionIndex: number
}) {
    const scale = question.scale
    const starting = question.scale === 10 ? 0 : 1
    const [rating, setRating] = useState<number | null>(() => {
        if (isNumber(initialValue)) {
            return initialValue
        }
        if (isArray(initialValue) && initialValue.length > 0 && isNumber(parseInt(initialValue[0]))) {
            return parseInt(initialValue[0])
        }
        if (isString(initialValue) && isNumber(parseInt(initialValue))) {
            return parseInt(initialValue)
        }
        return null
    })

    const { isPreviewMode } = useSurveyContext()

    const handleSubmit = (num: number) => {
        if (isPreviewMode) {
            return onPreviewSubmit(num)
        }
        return onSubmit(num)
    }

    return (
        <Fragment>
            <div className="question-container">
                <QuestionHeader
                    question={question.question}
                    description={question.description}
                    descriptionContentType={question.descriptionContentType}
                    forceDisableHtml={forceDisableHtml}
                />
                <div className="rating-section">
                    <div className="rating-options">
                        {question.display === 'emoji' && (
                            <div className="rating-options-emoji">
                                {(question.scale === 3 ? threeScaleEmojis : fiveScaleEmojis).map((emoji, idx) => {
                                    const active = idx + 1 === rating
                                    return (
                                        <button
                                            aria-label={`Rate ${idx + 1}`}
                                            className={`ratings-emoji question-${displayQuestionIndex}-rating-${idx} ${
                                                active ? 'rating-active' : ''
                                            }`}
                                            value={idx + 1}
                                            key={idx}
                                            type="button"
                                            onClick={() => {
                                                const response = idx + 1
                                                setRating(response)
                                                if (question.skipSubmitButton) {
                                                    handleSubmit(response)
                                                }
                                            }}
                                        >
                                            {emoji}
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                        {question.display === 'number' && (
                            <div
                                className="rating-options-number"
                                style={{ gridTemplateColumns: `repeat(${scale - starting + 1}, minmax(0, 1fr))` }}
                            >
                                {getScaleNumbers(question.scale).map((number, idx) => {
                                    const active = rating === number
                                    return (
                                        <RatingButton
                                            key={idx}
                                            displayQuestionIndex={displayQuestionIndex}
                                            active={active}
                                            appearance={appearance}
                                            num={number}
                                            setActiveNumber={(response) => {
                                                setRating(response)
                                                if (question.skipSubmitButton) {
                                                    handleSubmit(response)
                                                }
                                            }}
                                        />
                                    )
                                })}
                            </div>
                        )}
                    </div>
                    <div className="rating-text">
                        <div>{question.lowerBoundLabel}</div>
                        <div>{question.upperBoundLabel}</div>
                    </div>
                </div>
            </div>
            <BottomSection
                text={question.buttonText || appearance?.submitButtonText || 'Submit'}
                submitDisabled={isNull(rating) && !question.optional}
                appearance={appearance}
                onSubmit={() => onSubmit(rating)}
                onPreviewSubmit={() => onPreviewSubmit(rating)}
                skipSubmitButton={question.skipSubmitButton}
            />
        </Fragment>
    )
}

export function RatingButton({
    num,
    active,
    displayQuestionIndex,
    setActiveNumber,
}: {
    num: number
    active: boolean
    displayQuestionIndex: number
    appearance: SurveyAppearance
    setActiveNumber: (num: number) => void
}) {
    return (
        <button
            aria-label={`Rate ${num}`}
            className={`ratings-number question-${displayQuestionIndex}-rating-${num} ${active ? 'rating-active' : ''}`}
            type="button"
            onClick={() => {
                setActiveNumber(num)
            }}
        >
            {num}
        </button>
    )
}

export function MultipleChoiceQuestion({
    question,
    forceDisableHtml,
    displayQuestionIndex,
    appearance,
    onSubmit,
    onPreviewSubmit,
    initialValue,
}: CommonQuestionProps & {
    question: MultipleSurveyQuestion
    displayQuestionIndex: number
}) {
    const openChoiceInputRef = useRef<HTMLInputElement>(null)
    const choices = useMemo(() => getDisplayOrderChoices(question), [question])

    // Enhanced state management with better initialization
    const [selectedChoices, setSelectedChoices] = useState<string | string[] | null>(() =>
        initializeSelectedChoices(initialValue, question.type)
    )

    const [openEndedState, setOpenEndedState] = useState<OpenEndedInputState>(() =>
        initializeOpenEndedState(initialValue, choices)
    )

    const { isPreviewMode } = useSurveyContext()

    const inputType = question.type === SurveyQuestionType.SingleChoice ? 'radio' : 'checkbox'
    const shouldSkipSubmit =
        question.skipSubmitButton && question.type === SurveyQuestionType.SingleChoice && !question.hasOpenChoice

    const handleChoiceChange = (val: string, isOpenChoice: boolean) => {
        if (isOpenChoice) {
            const newOpenSelected = !openEndedState.isSelected
            setOpenEndedState((prev) => ({
                ...prev,
                isSelected: newOpenSelected,
                inputValue: newOpenSelected ? prev.inputValue : '',
            }))

            // Focus the input when open choice is selected
            if (newOpenSelected) {
                setTimeout(() => openChoiceInputRef.current?.focus(), 0)
            }
            return
        }

        if (question.type === SurveyQuestionType.SingleChoice) {
            setSelectedChoices(val)
            // Deselect open choice when selecting another option
            setOpenEndedState((prev) => ({
                ...prev,
                isSelected: false,
                inputValue: '',
            }))

            if (shouldSkipSubmit) {
                onSubmit(val)
                if (isPreviewMode) {
                    onPreviewSubmit(val)
                }
            }
            return
        }

        if (question.type === SurveyQuestionType.MultipleChoice && isArray(selectedChoices)) {
            if (selectedChoices.includes(val)) {
                setSelectedChoices(selectedChoices.filter((choice) => choice !== val))
            } else {
                setSelectedChoices([...selectedChoices, val])
            }
        }
    }

    const handleOpenEndedInputChange = (e: React.FormEvent<HTMLInputElement>) => {
        e.stopPropagation()
        const newValue = e.currentTarget.value

        setOpenEndedState((prev) => ({
            ...prev,
            inputValue: newValue,
        }))

        if (question.type === SurveyQuestionType.SingleChoice) {
            setSelectedChoices(newValue)
        }
    }

    const handleOpenEndedKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation()

        // Handle Enter key to submit form if valid
        if (e.key === 'Enter' && !isSubmitDisabled()) {
            e.preventDefault()
            handleSubmit(false)
        }

        // Handle Escape key to clear input and deselect
        if (e.key === 'Escape') {
            e.preventDefault()
            setOpenEndedState((prev) => ({
                ...prev,
                isSelected: false,
                inputValue: '',
            }))
            if (question.type === SurveyQuestionType.SingleChoice) {
                setSelectedChoices(null)
            }
        }
    }

    // Enhanced submit disabled logic with better type safety and validation awareness
    const isSubmitDisabled = (): boolean => {
        if (question.optional) {
            return false
        }

        if (isNull(selectedChoices)) {
            return true
        }

        if (isArray(selectedChoices)) {
            if (!openEndedState.isSelected && selectedChoices.length === 0) {
                return true
            }
        }

        if (openEndedState.isSelected && openEndedState.inputValue.trim() === '') {
            return true
        }

        return false
    }

    // Enhanced submit handler with better logic
    const handleSubmit = (isPreview: boolean = false) => {
        if (openEndedState.isSelected && question.type === SurveyQuestionType.MultipleChoice) {
            if (isArray(selectedChoices)) {
                isPreview
                    ? onPreviewSubmit([...selectedChoices, openEndedState.inputValue])
                    : onSubmit([...selectedChoices, openEndedState.inputValue])
            }
        } else {
            isPreview ? onPreviewSubmit(selectedChoices) : onSubmit(selectedChoices)
        }
    }

    return (
        <Fragment>
            <div className="question-container">
                <QuestionHeader
                    question={question.question}
                    description={question.description}
                    descriptionContentType={question.descriptionContentType}
                    forceDisableHtml={forceDisableHtml}
                />
                <fieldset className="multiple-choice-options limit-height">
                    <legend className="sr-only">
                        {question.type === SurveyQuestionType.MultipleChoice ? ' Select all that apply' : ' Select one'}
                    </legend>
                    {choices.map((choice: string, idx: number) => {
                        const isOpenChoice = !!question.hasOpenChoice && idx === question.choices.length - 1
                        const choiceClass = isOpenChoice ? ' choice-option-open' : ''
                        const openInputId = isOpenChoice
                            ? `surveyQuestion${displayQuestionIndex}Choice${idx}Open`
                            : undefined
                        const inputName = `surveyQuestion${displayQuestionIndex}Choice${idx}`

                        const isChecked = isOpenChoice
                            ? openEndedState.isSelected
                            : question.type === SurveyQuestionType.SingleChoice
                              ? selectedChoices === choice
                              : isArray(selectedChoices) && selectedChoices.includes(choice)

                        return (
                            <label className={choiceClass} key={idx}>
                                <input
                                    type={inputType}
                                    name={inputName}
                                    checked={isChecked}
                                    onChange={() => handleChoiceChange(choice, isOpenChoice)}
                                    aria-controls={openInputId}
                                />
                                {isOpenChoice ? (
                                    <>
                                        <span>{choice}:</span>
                                        <input
                                            type="text"
                                            ref={openChoiceInputRef}
                                            id={openInputId}
                                            name={`question${displayQuestionIndex}Open`}
                                            value={openEndedState.inputValue}
                                            onKeyDown={handleOpenEndedKeyDown}
                                            onInput={handleOpenEndedInputChange}
                                            onClick={(e) => {
                                                // Ensure the checkbox/radio gets checked when clicking the input
                                                if (!openEndedState.isSelected) {
                                                    handleChoiceChange(choice, true)
                                                }
                                                e.stopPropagation()
                                            }}
                                            aria-label={`${choice} - please specify`}
                                            placeholder="Please specify..."
                                        />
                                    </>
                                ) : (
                                    choice
                                )}
                            </label>
                        )
                    })}
                </fieldset>
            </div>
            <BottomSection
                text={question.buttonText || 'Submit'}
                submitDisabled={isSubmitDisabled()}
                appearance={appearance}
                onSubmit={() => handleSubmit(false)}
                onPreviewSubmit={() => handleSubmit(true)}
                skipSubmitButton={shouldSkipSubmit}
            />
        </Fragment>
    )
}

const threeScaleEmojis = [dissatisfiedEmoji, neutralEmoji, satisfiedEmoji]
const fiveScaleEmojis = [veryDissatisfiedEmoji, dissatisfiedEmoji, neutralEmoji, satisfiedEmoji, verySatisfiedEmoji]
const fiveScaleNumbers = [1, 2, 3, 4, 5]
const sevenScaleNumbers = [1, 2, 3, 4, 5, 6, 7]
const tenScaleNumbers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

function getScaleNumbers(scale: number): number[] {
    switch (scale) {
        case 5:
            return fiveScaleNumbers
        case 7:
            return sevenScaleNumbers
        case 10:
            return tenScaleNumbers
        default:
            return fiveScaleNumbers
    }
}
