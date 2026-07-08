import React from 'react'
import { TouchableOpacity } from 'react-native'
import { CancelSVG } from '../icons'

import { createSafeStyleSheet } from '../safeStyleSheet'
import { SurveyAppearanceTheme } from '../surveys-utils'

export function Cancel({
  onPress,
  appearance,
}: {
  onPress: () => void
  appearance: SurveyAppearanceTheme
}): JSX.Element {
  return (
    <TouchableOpacity style={[styles.cancelBtnWrapper, { borderColor: appearance.borderColor }]} onPress={onPress}>
      <CancelSVG />
    </TouchableOpacity>
  )
}

const styles = createSafeStyleSheet({
  cancelBtnWrapper: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'white',
  },
})
