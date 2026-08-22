import React from 'react'
import { Text, View } from 'react-native'

import { SurveyQuestionDescriptionContentType } from '@posthog/core'
import { createSafeStyleSheet } from '../safeStyleSheet'
import {
  defaultDescriptionOpacity,
  getContrastingTextColor,
  getMaxFontSizeMultiplier,
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
  // Use textColor override if provided, otherwise auto-calculate from background
  const textColor = appearance.textColor ?? getContrastingTextColor(appearance.backgroundColor)

  return (
    <View style={styles.container}>
      <Text
        maxFontSizeMultiplier={getMaxFontSizeMultiplier(appearance, 'question')}
        style={[styles.question, { color: textColor }]}
      >
        {question}
      </Text>
      {shouldRenderDescription(description, descriptionContentType) && (
        <Text
          maxFontSizeMultiplier={getMaxFontSizeMultiplier(appearance, 'description')}
          style={[styles.description, { color: textColor, opacity: defaultDescriptionOpacity }]}
        >
          {description}
        </Text>
      )}
    </View>
  )
}

const styles = createSafeStyleSheet({
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
