import { Image } from 'expo-image'
import { Platform, StyleSheet, Button, View } from 'react-native'

import { HelloWave } from '@/components/HelloWave'
import ParallaxScrollView from '@/components/ParallaxScrollView'
import { ThemedText } from '@/components/ThemedText'
import { ThemedView } from '@/components/ThemedView'
import { posthog } from '../posthog'
import { useState } from 'react'
import { SurveyModal } from 'posthog-react-native'

// Demo survey for local dogfooding. Real apps get Survey objects from
// PostHogSurveyProvider, so consumers don't usually construct these by hand.
const DEMO_SURVEY: any = {
    id: 'demo-survey',
    name: 'Demo survey',
    type: 'popover',
    questions: [
        {
            type: 'rating',
            question: 'How would you rate this example app?',
            id: 'q1',
            display: 'number',
            scale: 5,
            lowerBoundLabel: 'Bad',
            upperBoundLabel: 'Great',
            originalQuestionIndex: 0,
        },
        {
            type: 'single_choice',
            question: 'What would make it better?',
            id: 'q2',
            choices: ['More examples', 'Better docs', 'Nothing, it’s great'],
            originalQuestionIndex: 1,
        },
        {
            type: 'open',
            question: 'Anything else?',
            id: 'q3',
            optional: true,
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

export default function HomeScreen() {
    const [buttonText, setButtonText] = useState(
        `Tap the Explore tab to learn more about what's included in this starter app.`
    )
    const [replayStatus, setReplayStatus] = useState('Unknown')
    const [showSurvey, setShowSurvey] = useState(false)

    const handleClick = () => {
        posthog.capture('button_clicked', { name: 'example' })
        setButtonText('button_clicked' + new Date().toISOString())
    }

    const handleStartRecording = async (resumeCurrent: boolean) => {
        try {
            await posthog.startSessionRecording(resumeCurrent)
            setReplayStatus(`Started (resume=${resumeCurrent})`)
        } catch (e) {
            setReplayStatus(`Error: ${e}`)
        }
    }

    const handleStopRecording = async () => {
        try {
            await posthog.stopSessionRecording()
            setReplayStatus('Stopped')
        } catch (e) {
            setReplayStatus(`Error: ${e}`)
        }
    }

    const handleCheckStatus = async () => {
        try {
            const isActive = await posthog.isSessionReplayActive()
            setReplayStatus(`Active: ${isActive}`)
        } catch (e) {
            setReplayStatus(`Error: ${e}`)
        }
    }

    return (
        <ParallaxScrollView
            headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }}
            headerImage={<Image source={require('@/assets/images/partial-react-logo.png')} style={styles.reactLogo} />}
        >
            <ThemedView style={styles.titleContainer}>
                <ThemedText type="title">Welcome!</ThemedText>
                <HelloWave />
            </ThemedView>
            <ThemedView style={styles.stepContainer}>
                <ThemedText type="subtitle">Step 1: Try it</ThemedText>
                <ThemedText>
                    Edit <ThemedText type="defaultSemiBold">app/(tabs)/index.tsx</ThemedText> to see changes. Press{' '}
                    <ThemedText type="defaultSemiBold">
                        {Platform.select({
                            ios: 'cmd + d',
                            android: 'cmd + m',
                            web: 'F12',
                        })}
                    </ThemedText>{' '}
                    to open developer tools.
                </ThemedText>
            </ThemedView>
            <ThemedView style={styles.stepContainer}>
                <ThemedText type="subtitle">Step 2: Explore</ThemedText>
                <ThemedText onPress={handleClick}>{buttonText}</ThemedText>
            </ThemedView>
            <ThemedView style={styles.stepContainer}>
                <ThemedText type="subtitle">Step 3: Get a fresh start</ThemedText>
                <ThemedText>
                    {`When you're ready, run `}
                    <ThemedText type="defaultSemiBold">npm run reset-project</ThemedText> to get a fresh{' '}
                    <ThemedText type="defaultSemiBold">app</ThemedText> directory. This will move the current{' '}
                    <ThemedText type="defaultSemiBold">app</ThemedText> to{' '}
                    <ThemedText type="defaultSemiBold">app-example</ThemedText>.
                </ThemedText>
            </ThemedView>
            <ThemedView style={styles.stepContainer}>
                <ThemedText type="subtitle">Surveys</ThemedText>
                <Button title="Show survey" onPress={() => setShowSurvey(true)} />
            </ThemedView>
            {showSurvey && (
                <SurveyModal
                    survey={DEMO_SURVEY}
                    appearance={DEMO_APPEARANCE}
                    onShow={() => {}}
                    onClose={() => setShowSurvey(false)}
                />
            )}
            <ThemedView style={styles.stepContainer}>
                <ThemedText type="subtitle">Session Replay Controls</ThemedText>
                <ThemedText>Status: {replayStatus}</ThemedText>
                <View style={styles.buttonContainer}>
                    <Button title="Start (Resume)" onPress={() => handleStartRecording(true)} />
                    <Button title="Start (New)" onPress={() => handleStartRecording(false)} />
                    <Button title="Stop" onPress={handleStopRecording} />
                    <Button title="Check Status" onPress={handleCheckStatus} />
                </View>
            </ThemedView>
        </ParallaxScrollView>
    )
}

const styles = StyleSheet.create({
    titleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    stepContainer: {
        gap: 8,
        marginBottom: 8,
    },
    buttonContainer: {
        gap: 8,
        marginTop: 8,
    },
    reactLogo: {
        height: 178,
        width: 290,
        bottom: 0,
        left: 0,
        position: 'absolute',
    },
})
