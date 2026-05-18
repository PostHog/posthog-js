/** @jest-environment jsdom */
import React from 'react'
import { act, fireEvent, render, cleanup } from '@testing-library/react'
import { Survey, SurveyQuestionType, SurveyType } from '@posthog/core'

// Minimal react-native shim — jest-expo's full preset chain pulls in
// TurboModule code that explodes under jsdom. We only need a handful of
// primitives here, all rendering as plain divs so children appear in the DOM.
jest.mock('react-native', () => {
  const RealReact = jest.requireActual('react')
  const Box = RealReact.forwardRef(
    ({ children, testID, onTouchStart, onStartShouldSetResponder, ...rest }: any, ref: any) => {
      // onStartShouldSetResponder() === true mirrors RN's responder system claiming
      // the touch; we approximate that in jsdom by stopping click propagation so
      // an inner View shields ancestors (e.g. a Pressable backdrop) from the event.
      const onClick = onStartShouldSetResponder ? (e: any) => e.stopPropagation() : undefined
      return RealReact.createElement(
        'div',
        { ref, 'data-testid': testID, onMouseDown: onTouchStart, onClick, ...rest },
        children
      )
    }
  )
  // Flatten RN-style arrays into a single inline-style object so jsdom can
  // expose them via element.style (e.g. for backgroundColor assertions).
  const flatten = (s: any): any =>
    Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean).map(flatten)) : (s ?? undefined)
  const Pressable = RealReact.forwardRef(({ children, testID, onPress, style, ...rest }: any, ref: any) =>
    RealReact.createElement(
      'div',
      { ref, 'data-testid': testID, onClick: onPress, style: flatten(style), ...rest },
      children
    )
  )
  return {
    View: Box,
    Modal: Box,
    KeyboardAvoidingView: Box,
    Pressable,
    TouchableOpacity: Pressable,
    Text: Box,
    Keyboard: { dismiss: jest.fn(), addListener: () => ({ remove: jest.fn() }) },
    // Use Android so the timer-based close-notification path runs (iOS would
    // rely on Modal.onDismiss, which the mocked Modal cannot fire).
    Platform: { OS: 'android', select: (o: any) => o.android ?? o.default },
    StyleSheet: {
      create: (s: any) => s,
      flatten: (s: any) => s,
      absoluteFill: {},
    },
    useWindowDimensions: () => ({ width: 375, height: 800 }),
  }
})

// Stub Questions / ConfirmationMessage / Cancel so we can assert exactly
// which path SurveyModal is rendering, and trigger the submit/close callbacks.
jest.mock('../src/surveys/components/Surveys', () => {
  const RealReact = jest.requireActual('react')
  return {
    Questions: ({ onSubmit }: { onSubmit: () => void }) =>
      RealReact.createElement('div', { 'data-testid': 'questions-stub', onClick: onSubmit }, 'QUESTIONS_RENDERED'),
    sendSurveyShownEvent: jest.fn(),
    dismissedSurveyEvent: jest.fn(),
    sendSurveyEvent: jest.fn(),
  }
})

jest.mock('../src/surveys/components/ConfirmationMessage', () => {
  const RealReact = jest.requireActual('react')
  return {
    ConfirmationMessage: ({ header }: { header: string }) =>
      RealReact.createElement('div', { 'data-testid': 'confirmation-stub' }, header),
  }
})

jest.mock('../src/surveys/components/Cancel', () => {
  const RealReact = jest.requireActual('react')
  return {
    Cancel: ({ onPress }: { onPress: () => void }) =>
      RealReact.createElement('div', { 'data-testid': 'cancel-stub', onClick: onPress }, 'X'),
  }
})

import { SurveyModal } from '../src/surveys/components/SurveyModal'
import { defaultSurveyAppearance, SurveyAppearanceTheme } from '../src/surveys/surveys-utils'

const baseSurvey: Survey = {
  id: 'test-survey',
  name: 'Test Survey',
  type: SurveyType.Popover,
  questions: [
    {
      id: 'q1',
      type: SurveyQuestionType.Open,
      question: 'What do you think?',
      originalQuestionIndex: 0,
    },
  ],
}

const appearanceWithThankYou: SurveyAppearanceTheme = {
  ...defaultSurveyAppearance,
  thankYouMessageHeader: 'Thanks!',
}

const appearanceWithoutThankYou: SurveyAppearanceTheme = {
  ...defaultSurveyAppearance,
  thankYouMessageHeader: '',
}

const appearanceWithBackdropClose: SurveyAppearanceTheme = {
  ...defaultSurveyAppearance,
  thankYouMessageHeader: 'Thanks!',
  closeOnBackdropPress: true,
}

// Mount SurveyModal with the standard test fixture. Returns the rendered
// result plus the onClose spy so tests can assert against either.
const renderSurveyModal = (onClose: jest.Mock = jest.fn()) => {
  const result = render(
    <SurveyModal
      survey={baseSurvey}
      surveyLanguage={null}
      appearance={appearanceWithThankYou}
      onShow={() => {}}
      onClose={onClose}
    />
  )
  return { ...result, onClose }
}

const clickCancel = (getByTestId: (id: string) => HTMLElement) => {
  act(() => {
    fireEvent.click(getByTestId('cancel-stub'))
  })
}

