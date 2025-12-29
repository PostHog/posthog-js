import React, { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'

import {
  CheckSVG,
  DissatisfiedEmoji,
  NeutralEmoji,
  SatisfiedEmoji,
  VeryDissatisfiedEmoji,
  VerySatisfiedEmoji,
} from '../icons'
import {
  defaultRatingLabelOpacity,
  getContrastingTextColor,
  getDisplayOrderChoices,
  SurveyAppearanceTheme,
} from '../surveys-utils'
import {
  SurveyQuestion,
  SurveyRatingDisplay,
  SurveyQuestionType,
  LinkSurveyQuestion,
  RatingSurveyQuestion,
  MultipleSurveyQuestion,
  getValidationError,
} from '@posthog/core'
import { BottomSection } from './BottomSection'
import { QuestionHeader } from './QuestionHeader'

interface QuestionCommonProps {
  question: SurveyQuestion
  appearance: SurveyAppearanceTheme
}

export function OpenTextQuestion({
  question,
  appearance,
  onSubmit,
}: QuestionCommonProps & {
  onSubmit: (text: string) => void
}): JSX.Element {
  const [text, setText] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  const handleSubmit = () => {
    const error = getValidationError(text, question.validation, question.optional)
    if (error) {
      setValidationError(error)
      return
    }
    setValidationError(null)
    onSubmit(text.trim())
  }

  return (
    <View>
      <QuestionHeader
        question={question.question}
        description={question.description}
        descriptionContentType={question.descriptionContentType}
        appearance={appearance}
      />
      <View style={styles.textInputContainer}>
        <TextInput
          style={[
            styles.textInput,
            {
              backgroundColor: appearance.inputBackground,
              color: appearance.inputTextColor ?? getContrastingTextColor(appearance.inputBackground),
              borderColor: validationError ? '#dc3545' : appearance.borderColor,
            },
          ]}
          multiline
          numberOfLines={4}
          placeholder={appearance.placeholder}
          placeholderTextColor={
            getContrastingTextColor(
              appearance.inputTextColor ?? getContrastingTextColor(appearance.inputBackground)
            ) === 'white'
              ? 'rgba(0, 0, 0, 0.5)'
              : 'rgba(255, 255, 255, 0.5)'
          }
          onChangeText={(newText) => {
            setText(newText)
            if (validationError) {
              setValidationError(null)
            }
          }}
          value={text}
        />
        {validationError && <Text style={styles.validationError}>{validationError}</Text>}
      </View>
      <BottomSection
        text={question.buttonText ?? appearance.submitButtonText}
        submitDisabled={!!getValidationError(text, question.validation, question.optional)}
        appearance={appearance}
        onSubmit={handleSubmit}
      />
    </View>
  )
}

export function LinkQuestion({
  question,
  appearance,
  onSubmit,
}: QuestionCommonProps & {
  onSubmit: (clicked: string) => void
}): JSX.Element {
  question = question as LinkSurveyQuestion

  return (
    <>
      <QuestionHeader
        question={question.question}
        description={question.description}
        descriptionContentType={question.descriptionContentType}
        appearance={appearance}
      />
      <BottomSection
        text={question.buttonText ?? appearance.submitButtonText ?? 'Submit'}
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
  appearance,
  onSubmit,
}: QuestionCommonProps & {
  onSubmit: (rating: number | null) => void
}): JSX.Element {
  //const starting = question.scale === 10 ? 0 : 1;
  const [rating, setRating] = useState<number | null>(null)
  question = question as RatingSurveyQuestion

  return (
    <>
      <QuestionHeader
        question={question.question}
        description={question.description}
        descriptionContentType={question.descriptionContentType}
        appearance={appearance}
      />
      <View style={styles.ratingSection}>
        <View style={styles.ratingOptions}>
          {question.display === SurveyRatingDisplay.Emoji && (
            <View style={styles.ratingOptionsEmoji}>
              {(question.scale === 3 ? threeScaleEmojis : fiveScaleEmojis).map((Emoji, idx) => {
                const active = idx + 1 === rating
                return (
                  <TouchableOpacity key={idx} style={styles.ratingsEmoji} onPress={() => setRating(idx + 1)}>
                    <Emoji fill={active ? appearance.ratingButtonActiveColor : appearance.ratingButtonColor} />
                  </TouchableOpacity>
                )
              })}
            </View>
          )}
          {question.display === SurveyRatingDisplay.Number && (
            <View style={[styles.ratingOptionsNumber, { borderColor: appearance.borderColor }]}>
              {getScaleNumbers(question.scale).map((number, idx) => {
                const active = rating === number
                return (
                  <RatingButton
                    key={idx}
                    index={idx}
                    active={active}
                    appearance={appearance}
                    num={number}
                    setActiveNumber={setRating}
                  />
                )
              })}
            </View>
          )}
        </View>
        <View style={styles.ratingText}>
          <Text
            style={{
              color: appearance.textColor ?? getContrastingTextColor(appearance.backgroundColor),
              opacity: defaultRatingLabelOpacity,
            }}
          >
            {question.lowerBoundLabel}
          </Text>
          <Text
            style={{
              color: appearance.textColor ?? getContrastingTextColor(appearance.backgroundColor),
              opacity: defaultRatingLabelOpacity,
            }}
          >
            {question.upperBoundLabel}
          </Text>
        </View>
      </View>
      <BottomSection
        text={question.buttonText ?? appearance.submitButtonText}
        submitDisabled={rating === null && !question.optional}
        appearance={appearance}
        onSubmit={() => onSubmit(rating)}
      />
    </>
  )
}

export function RatingButton({
  index,
  num,
  active,
  appearance,
  setActiveNumber,
}: {
  index: number
  num: number
  active: boolean
  appearance: SurveyAppearanceTheme
  setActiveNumber: (num: number) => void
}): JSX.Element {
  const backgroundColor = active ? appearance.ratingButtonActiveColor : appearance.ratingButtonColor
  // Active state always auto-calculates for contrast; inactive uses inputTextColor override if provided
  const textColor = active
    ? getContrastingTextColor(backgroundColor)
    : (appearance.inputTextColor ?? getContrastingTextColor(backgroundColor))

  return (
    <TouchableOpacity
      style={[
        styles.ratingsNumber,
        index === 0 && { borderLeftWidth: 0 },
        { backgroundColor, borderColor: appearance.borderColor },
      ]}
      onPress={() => setActiveNumber(num)}
    >
      <Text style={{ color: textColor }}>{num}</Text>
    </TouchableOpacity>
  )
}

export function MultipleChoiceQuestion({
  question,
  appearance,
  onSubmit,
}: QuestionCommonProps & {
  onSubmit: (choices: string | string[] | null) => void
}): JSX.Element {
  question = question as MultipleSurveyQuestion
  const allowMultiple = question.type === SurveyQuestionType.MultipleChoice
  const openChoice = question.hasOpenChoice ? question.choices[question.choices.length - 1] : null
  const choices = useMemo(() => getDisplayOrderChoices(question as MultipleSurveyQuestion), [question])
  const [selectedChoices, setSelectedChoices] = useState<string[]>([])
  const [openEndedInput, setOpenEndedInput] = useState('')

  return (
    <View>
      <QuestionHeader
        question={question.question}
        description={question.description}
        descriptionContentType={question.descriptionContentType}
        appearance={appearance}
      />
      <View style={styles.multipleChoiceOptions}>
        {choices.map((choice: string, idx: number) => {
          const isOpenChoice = choice === openChoice
          const isSelected = selectedChoices.includes(choice)

          const choiceTextColor = appearance.inputTextColor ?? getContrastingTextColor(appearance.inputBackground)

          return (
            <Pressable
              key={idx}
              style={[
                styles.choiceOption,
                { backgroundColor: appearance.inputBackground },
                isSelected ? { borderColor: getContrastingTextColor(appearance.backgroundColor) } : {},
              ]}
              onPress={() => {
                if (allowMultiple) {
                  setSelectedChoices(
                    isSelected ? selectedChoices.filter((c) => c !== choice) : [...selectedChoices, choice]
                  )
                } else {
                  setSelectedChoices([choice])
                }
              }}
            >
              <View style={styles.choiceText}>
                <Text style={{ flexGrow: 1, color: choiceTextColor }}>
                  {choice}
                  {isOpenChoice ? ':' : ''}
                </Text>
                <View style={styles.rightCheckArea}>{isSelected && <CheckSVG />}</View>
              </View>
              {isOpenChoice && (
                <TextInput
                  style={styles.openEndedInput}
                  onChangeText={(userValue) => {
                    setOpenEndedInput(userValue)
                    if (!isSelected) {
                      setSelectedChoices(allowMultiple ? [...selectedChoices, choice] : [choice])
                    }
                  }}
                />
              )}
            </Pressable>
          )
        })}
      </View>
      <BottomSection
        text={question.buttonText ?? appearance.submitButtonText}
        submitDisabled={
          !question.optional &&
          (selectedChoices.length === 0 ||
            (openChoice !== null && selectedChoices.includes(openChoice) && openEndedInput.length === 0))
        }
        appearance={appearance}
        onSubmit={() => {
          // If open choice is selected, replace the choice name with the actual value entered
          const result = selectedChoices.map((c) => (c === openChoice ? openEndedInput : c))
          // For single choice questions, return the first element
          // For multiple choice questions, always return an array
          onSubmit(allowMultiple ? result : result[0])
        }}
      />
    </View>
  )
}

const threeScaleEmojis = [DissatisfiedEmoji, NeutralEmoji, SatisfiedEmoji]
const fiveScaleEmojis = [VeryDissatisfiedEmoji, DissatisfiedEmoji, NeutralEmoji, SatisfiedEmoji, VerySatisfiedEmoji]
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

const styles = StyleSheet.create({
  textInputContainer: {
    padding: 10,
  },
  textInput: {
    borderColor: '#ccc',
    borderWidth: 1,
    padding: 10,
    marginVertical: 10,
    fontSize: 16,
  },
  ratingSection: {
    marginVertical: 10,
  },
  ratingOptions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  ratingOptionsEmoji: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    flexWrap: 'nowrap',
    flex: 1,
  },
  ratingsEmoji: {
    padding: 4,
  },
  ratingOptionsNumber: {
    margin: 10,
    flexGrow: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderRadius: 5,
    borderWidth: 1,
    overflow: 'hidden',
  },
  ratingsNumber: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderLeftWidth: 1,
  },
  ratingText: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 10,
  },
  multipleChoiceOptions: {
    padding: 10,
  },
  choiceOption: {
    flexDirection: 'column',
    marginVertical: 5,
    borderWidth: 1,
    borderColor: 'grey',
    borderRadius: 5,
    padding: 10,
  },
  choiceText: {
    flexDirection: 'row',
  },
  rightCheckArea: {
    flexGrow: 0,
  },
  openEndedInput: {
    padding: 5,
  },
  validationError: {
    color: '#dc3545',
    fontSize: 12,
    marginTop: 4,
  },
})
