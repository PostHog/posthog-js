import { useState } from 'react'
import { Button, StyleSheet, Text, View } from 'react-native'

import ParallaxScrollView from '@/components/ParallaxScrollView'
import { ThemedText } from '@/components/ThemedText'
import { ThemedView } from '@/components/ThemedView'
import { IconSymbol } from '@/components/ui/IconSymbol'
import { crashNative } from '@/modules/native-crash'
import { usePostHog, PostHogErrorBoundary } from 'posthog-react-native'

function BuggyComponent({ shouldThrow }: { shouldThrow: boolean }) {
    if (shouldThrow) {
        throw new Error('Component crashed during render!')
    }
    return (
        <View style={styles.buggyComponent}>
            <Text style={styles.buggyComponentText}>This component is working fine.</Text>
        </View>
    )
}

function ErrorFallback({ error, componentStack }: { error: unknown; componentStack: string }) {
    return (
        <View style={styles.errorFallback}>
            <Text style={styles.errorFallbackTitle}>Caught by PostHogErrorBoundary</Text>
            <Text style={styles.errorFallbackMessage}>{error instanceof Error ? error.message : String(error)}</Text>
        </View>
    )
}

// Breadcrumb-style steps to record before capturing an exception. Properties ride along under their own keys.
const EXCEPTION_STEPS: { label: string; message: string; properties?: Record<string, string | number> }[] = [
    { label: 'Goku powers up', message: 'Goku powers up' },
    { label: 'Kamehameha {ki, form}', message: 'Goku fired a Kamehameha', properties: { ki: 9001, form: 'Super Saiyan' } },
    { label: 'Dragon Ball found {star}', message: 'Collected a Dragon Ball', properties: { star: 4, location: 'Kame House' } },
    { label: 'Summon Shenron {wish}', message: 'Summoned Shenron', properties: { wish: 'immortality', status: 'granted' } },
]

export default function ErrorTrackingScreen() {
    const posthog = usePostHog()
    const [shouldThrow, setShouldThrow] = useState(false)
    const [stepsRecorded, setStepsRecorded] = useState(0)
    const [lastStepAction, setLastStepAction] = useState('')

    return (
        <ParallaxScrollView
            headerBackgroundColor={{ light: '#D0D0D0', dark: '#353636' }}
            headerImage={
                <IconSymbol size={310} color="#808080" name="exclamationmark.warninglight" style={styles.headerImage} />
            }
        >
            <ThemedView style={styles.titleContainer}>
                <ThemedText type="title">Error Tracking</ThemedText>
            </ThemedView>
            <ThemedText>Examples on how to use error tracking in your app.</ThemedText>

            <ThemedView style={styles.sectionContainer}>
                <ThemedText type="subtitle">Error Boundary</ThemedText>
                <ThemedText>
                    Wrap components with PostHogErrorBoundary to automatically capture render errors.
                </ThemedText>
                <PostHogErrorBoundary
                    fallback={ErrorFallback}
                    additionalProperties={{ attachedFromPostHogErrorBoundary: true }}
                >
                    <BuggyComponent shouldThrow={shouldThrow} />
                </PostHogErrorBoundary>
                <Button onPress={() => setShouldThrow(true)} title="Trigger render crash" />
            </ThemedView>

            <ThemedView style={styles.sectionContainer}>
                <ThemedText type="subtitle">Manual Capture</ThemedText>
                <Button
                    onPress={() => {
                        try {
                            throw new Error('User clicked Capture Error')
                        } catch (error) {
                            posthog.captureException(error)
                        }
                    }}
                    title="Capture error manually"
                />
                <Button
                    onPress={() => {
                        throw new Error('User throws an Error')
                    }}
                    title="Capture error automatically"
                />
                <Button
                    onPress={() => {
                        Promise.reject(new Error('User rejects a Promise'))
                    }}
                    title="Capture promise rejection"
                />
                <Button
                    onPress={() => {
                        console.error('User logs an error', new Error('Error inside console log'))
                    }}
                    title="Capture console error"
                />
                <Button
                    onPress={() => {
                        console.warn('Console warning')
                    }}
                    title="Capture console warn"
                />
            </ThemedView>

            <ThemedView style={styles.sectionContainer}>
                <ThemedText type="subtitle">Exception Steps</ThemedText>
                <ThemedText>
                    Record breadcrumb-style steps with addExceptionStep. Buffered steps attach to every captured
                    $exception as $exception_steps — including the manual captures above and the native crash below.
                </ThemedText>
                {EXCEPTION_STEPS.map(({ label, message, properties }) => (
                    <Button
                        key={label}
                        title={`Record: ${label}`}
                        onPress={() => {
                            posthog.addExceptionStep(message, properties)
                            setStepsRecorded((count) => count + 1)
                            setLastStepAction(`Recorded: ${label}`)
                        }}
                    />
                ))}
                <Button
                    title="Capture exception (attaches steps)"
                    onPress={() => {
                        posthog.captureException(new Error("It's over 9000! Vegeta's scouter exploded"))
                        setLastStepAction('captureException() — steps attached')
                    }}
                />
                <ThemedText>Steps recorded this session: {stepsRecorded}</ThemedText>
                {lastStepAction ? <ThemedText>Last action: {lastStepAction}</ThemedText> : null}
            </ThemedView>

            <ThemedView style={styles.sectionContainer}>
                <ThemedText type="subtitle">Native Crash</ThemedText>
                <ThemedText>
                    Triggers a real native iOS/Android crash via a local Expo module. The app will terminate; PostHog
                    reports the crash on the next launch. Requires `@posthog/react-native-plugin`,
                    `errorTracking.autocapture.nativeCrashes`, and (for readable stack traces) a release build with
                    uploaded symbols.
                </ThemedText>
                <Button color="#c62828" onPress={() => crashNative()} title="Trigger native crash (iOS/Android)" />
            </ThemedView>
        </ParallaxScrollView>
    )
}

const styles = StyleSheet.create({
    headerImage: {
        color: '#808080',
        bottom: -90,
        left: -35,
        position: 'absolute',
    },
    titleContainer: {
        flexDirection: 'row',
        gap: 8,
    },
    sectionContainer: {
        gap: 8,
        marginTop: 16,
    },
    buggyComponent: {
        padding: 16,
        backgroundColor: '#e8f5e9',
        borderRadius: 8,
    },
    buggyComponentText: {
        color: '#2e7d32',
        fontWeight: '600',
    },
    errorFallback: {
        padding: 16,
        backgroundColor: '#ffebee',
        borderRadius: 8,
        gap: 4,
    },
    errorFallbackTitle: {
        color: '#c62828',
        fontWeight: '700',
        fontSize: 14,
    },
    errorFallbackMessage: {
        color: '#b71c1c',
        fontSize: 13,
    },
})
