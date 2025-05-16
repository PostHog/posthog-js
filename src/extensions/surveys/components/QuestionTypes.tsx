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
import {
    checkSVG,
    dissatisfiedEmoji,
    neutralEmoji,
    satisfiedEmoji,
    veryDissatisfiedEmoji,
    verySatisfiedEmoji,
} from '../icons'
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

function isSubmitDisabled(
    selectedChoices: string | string[] | null,
    openChoiceSelected: boolean,
    openEndedInput: string,
    optional: boolean
): boolean {
    if (optional) {
        return false
    }

    if (isNull(selectedChoices)) {
        return true
    }

    if (isArray(selectedChoices)) {
        if (!openChoiceSelected && selectedChoices.length === 0) {
            return true
        }
        if (openChoiceSelected && !openEndedInput && selectedChoices.length === 0) {
            return true
        }
    }

    return false
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
    const [selectedChoices, setSelectedChoices] = useState<string | string[] | null>(() => {
        if (isString(initialValue)) {
            return initialValue
        }
        if (isArray(initialValue)) {
            return initialValue
        }
        return question.type === SurveyQuestionType.SingleChoice ? null : []
    })
    const [openChoiceSelected, setOpenChoiceSelected] = useState(() => {
        if (isString(initialValue)) {
            return !choices.includes(initialValue)
        }
        if (isArray(initialValue)) {
            // check if initialValue IS NOT in choices
            return !choices.some((choice) => initialValue.includes(choice))
        }
        return false
    })
    const [openEndedInput, setOpenEndedInput] = useState(() => {
        if (isString(initialValue) && !choices.includes(initialValue)) {
            return initialValue
        }
        if (isArray(initialValue)) {
            return initialValue.find((choice) => !choices.includes(choice)) || ''
        }
        return ''
    })
    const { isPreviewMode } = useSurveyContext()

    const inputType = question.type === SurveyQuestionType.SingleChoice ? 'radio' : 'checkbox'
    const shouldSkipSubmit =
        question.skipSubmitButton && question.type === SurveyQuestionType.SingleChoice && !question.hasOpenChoice

    const handleChoiceChange = (val: string, isOpenChoice: boolean) => {
        if (isOpenChoice) {
            setOpenChoiceSelected(!openChoiceSelected)
            // Focus the input when open choice is selected
            if (!openChoiceSelected) {
                // Use a small delay to ensure the focus happens after the state update
                setTimeout(() => openChoiceInputRef.current?.focus(), 0)
            }
            return
        }

        if (question.type === SurveyQuestionType.SingleChoice) {
            setSelectedChoices(val)
            setOpenChoiceSelected(false) // Deselect open choice when selecting another option
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
        setOpenEndedInput(e.currentTarget.value)
        if (question.type === SurveyQuestionType.SingleChoice) {
            setSelectedChoices(e.currentTarget.value)
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
                <div className="multiple-choice-options limit-height">
                    {choices.map((choice: string, idx: number) => {
                        const isOpenChoice = !!question.hasOpenChoice && idx === question.choices.length - 1
                        const choiceClass = `choice-option${isOpenChoice ? ' choice-option-open' : ''}`

                        const isChecked = isOpenChoice
                            ? openChoiceSelected
                            : question.type === SurveyQuestionType.SingleChoice
                              ? selectedChoices === choice
                              : isArray(selectedChoices) && selectedChoices.includes(choice)

                        return (
                            <div className={choiceClass} key={idx}>
                                <input
                                    type={inputType}
                                    id={`surveyQuestion${displayQuestionIndex}Choice${idx}`}
                                    name={`question${displayQuestionIndex}`}
                                    checked={isChecked}
                                    onClick={() => handleChoiceChange(choice, isOpenChoice)}
                                />
                                <label htmlFor={`surveyQuestion${displayQuestionIndex}Choice${idx}`}>
                                    {isOpenChoice ? (
                                        <>
                                            <span>{choice}:</span>
                                            <input
                                                type="text"
                                                ref={openChoiceInputRef}
                                                id={`surveyQuestion${displayQuestionIndex}Choice${idx}Open`}
                                                name={`question${displayQuestionIndex}`}
                                                value={openEndedInput}
                                                onKeyDown={(e) => {
                                                    e.stopPropagation()
                                                }}
                                                onInput={(e) => handleOpenEndedInputChange(e)}
                                                onClick={(e) => {
                                                    // Ensure the checkbox/radio gets checked when clicking the input
                                                    if (!openChoiceSelected) {
                                                        handleChoiceChange(choice, true)
                                                    }
                                                    e.stopPropagation()
                                                }}
                                            />
                                        </>
                                    ) : (
                                        choice
                                    )}
                                </label>
                                <span className="choice-check">{checkSVG}</span>
                            </div>
                        )
                    })}
                </div>
            </div>
            <BottomSection
                text={question.buttonText || 'Submit'}
                submitDisabled={isSubmitDisabled(
                    selectedChoices,
                    openChoiceSelected,
                    openEndedInput,
                    !!question.optional
                )}
                appearance={appearance}
                onSubmit={() => {
                    if (openChoiceSelected && question.type === SurveyQuestionType.MultipleChoice) {
                        if (isArray(selectedChoices)) {
                            onSubmit([...selectedChoices, openEndedInput])
                        }
                    } else {
                        onSubmit(selectedChoices)
                    }
                }}
                onPreviewSubmit={() => {
                    if (openChoiceSelected && question.type === SurveyQuestionType.MultipleChoice) {
                        if (isArray(selectedChoices)) {
                            onPreviewSubmit([...selectedChoices, openEndedInput])
                        }
                    } else {
                        onPreviewSubmit(selectedChoices)
                    }
                }}
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
