import React from 'react'
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import { SurveyAppearanceTheme } from '../surveys-utils'

export function BottomSection({
  text,
  submitDisabled,
  appearance,
  onSubmit,
  link,
}: {
  text: string
  submitDisabled: boolean
  appearance: SurveyAppearanceTheme
  onSubmit: () => void
  link?: string | null
}): JSX.Element {
  return (
    <View style={styles.bottomSection}>
      <TouchableOpacity
        style={[
          styles.button,
          { backgroundColor: appearance.submitButtonColor },
          submitDisabled && styles.buttonDisabled,
        ]}
        disabled={submitDisabled}
        onPress={() => {
          onSubmit()
          if (link) {
            Linking.canOpenURL(link).then((supported) => {
              if (supported) {
                Linking.openURL(link)
              }
            })
          }
        }}
      >
        <Text style={[styles.buttonText, { color: appearance.submitButtonTextColor }]}>{text}</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  bottomSection: {
    padding: 10,
  },
  button: {
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 16,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
})
