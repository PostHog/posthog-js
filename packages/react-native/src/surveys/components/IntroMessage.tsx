import React from 'react'
import { Text, View } from 'react-native'

import { createSafeStyleSheet } from '../safeStyleSheet'
import {
  defaultDescriptionOpacity,
  getContrastingTextColor,
  getMaxFontSizeMultiplier,
  shouldRenderDescription,
  SurveyAppearanceTheme,
} from '../surveys-utils'
import { SurveyQuestionDescriptionContentType } from '@posthog/core'
import { BottomSection } from './BottomSection'

export function IntroMessage({
  appearance,
  header,
  description,
  contentType,
  onStart,
}: {
  appearance: SurveyAppearanceTheme
  header: string
  description: string
  contentType?: SurveyQuestionDescriptionContentType
  onStart: () => void
}): JSX.Element {
  const textColor = getContrastingTextColor(appearance.backgroundColor)

  return (
    <View>
      <View style={styles.introMessageContainer}>
        {header ? (
          <Text
            maxFontSizeMultiplier={getMaxFontSizeMultiplier(appearance, 'header')}
            style={[styles.introMessageHeader, { color: textColor }]}
          >
            {header}
          </Text>
        ) : null}
        {shouldRenderDescription(description, contentType) && (
          <Text
            maxFontSizeMultiplier={getMaxFontSizeMultiplier(appearance, 'description')}
            style={{ color: textColor, opacity: defaultDescriptionOpacity }}
          >
            {description}
          </Text>
        )}
      </View>
      <BottomSection
        text={appearance.introScreenButtonText || 'Get started'}
        submitDisabled={false}
        appearance={appearance}
        onSubmit={onStart}
      />
    </View>
  )
}

const styles = createSafeStyleSheet({
  introMessageContainer: {
    padding: 10,
  },
  introMessageHeader: {
    fontSize: 18,
    fontWeight: 'bold',
  },
})
