import React, { useCallback, useEffect, useState } from 'react'
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native'

import { Cancel } from './Cancel'
import { ConfirmationMessage } from './ConfirmationMessage'
import { Questions } from './Surveys'

import { SurveyAppearanceTheme } from '../surveys-utils'
import { Survey, SurveyQuestionDescriptionContentType } from '@posthog/core'
import { useOptionalSafeAreaInsets } from '../../optional/OptionalReactNativeSafeArea'

export type SurveyModalProps = {
  survey: Survey
  appearance: SurveyAppearanceTheme
  onShow: () => void
  onClose: (submitted: boolean) => void
  androidKeyboardBehavior?: 'padding' | 'height'
}

export function SurveyModal(props: SurveyModalProps): JSX.Element | null {
  const { survey, appearance, onShow, androidKeyboardBehavior = 'height' } = props
  const [isSurveySent, setIsSurveySent] = useState(false)
  const onClose = useCallback(() => props.onClose(isSurveySent), [isSurveySent, props])
  const insets = useOptionalSafeAreaInsets()

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

  return (
    <Modal animationType="fade" transparent onRequestClose={onClose} statusBarTranslucent={true}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : androidKeyboardBehavior}
        style={{ flex: 1, justifyContent: 'flex-end' }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
      >
        <View style={styles.modalBackdrop} onTouchStart={Keyboard.dismiss}>
          <View style={styles.modalRow}>
            <View style={styles.modalContent} pointerEvents="box-none">
              <View
                style={[
                  styles.modalContentInner,
                  {
                    borderColor: appearance.borderColor,
                    backgroundColor: appearance.backgroundColor,
                    marginBottom: insets.bottom + 10,
                    marginHorizontal: 10,
                  },
                ]}
              >
                {!shouldShowConfirmation ? (
                  <Questions survey={survey} appearance={appearance} onSubmit={() => setIsSurveySent(true)} />
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
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
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
