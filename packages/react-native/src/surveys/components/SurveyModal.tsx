import React, { useCallback, useEffect, useState } from 'react'
import { Keyboard, KeyboardAvoidingView, Modal, Platform, StyleSheet, View, useWindowDimensions } from 'react-native'

import { Cancel } from './Cancel'
import { ConfirmationMessage } from './ConfirmationMessage'
import { SurveyAppearanceTheme, resolveSurveyAlignment } from '../surveys-utils'
import { Survey, type SurveyResponses } from '@posthog/core'
import { useOptionalSafeAreaInsets } from '../../optional/OptionalReactNativeSafeArea'
import { Questions } from './Surveys'

export type SurveyModalProps = {
  survey: Survey
  surveyLanguage: string | null
  appearance: SurveyAppearanceTheme
  onShow: () => void
  onClose: (submitted: boolean, responses: SurveyResponses) => void
  androidKeyboardBehavior?: 'padding' | 'height'
}

// No extra buffer — let the modal extend right up to the safe-area / keyboard
// edges. Insets already keep it clear of the status bar and home indicator.
const VIEWPORT_BUFFER = 0

export function SurveyModal(props: SurveyModalProps): JSX.Element | null {
  const { survey, surveyLanguage, appearance, onShow, androidKeyboardBehavior = 'height' } = props
  const [isSurveySent, setIsSurveySent] = useState(false)
  const [responses, setResponses] = useState<SurveyResponses>({})
  const onClose = useCallback(() => props.onClose(isSurveySent, responses), [isSurveySent, props, responses])
  const insets = useOptionalSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const { vertical, horizontal } = resolveSurveyAlignment(appearance.position)
  const isBottom = vertical === 'flex-end'

  const [isVisible] = useState(true)

  const shouldShowConfirmation = isSurveySent && appearance.thankYouMessageHeader

  useEffect(() => {
    if (isVisible) {
      onShow()
    }
  }, [isVisible, onShow])

  // Track keyboard height so we can cap the modal to the visible viewport.
  // KAV alone lifts the modal but doesn't shrink it — a tall modal would
  // still bleed past the screen top.
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates.height))
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0))
    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [])

  if (!isVisible) {
    return null
  }

  const maxModalHeight = Math.max(windowHeight - keyboardHeight - insets.top - insets.bottom - VIEWPORT_BUFFER, 200)

  const keyboardBehavior = Platform.OS === 'ios' ? 'padding' : androidKeyboardBehavior

  return (
    <Modal animationType="fade" transparent onRequestClose={onClose} statusBarTranslucent={true}>
      <KeyboardAvoidingView behavior={keyboardBehavior} style={styles.fill}>
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
                    // When keyboard is up, sit flush against it (no extra gap).
                    // When keyboard is down, leave room for the home indicator.
                    marginBottom: isBottom ? (keyboardHeight > 0 ? 0 : insets.bottom + 10) : 0,
                    marginHorizontal: 10,
                    maxHeight: maxModalHeight,
                  },
                ]}
              >
                <View style={styles.topIconContainer}>
                  <Cancel onPress={onClose} appearance={appearance} />
                </View>
                {!shouldShowConfirmation ? (
                  <Questions
                    survey={survey}
                    surveyLanguage={surveyLanguage}
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
    // Keep the close button inside the modal so it can never bleed off-screen
    // when the modal lifts above the keyboard.
    position: 'absolute',
    right: 8,
    top: 8,
    zIndex: 1,
  },
})
