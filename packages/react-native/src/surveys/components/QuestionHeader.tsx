import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { SurveyQuestionDescriptionContentType } from '../../../../posthog-core/src'

export function QuestionHeader({
  question,
  description,
  descriptionContentType,
}: {
  question: string
  description?: string | null
  descriptionContentType?: SurveyQuestionDescriptionContentType
}): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.question}>{question}</Text>
      {description && descriptionContentType === SurveyQuestionDescriptionContentType.Text && (
        <Text style={styles.description}>{description}</Text>
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
