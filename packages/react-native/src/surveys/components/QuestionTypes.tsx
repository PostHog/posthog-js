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
import { getContrastingTextColor, getDisplayOrderChoices, SurveyAppearanceTheme } from '../surveys-utils'
import {
  SurveyQuestion,
  SurveyRatingDisplay,
  SurveyQuestionType,
  LinkSurveyQuestion,
  RatingSurveyQuestion,
  MultipleSurveyQuestion,
} from '../../../../posthog-core/src'
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

  return (
    <View>
      <QuestionHeader
        question={question.question}
        description={question.description}
        descriptionContentType={question.descriptionContentType}
      />
      <View style={styles.textInputContainer}>
        <TextInput
          style={styles.textInput}
          multiline
          numberOfLines={4}
          placeholder={appearance.placeholder}
          onChangeText={setText}
          value={text}
        />
      </View>
      <BottomSection
        text={question.buttonText ?? appearance.submitButtonText}
        submitDisabled={!text && !question.optional}
        appearance={appearance}
        onSubmit={() => onSubmit(text)}
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
          <Text>{question.lowerBoundLabel}</Text>
          <Text>{question.upperBoundLabel}</Text>
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
  const textColor = getContrastingTextColor(backgroundColor)

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
      />
      <View style={styles.multipleChoiceOptions}>
        {choices.map((choice: string, idx: number) => {
          const isOpenChoice = choice === openChoice
          const isSelected = selectedChoices.includes(choice)

          return (
            <Pressable
              key={idx}
              style={[styles.choiceOption, isSelected ? { borderColor: 'black' } : {}]}
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
                <Text style={{ flexGrow: 1 }}>
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
          onSubmit(result.length === 1 ? result[0] : result)
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
    backgroundColor: 'white',
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
    justifyContent: 'space-between',
    flexWrap: 'wrap', // Allows items to wrap to a new line
  },
  ratingsEmoji: {
    padding: 10,
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
    backgroundColor: 'white',
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
})
