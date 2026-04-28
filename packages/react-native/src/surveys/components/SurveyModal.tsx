import React, { useCallback, useEffect, useState } from 'react'
import { Keyboard, KeyboardAvoidingView, Modal, Platform, StyleSheet, View } from 'react-native'

import { Cancel } from './Cancel'
import { ConfirmationMessage } from './ConfirmationMessage'
import { Questions } from './Surveys'

import { SurveyAppearanceTheme, resolveSurveyAlignment } from '../surveys-utils'
import { Survey } from '@posthog/core'
import { useOptionalSafeAreaInsets } from '../../optional/OptionalReactNativeSafeArea'

export type SurveyModalProps = {
  survey: Survey
  appearance: SurveyAppearanceTheme
  onShow: () => void
  onClose: (submitted: boolean, responses: Record<string, string | number | string[] | null>) => void
  androidKeyboardBehavior?: 'padding' | 'height'
}

export function SurveyModal(props: SurveyModalProps): JSX.Element | null {
  const { survey, appearance, onShow, androidKeyboardBehavior = 'height' } = props
  const [isSurveySent, setIsSurveySent] = useState(false)
  const [responses, setResponses] = useState<Record<string, string | number | string[] | null>>({})
  const onClose = useCallback(() => props.onClose(isSurveySent, responses), [isSurveySent, props, responses])
  const insets = useOptionalSafeAreaInsets()
  const { vertical, horizontal } = resolveSurveyAlignment(appearance.position)
  const isBottom = vertical === 'flex-end'

  const [isVisible] = useState(true)

  const shouldShowConfirmation = isSurveySent && appearance.thankYouMessageHeader

  useEffect(() => {
    if (isVisible) {
      onShow()
    }
  }, [isVisible, onShow])

  if (!isVisible) {
    return null
  }

  // KeyboardAvoidingView lifts content above the keyboard. That only matters
  // for bottom-anchored modals; for top/middle the content is already above
  // the keyboard, and `padding` would just shrink the visible area and jank
  // the centering animation. Skip the avoid behavior in those cases.
  const keyboardBehavior = isBottom ? (Platform.OS === 'ios' ? 'padding' : androidKeyboardBehavior) : undefined

  return (
    <Modal animationType="fade" transparent onRequestClose={onClose} statusBarTranslucent={true}>
      <KeyboardAvoidingView
        behavior={keyboardBehavior}
        style={styles.fill}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
      >
        <View style={[styles.fill, { justifyContent: vertical }]} onTouchStart={Keyboard.dismiss}>
          <View style={[styles.modalRow, { justifyContent: horizontal }]}>
            <View style={styles.modalContent} pointerEvents="box-none">
              <View
                style={[
                  styles.modalContentInner,
                  {
                    borderColor: appearance.borderColor,
                    backgroundColor: appearance.backgroundColor,
                    marginTop: vertical === 'flex-start' ? insets.top + 10 : 0,
                    marginBottom: isBottom ? insets.bottom + 10 : 0,
                    marginHorizontal: 10,
                  },
                ]}
              >
                {!shouldShowConfirmation ? (
                  <Questions
                    survey={survey}
                    appearance={appearance}
                    responses={responses}
                    onResponsesChange={setResponses}
                    onSubmit={() => setIsSurveySent(true)}
                  />
                ) : (
                  <ConfirmationMessage
                    appearance={appearance}
                    header={appearance.thankYouMessageHeader}
                    description={appearance.thankYouMessageDescription}
                    contentType={appearance.thankYouMessageDescriptionContentType}
                    onClose={onClose}
                    isModal={true}
                  />
                )}
                <View style={styles.topIconContainer}>
                  <Cancel onPress={onClose} appearance={appearance} />
                </View>
              </View>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  modalRow: {
    flexDirection: 'row',
  },
  modalContent: {
    width: '90%',
    maxWidth: 400,
  },
  modalContentInner: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 20,
  },
  topIconContainer: {
    position: 'absolute',
    right: -20,
    top: -20,
  },
})