describe('SurveyModal close behavior', () => {
  afterEach(() => {
    cleanup()
  })

  it('does not flash Questions when appearance loses thankYouMessageHeader after submit', () => {
    const onClose = jest.fn()
    const { queryByTestId, getByTestId, rerender } = render(
      <SurveyModal
        survey={baseSurvey}
        surveyLanguage={null}
        appearance={appearanceWithThankYou}
        onShow={() => {}}
        onClose={onClose}
      />
    )

    // Sanity: Questions is rendered initially.
    expect(queryByTestId('questions-stub')).not.toBeNull()

    // Drive isSurveySent=true via the stubbed Questions submit.
    act(() => {
      fireEvent.click(getByTestId('questions-stub'))
    })

    // Confirmation now showing.
    expect(queryByTestId('confirmation-stub')).not.toBeNull()
    expect(queryByTestId('questions-stub')).toBeNull()

    // Parent provider clears activeSurvey on close — surveyAppearance recomputes
    // to defaults without thankYouMessageHeader. Simulate that rerender.
    rerender(
      <SurveyModal
        survey={baseSurvey}
        surveyLanguage={null}
        appearance={appearanceWithoutThankYou}
        onShow={() => {}}
        onClose={onClose}
      />
    )

    // BUG: shouldShowConfirmation flips false, so Questions remounts with Q1.
    // After the fix the conditional branches on isSurveySent first → null.
    expect(queryByTestId('questions-stub')).toBeNull()
  })

  it('closes when the backdrop is tapped if closeOnBackdropPress is true', () => {
    const onClose = jest.fn()
    const { getByTestId } = render(
      <SurveyModal
        survey={baseSurvey}
        surveyLanguage={null}
        appearance={appearanceWithBackdropClose}
        onShow={() => {}}
        onClose={onClose}
      />
    )

    act(() => {
      fireEvent.click(getByTestId('survey-modal-backdrop'))
    })
    act(() => {
      jest.runAllTimers()
    })

    expect(onClose).toHaveBeenCalledWith(false, {})
  })

  it('does NOT close on backdrop tap by default (closeOnBackdropPress omitted)', () => {
    const { getByTestId, onClose } = renderSurveyModal()

    act(() => {
      fireEvent.click(getByTestId('survey-modal-backdrop'))
    })
    act(() => {
      jest.runAllTimers()
    })

    // Default behavior: backdrop tap only dismisses the keyboard, not the survey.
    // Prevents accidental dismissals that lose unsent responses.
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close when a tap lands inside the modal content', () => {
    const { getByTestId, onClose } = renderSurveyModal()

    // A tap on Questions itself fires onSubmit (drives isSurveySent),
    // but it must NOT bubble up and trigger the backdrop close.
    act(() => {
      fireEvent.click(getByTestId('questions-stub'))
    })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('renders a dark semi-transparent backdrop behind the modal', () => {
    const { getByTestId } = renderSurveyModal()

    const backdrop = getByTestId('survey-modal-backdrop')
    // jsdom serializes any rgba/rgb value into a string on .style.backgroundColor.
    expect(backdrop.style.backgroundColor).toMatch(/rgba?\(/)
  })

  it('hides content immediately when the cancel button is pressed', () => {
    const { queryByTestId, getByTestId, onClose } = renderSurveyModal()
    expect(queryByTestId('questions-stub')).not.toBeNull()

    clickCancel(getByTestId)

    // Content unmounts on the very next render — blank Modal before fade.
    expect(queryByTestId('questions-stub')).toBeNull()
    // Parent notification is deferred until the fade completes.
    expect(onClose).not.toHaveBeenCalled()

    act(() => {
      jest.runAllTimers()
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('defers parent unmount until the fade completes', () => {
    // The two-step hide unmounts children immediately but delays the parent's
    // onClose until the fade duration elapses (Android timer / iOS onDismiss),
    // so the Modal animates out cleanly with blank children before the parent
    // tears it down.
    const Wrapper = () => {
      const [show, setShow] = React.useState(true)
      if (!show) return <div data-testid="parent-unmounted" />
      return (
        <SurveyModal
          survey={baseSurvey}
          surveyLanguage={null}
          appearance={appearanceWithThankYou}
          onShow={() => {}}
          onClose={() => setShow(false)}
        />
      )
    }
    const { queryByTestId, getByTestId } = render(<Wrapper />)

    clickCancel(getByTestId)

    // Two-step hide: content gone, but parent still rendering SurveyModal
    // because onClose is deferred until the fade completes.
    expect(queryByTestId('questions-stub')).toBeNull()
    expect(queryByTestId('parent-unmounted')).toBeNull()

    act(() => {
      jest.runAllTimers()
    })

    // After the fade duration, the parent's onClose fires and it unmounts.
    expect(queryByTestId('parent-unmounted')).not.toBeNull()
  })

  it('notifies the parent only once even if close is pressed multiple times', () => {
    const { getByTestId, onClose } = renderSurveyModal()

    act(() => {
      fireEvent.click(getByTestId('cancel-stub'))
      fireEvent.click(getByTestId('cancel-stub'))
      fireEvent.click(getByTestId('cancel-stub'))
    })
    act(() => {
      jest.runAllTimers()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
