import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { SurveyQuestionDescriptionContentType } from '@posthog/core'
import {
  defaultDescriptionOpacity,
  getContrastingTextColor,
  shouldRenderDescription,
  SurveyAppearanceTheme,
} from '../surveys-utils'

export function QuestionHeader({
  question,
  description,
  descriptionContentType,
  appearance,
}: {
  question: string
  description?: string | null
  descriptionContentType?: SurveyQuestionDescriptionContentType
  appearance: SurveyAppearanceTheme
}): JSX.Element {
  const textColor = getContrastingTextColor(appearance.backgroundColor)

  return (
    <View style={styles.container}>
      <Text style={[styles.question, { color: textColor }]}>{question}</Text>
      {shouldRenderDescription(description, descriptionContentType) && (
        <Text style={[styles.description, { color: textColor, opacity: defaultDescriptionOpacity }]}>
          {description}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 10,
  },
  question: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  description: {
    fontSize: 14,
    marginTop: 5,
  },
})
