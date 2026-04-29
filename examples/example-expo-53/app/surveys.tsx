import { Stack } from 'expo-router'
import { Button, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useState } from 'react'
import { SurveyModal } from 'posthog-react-native'

import { ThemedText } from '@/components/ThemedText'
import { ThemedView } from '@/components/ThemedView'

const POSITIONS: { label: string; value: string | undefined }[] = [
    { label: '(default)', value: undefined },
    { label: 'top_left', value: 'top_left' },
    { label: 'top_center', value: 'top_center' },
    { label: 'top_right', value: 'top_right' },
    { label: 'middle_left', value: 'middle_left' },
    { label: 'middle_center', value: 'middle_center' },
    { label: 'middle_right', value: 'middle_right' },
    { label: 'left', value: 'left' },
    { label: 'center', value: 'center' },
    { label: 'right', value: 'right' },
]

// Demo survey for local dogfooding. Real apps get Survey objects from
// PostHogSurveyProvider, so consumers don't usually construct these by hand.
const DEMO_SURVEY: any = {
    id: 'demo-survey',
    name: 'Demo survey',
    type: 'popover',
    questions: [
        {
            type: 'open',
            question:
                'We genuinely want to hear what you think — the longer and more honest, the better. ' +
                'What worked well, what got in the way, what surprised you, what would you change first if it were up to you? ' +
                'Anything you can share helps us prioritize. Take your time, no character limit.',
            description:
                'This question is intentionally verbose so the survey body is tall enough to push the text input down into the keyboard zone on smaller devices.',
            id: 'q1',
            optional: true,
            originalQuestionIndex: 0,
        },
        {
            type: 'rating',
            question: 'How would you rate this example app?',
            id: 'q2',
            display: 'number',
            scale: 5,
            lowerBoundLabel: 'Bad',
            upperBoundLabel: 'Great',
            originalQuestionIndex: 1,
        },
        {
            type: 'single_choice',
            question: 'What would make it better?',
            id: 'q3',
            choices: ['More examples', 'Better docs', 'Nothing, it’s great'],
            originalQuestionIndex: 2,
        },
    ],
}

const DEMO_APPEARANCE: any = {
    backgroundColor: '#eeeded',
    submitButtonColor: 'black',
    submitButtonTextColor: 'white',
    ratingButtonColor: 'white',
    ratingButtonActiveColor: 'black',
    inputBackground: 'white',
    borderColor: '#c9c6c6',
    placeholder: 'Start typing...',
    displayThankYouMessage: true,
    thankYouMessageHeader: 'Thank you!',
    thankYouMessageDescription: 'Your feedback helps us improve.',
    thankYouMessageDescriptionContentType: 'text',
    thankYouMessageCloseButtonText: 'Close',
    submitButtonText: 'Submit',
    autoDisappear: false,
    surveyPopupDelaySeconds: 0,
}

export default function SurveysScreen() {
    const [showSurvey, setShowSurvey] = useState(false)
    const [positionIdx, setPositionIdx] = useState(0)
    const currentPosition = POSITIONS[positionIdx]
    const surveyAppearance = {
        ...DEMO_APPEARANCE,
        ...(currentPosition.value ? { position: currentPosition.value } : {}),
    }

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
            <Stack.Screen options={{ title: 'Surveys' }} />
            <ScrollView contentContainerStyle={styles.container}>
                <ThemedView style={styles.section}>
                    <ThemedText type="title">Surveys</ThemedText>
                    <ThemedText>
                        Cycle through every <ThemedText type="defaultSemiBold">SurveyPosition</ThemedText> value and
                        verify the modal lands in the expected quadrant. Use the open-text question to test keyboard
                        interaction.
                    </ThemedText>
                </ThemedView>

                <ThemedView style={styles.section}>
                    <ThemedText type="subtitle">Position</ThemedText>
                    <ThemedText>
                        Active: <ThemedText type="defaultSemiBold">{currentPosition.label}</ThemedText>
                    </ThemedText>
                    <View style={styles.row}>
                        <Button
                            title="◀ prev"
                            onPress={() => setPositionIdx((i) => (i - 1 + POSITIONS.length) % POSITIONS.length)}
                        />
                        <Button title="next ▶" onPress={() => setPositionIdx((i) => (i + 1) % POSITIONS.length)} />
                    </View>
                </ThemedView>

                <ThemedView style={styles.section}>
                    <Button title="Show survey" onPress={() => setShowSurvey(true)} />
                </ThemedView>
            </ScrollView>

            {showSurvey && (
                <SurveyModal
                    survey={DEMO_SURVEY}
                    appearance={surveyAppearance}
                    onShow={() => {}}
                    onClose={() => setShowSurvey(false)}
                />
            )}
        </SafeAreaView>
    )
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
    },
    container: {
        padding: 16,
        gap: 16,
    },
    section: {
        gap: 8,
    },
    row: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 8,
    },
})
