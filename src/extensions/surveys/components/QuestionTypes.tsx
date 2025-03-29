import { Fragment, RefObject } from 'preact'
import { useMemo, useRef, useState } from 'preact/hooks'
import {
    BasicSurveyQuestion,
    LinkSurveyQuestion,
    MultipleSurveyQuestion,
    RatingSurveyQuestion,
    SurveyAppearance,
    SurveyQuestionType,
} from '../../../posthog-surveys-types'
import { isArray, isNull } from '../../../utils/type-utils'
import { useContrastingTextColor } from '../hooks/useContrastingTextColor'
import {
    checkSVG,
    dissatisfiedEmoji,
    neutralEmoji,
    satisfiedEmoji,
    veryDissatisfiedEmoji,
    verySatisfiedEmoji,
} from '../icons'
import { getDisplayOrderChoices } from '../surveys-utils'
import { BottomSection } from './BottomSection'
import { QuestionHeader } from './QuestionHeader'

interface CommonProps {
    forceDisableHtml: boolean
    appearance: SurveyAppearance
    onSubmit: (res: string | string[] | number | null) => void
    onPreviewSubmit: (res: string | string[] | number | null) => void
}

export function OpenTextQuestion({
    question,
    forceDisableHtml,
    appearance,
    onSubmit,
    onPreviewSubmit,
}: CommonProps & {
    question: BasicSurveyQuestion
}) {
    const [text, setText] = useState('')

    return (
        <div>
            <QuestionHeader
                question={question.question}
                description={question.description}
                descriptionContentType={question.descriptionContentType}
                backgroundColor={appearance.backgroundColor}
                forceDisableHtml={forceDisableHtml}
            />
            <textarea rows={4} placeholder={appearance?.placeholder} onInput={(e) => setText(e.currentTarget.value)} />
            <BottomSection
                text={question.buttonText || 'Submit'}
                submitDisabled={!text && !question.optional}
                appearance={appearance}
                onSubmit={() => onSubmit(text)}
                onPreviewSubmit={() => onPreviewSubmit(text)}
            />
        </div>
    )
}

export function LinkQuestion({
    question,
    forceDisableHtml,
    appearance,
    onSubmit,
    onPreviewSubmit,
}: CommonProps & {
    question: LinkSurveyQuestion
}) {
    return (
        <Fragment>
            <QuestionHeader
                question={question.question}
                description={question.description}
                descriptionContentType={question.descriptionContentType}
                forceDisableHtml={forceDisableHtml}
            />
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
}: CommonProps & {
    question: RatingSurveyQuestion
    displayQuestionIndex: number
}) {
    const scale = question.scale
    const starting = question.scale === 10 ? 0 : 1
    const [rating, setRating] = useState<number | null>(null)

    return (
        <Fragment>
            <QuestionHeader
                question={question.question}
                description={question.description}
                descriptionContentType={question.descriptionContentType}
                forceDisableHtml={forceDisableHtml}
                backgroundColor={appearance.backgroundColor}
            />
            <div className="rating-section">
                <div className="rating-options">
                    {question.display === 'emoji' && (
                        <div className="rating-options-emoji">
                            {(question.scale === 3 ? threeScaleEmojis : fiveScaleEmojis).map((emoji, idx) => {
                                const active = idx + 1 === rating
                                return (
                                    <button
                                        className={`ratings-emoji question-${displayQuestionIndex}-rating-${idx} ${
                                            active ? 'rating-active' : null
                                        }`}
                                        value={idx + 1}
                                        key={idx}
                                        type="button"
                                        onClick={() => {
                                            setRating(idx + 1)
                                        }}
                                        style={{
                                            fill: active
                                                ? appearance.ratingButtonActiveColor
                                                : appearance.ratingButtonColor,
                                            borderColor: appearance.borderColor,
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
                                        setActiveNumber={(num) => {
                                            setRating(num)
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
            <BottomSection
                text={question.buttonText || appearance?.submitButtonText || 'Submit'}
                submitDisabled={isNull(rating) && !question.optional}
                appearance={appearance}
                onSubmit={() => onSubmit(rating)}
                onPreviewSubmit={() => onPreviewSubmit(rating)}
            />
        </Fragment>
    )
}

export function RatingButton({
    num,
    active,
    displayQuestionIndex,
    appearance,
    setActiveNumber,
}: {
    num: number
    active: boolean
    displayQuestionIndex: number
    appearance: SurveyAppearance
    setActiveNumber: (num: number) => void
}) {
    const { textColor, ref } = useContrastingTextColor({ appearance, defaultTextColor: 'black', forceUpdate: active })
    return (
        <button
            ref={ref as RefObject<HTMLButtonElement>}
            className={`ratings-number question-${displayQuestionIndex}-rating-${num} ${
                active ? 'rating-active' : null
            }`}
            type="button"
            onClick={() => {
                setActiveNumber(num)
            }}
            style={{
                color: textColor,
                backgroundColor: active ? appearance.ratingButtonActiveColor : appearance.ratingButtonColor,
                borderColor: appearance.borderColor,
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
}: CommonProps & {
    question: MultipleSurveyQuestion
    displayQuestionIndex: number
}) {
    const openChoiceInputRef = useRef<HTMLInputElement>(null)
    const choices = useMemo(() => getDisplayOrderChoices(question), [question])
    const [selectedChoices, setSelectedChoices] = useState<string | string[] | null>(
        question.type === SurveyQuestionType.MultipleChoice ? [] : null
    )
    const [openChoiceSelected, setOpenChoiceSelected] = useState(false)
    const [openEndedInput, setOpenEndedInput] = useState('')

    const inputType = question.type === SurveyQuestionType.SingleChoice ? 'radio' : 'checkbox'

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

    const handleOpenEndedInputChange = (value: string) => {
        setOpenEndedInput(value)
        if (question.type === SurveyQuestionType.SingleChoice) {
            setSelectedChoices(value)
        }
    }

    return (
        <div>
            <QuestionHeader
                question={question.question}
                description={question.description}
                descriptionContentType={question.descriptionContentType}
                forceDisableHtml={forceDisableHtml}
                backgroundColor={appearance.backgroundColor}
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
                            <label
                                htmlFor={`surveyQuestion${displayQuestionIndex}Choice${idx}`}
                                style={{ color: 'black' }}
                            >
                                {isOpenChoice ? (
                                    <>
                                        <span>{choice}:</span>
                                        <input
                                            type="text"
                                            ref={openChoiceInputRef}
                                            id={`surveyQuestion${displayQuestionIndex}Choice${idx}Open`}
                                            name={`question${displayQuestionIndex}`}
                                            value={openEndedInput}
                                            onInput={(e) => handleOpenEndedInputChange(e.currentTarget.value)}
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
                            <span className="choice-check" style={{ color: 'black' }}>
                                {checkSVG}
                            </span>
                        </div>
                    )
                })}
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
            />
        </div>
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
