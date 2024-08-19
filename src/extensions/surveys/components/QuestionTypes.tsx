import {
    BasicSurveyQuestion,
    SurveyAppearance,
    LinkSurveyQuestion,
    RatingSurveyQuestion,
    MultipleSurveyQuestion,
    SurveyQuestionType,
} from '../../../posthog-surveys-types'
import { RefObject } from 'preact'
import { useRef, useState, useMemo } from 'preact/hooks'
import { isNull, isArray } from '../../../utils/type-utils'
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

export function OpenTextQuestion({
    question,
    forceDisableHtml,
    appearance,
    onSubmit,
}: {
    question: BasicSurveyQuestion
    forceDisableHtml: boolean
    appearance: SurveyAppearance
    onSubmit: (text: string) => void
}) {
    const textRef = useRef(null)
    const [text, setText] = useState('')

    return (
        <div ref={textRef}>
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
            />
        </div>
    )
}

export function LinkQuestion({
    question,
    forceDisableHtml,
    appearance,
    onSubmit,
}: {
    question: LinkSurveyQuestion
    forceDisableHtml: boolean
    appearance: SurveyAppearance
    onSubmit: (clicked: string) => void
}) {
    return (
        <>
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
            />
        </>
    )
}

export function RatingQuestion({
    question,
    forceDisableHtml,
    displayQuestionIndex,
    appearance,
    onSubmit,
}: {
    question: RatingSurveyQuestion
    forceDisableHtml: boolean
    displayQuestionIndex: number
    appearance: SurveyAppearance
    onSubmit: (rating: number | null) => void
}) {
    const scale = question.scale
    const starting = question.scale === 10 ? 0 : 1
    const [rating, setRating] = useState<number | null>(null)

    return (
        <>
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
            />
        </>
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

export function MultipleChoiceQuestion({
    question,
    forceDisableHtml,
    displayQuestionIndex,
    appearance,
    onSubmit,
}: {
    question: MultipleSurveyQuestion
    forceDisableHtml: boolean
    displayQuestionIndex: number
    appearance: SurveyAppearance
    onSubmit: (choices: string | string[] | null) => void
}) {
    const textRef = useRef(null)
    const choices = useMemo(() => getDisplayOrderChoices(question), [question])
    const [selectedChoices, setSelectedChoices] = useState<string | string[] | null>(
        question.type === SurveyQuestionType.MultipleChoice ? [] : null
    )
    const [openChoiceSelected, setOpenChoiceSelected] = useState(false)
    const [openEndedInput, setOpenEndedInput] = useState('')

    const inputType = question.type === SurveyQuestionType.SingleChoice ? 'radio' : 'checkbox'
    return (
        <div ref={textRef}>
            <QuestionHeader
                question={question.question}
                description={question.description}
                descriptionContentType={question.descriptionContentType}
                forceDisableHtml={forceDisableHtml}
                backgroundColor={appearance.backgroundColor}
            />
            <div className="multiple-choice-options">
                {/* Remove the last element from the choices, if hasOpenChoice is set */}
                {/* shuffle all other options here if question.shuffleOptions is set */}
                {/* Always ensure that the open ended choice is the last option */}
                {choices.map((choice: string, idx: number) => {
                    let choiceClass = 'choice-option'
                    const val = choice
                    const option = choice
                    if (!!question.hasOpenChoice && idx === question.choices.length - 1) {
                        choiceClass += ' choice-option-open'
                    }
                    return (
                        <div className={choiceClass}>
                            <input
                                type={inputType}
                                id={`surveyQuestion${displayQuestionIndex}Choice${idx}`}
                                name={`question${displayQuestionIndex}`}
                                value={val}
                                disabled={!val}
                                onInput={() => {
                                    if (question.hasOpenChoice && idx === question.choices.length - 1) {
                                        return setOpenChoiceSelected(!openChoiceSelected)
                                    }
                                    if (question.type === SurveyQuestionType.SingleChoice) {
                                        return setSelectedChoices(val)
                                    }
                                    if (
                                        question.type === SurveyQuestionType.MultipleChoice &&
                                        isArray(selectedChoices)
                                    ) {
                                        if (selectedChoices.includes(val)) {
                                            // filter out values because clicking on a selected choice should deselect it
                                            return setSelectedChoices(
                                                selectedChoices.filter((choice) => choice !== val)
                                            )
                                        }
                                        return setSelectedChoices([...selectedChoices, val])
                                    }
                                }}
                            />
                            <label
                                htmlFor={`surveyQuestion${displayQuestionIndex}Choice${idx}`}
                                style={{ color: 'black' }}
                            >
                                {question.hasOpenChoice && idx === question.choices.length - 1 ? (
                                    <>
                                        <span>{option}:</span>
                                        <input
                                            type="text"
                                            id={`surveyQuestion${displayQuestionIndex}Choice${idx}Open`}
                                            name={`question${displayQuestionIndex}`}
                                            onInput={(e) => {
                                                const userValue = e.currentTarget.value
                                                if (question.type === SurveyQuestionType.SingleChoice) {
                                                    return setSelectedChoices(userValue)
                                                }
                                                if (
                                                    question.type === SurveyQuestionType.MultipleChoice &&
                                                    isArray(selectedChoices)
                                                ) {
                                                    return setOpenEndedInput(userValue)
                                                }
                                            }}
                                        />
                                    </>
                                ) : (
                                    option
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
                submitDisabled={
                    (isNull(selectedChoices) ||
                        (isArray(selectedChoices) && !openChoiceSelected && selectedChoices.length === 0) ||
                        (isArray(selectedChoices) &&
                            openChoiceSelected &&
                            !openEndedInput &&
                            selectedChoices.length === 0 &&
                            !question.optional)) &&
                    !question.optional
                }
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
