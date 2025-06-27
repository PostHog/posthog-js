import React, { useCallback, useEffect, useState } from 'react'
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TouchableWithoutFeedback,
  View,
} from 'react-native'

import { Cancel } from './Cancel'
import { ConfirmationMessage } from './ConfirmationMessage'
import { Questions } from './Surveys'

import { SurveyAppearanceTheme } from '../surveys-utils'
import { Survey, SurveyQuestionDescriptionContentType } from '../../../../posthog-core/src'
import { useOptionalSafeAreaInsets } from '../../optional/OptionalReactNativeSafeArea'

export type SurveyModalProps = {
  survey: Survey
  appearance: SurveyAppearanceTheme
  onShow: () => void
  onClose: (submitted: boolean) => void
}

export function SurveyModal(props: SurveyModalProps): JSX.Element | null {
  const { survey, appearance, onShow } = props
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
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, justifyContent: 'flex-end' }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.modalBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} />
            <View
              style={[
                styles.modalContent,
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
                  contentType={
                    appearance.thankYouMessageDescriptionContentType ?? SurveyQuestionDescriptionContentType.Text
                  }
                  onClose={onClose}
                  isModal={true}
                />
              )}
              <View style={styles.topIconContainer}>
                <Cancel onPress={onClose} appearance={appearance} />
              </View>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 20,
    width: '90%',
    maxWidth: 400,
    marginHorizontal: 20,
  },
  topIconContainer: {
    position: 'absolute',
    right: -20,
    top: -20,
  },
})
