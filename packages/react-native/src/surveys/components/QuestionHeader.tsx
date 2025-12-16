import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { createLogger, Logger } from '@posthog/core'

import { SurveyQuestionDescriptionContentType } from '@posthog/core'
import { getContrastingTextColor, shouldRenderDescription, SurveyAppearanceTheme } from '../surveys-utils'

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
  const logger = createLogger('ADAM')

  const textColor = getContrastingTextColor(appearance.backgroundColor)
  logger.info(`text color: ${textColor}`)
  logger.info(`appearance: ${JSON.stringify(appearance, null, 2)}`)

  return (
    <View style={styles.container}>
      <Text style={[styles.question, { color: textColor }]}>{question}</Text>
      {shouldRenderDescription(description, descriptionContentType) && (
        <Text style={[styles.description, { color: textColor, opacity: 0.8 }]}>{description}</Text>
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
