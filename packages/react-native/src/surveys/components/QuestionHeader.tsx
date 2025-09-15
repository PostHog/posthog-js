import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { SurveyQuestionDescriptionContentType } from '@posthog/core'

export function QuestionHeader({
  question,
  description,
  descriptionContentType,
}: {
  question: string
  description?: string | null
  descriptionContentType?: SurveyQuestionDescriptionContentType
}): JSX.Element {
  const processedDescription = description
    ? descriptionContentType === SurveyQuestionDescriptionContentType.Html
      ? description.replace(/<[^>]*>/g, '') // Strip HTML tags for React Native
      : description
    : null

  return (
    <View style={styles.container}>
      <Text style={styles.question}>{question}</Text>
      {processedDescription && <Text style={styles.description}>{processedDescription}</Text>}
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
