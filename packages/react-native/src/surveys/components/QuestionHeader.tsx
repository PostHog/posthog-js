import React, { type JSX } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { SurveyQuestionDescriptionContentType } from '@posthog/core'
import { shouldRenderDescription } from '../surveys-utils'

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
      {shouldRenderDescription(description, descriptionContentType) && (
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
