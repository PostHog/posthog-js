import { useState } from 'react'
import { Button, StyleSheet, Text, TextInput, View } from 'react-native'

import ParallaxScrollView from '@/components/ParallaxScrollView'
import { ThemedText } from '@/components/ThemedText'
import { ThemedView } from '@/components/ThemedView'
import { IconSymbol } from '@/components/ui/IconSymbol'
import { PostHogMaskView } from 'posthog-react-native'
import { posthog } from '../posthog'

/**
 * Test screen for Android Session Replay text input masking.
 *
 * Environment:
 *   - posthog-react-native: 4.37.6
 *   - posthog-react-native-session-replay: 1.5.1 (posthog-android: 3.34.3)
 *   - react-native: 0.81.5
 *   - expo: ~54.0.27
 *   - newArchEnabled: true
 *
 * Tests:
 *   - maskAllTextInputs=true should redact text inputs in replay
 *   - PostHogMaskView wrapper should redact its children
 *   - accessibilityLabel="ph-no-capture" should redact the view
 */
export default function SessionReplayMaskingScreen() {
    const [replayStatus, setReplayStatus] = useState('Unknown')

    const [plainText, setPlainText] = useState('')
    const [maskedViewText, setMaskedViewText] = useState('')
    const [directNoCaptureText, setDirectNoCaptureText] = useState('')
    const [multilineText, setMultilineText] = useState('')

    const checkReplayStatus = async () => {
        try {
            const isActive = await posthog.isSessionReplayActive()
            setReplayStatus(`Active: ${isActive}`)
        } catch (e) {
            setReplayStatus(`Error: ${e}`)
        }
    }

    return (
        <ParallaxScrollView
            headerBackgroundColor={{ light: '#FFD6D6', dark: '#4A1C1C' }}
            headerImage={
                <IconSymbol size={310} color="#FF6B6B" name="eye.slash.fill" style={styles.headerImage} />
            }
        >
            <ThemedView style={styles.titleContainer}>
                <ThemedText type="title">Replay Masking</ThemedText>
            </ThemedView>

            <ThemedText>
                Reproduction for Android Session Replay not redacting TextInput values.
                Config: maskAllTextInputs=false, relying on explicit ph-no-capture.
            </ThemedText>

            {/* Replay status check */}
            <ThemedView style={styles.sectionContainer}>
                <ThemedText type="subtitle">Session Replay Status</ThemedText>
                <Text style={styles.statusText}>Status: {replayStatus}</Text>
                <Button title="Check Replay Status" onPress={checkReplayStatus} />
            </ThemedView>

            {/* Section 1: Control — no masking, should appear in replay */}
            <ThemedView style={styles.sectionContainer}>
                <ThemedText type="subtitle">1. Control (no masking)</ThemedText>
                <ThemedText>
                    This input has NO masking applied. It SHOULD be visible in replay.
                </ThemedText>

                <View style={styles.inputGroup}>
                    <Text style={styles.label}>Unmasked plain text:</Text>
                    <TextInput
                        style={styles.input}
                        value={plainText}
                        onChangeText={setPlainText}
                        placeholder="This text should be visible in replay"
                        placeholderTextColor="#999"
                    />
                </View>
            </ThemedView>

            {/* Section 2: PostHogMaskView wrapping inputs */}
            <ThemedView style={styles.sectionContainer}>
                <ThemedText type="subtitle">2. PostHogMaskView wrapper</ThemedText>
                <ThemedText>
                    Input wrapped in PostHogMaskView (accessibilityLabel=&quot;ph-no-capture&quot;).
                    Should be REDACTED in replay.
                </ThemedText>

                <PostHogMaskView>
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Inside PostHogMaskView:</Text>
                        <TextInput
                            style={[styles.input, styles.maskedInput]}
                            value={maskedViewText}
                            onChangeText={setMaskedViewText}
                            placeholder="Should be redacted in replay"
                            placeholderTextColor="#999"
                        />
                    </View>
                </PostHogMaskView>
            </ThemedView>

            {/* Section 3: Direct ph-no-capture accessibilityLabel */}
            <ThemedView style={styles.sectionContainer}>
                <ThemedText type="subtitle">3. Direct ph-no-capture prop</ThemedText>
                <ThemedText>
                    Input has accessibilityLabel=&quot;ph-no-capture&quot; directly.
                    Should be REDACTED in replay.
                </ThemedText>

                <View style={styles.inputGroup}>
                    <Text style={styles.label}>Direct ph-no-capture:</Text>
                    <TextInput
                        style={[styles.input, styles.maskedInput]}
                        value={directNoCaptureText}
                        onChangeText={setDirectNoCaptureText}
                        placeholder="Should be redacted in replay"
                        placeholderTextColor="#999"
                        accessibilityLabel="ph-no-capture"
                    />
                </View>
            </ThemedView>

            {/* Section 4: Multiline inside PostHogMaskView */}
            <ThemedView style={styles.sectionContainer}>
                <ThemedText type="subtitle">4. Multiline in PostHogMaskView</ThemedText>
                <ThemedText>
                    Multi-line text inside PostHogMaskView. Should be REDACTED.
                </ThemedText>

                <PostHogMaskView>
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Multiline masked:</Text>
                        <TextInput
                            style={[styles.input, styles.multilineInput, styles.maskedInput]}
                            value={multilineText}
                            onChangeText={setMultilineText}
                            placeholder="Should be redacted in replay"
                            placeholderTextColor="#999"
                            multiline={true}
                            numberOfLines={4}
                        />
                    </View>
                </PostHogMaskView>
            </ThemedView>

            {/* Section 5: Realistic form */}
            <ThemedView style={styles.sectionContainer}>
                <ThemedText type="subtitle">5. Realistic Login Form</ThemedText>
                <ThemedText>
                    Sensitive fields use PostHogMaskView or direct ph-no-capture.
                </ThemedText>

                <View style={styles.formContainer}>
                    <Text style={styles.formTitle}>Sign In</Text>

                    <Text style={styles.label}>Username (unmasked)</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="Enter username"
                        placeholderTextColor="#999"
                        autoCapitalize="none"
                    />

                    <Text style={styles.label}>Password (ph-no-capture)</Text>
                    <TextInput
                        style={[styles.input, styles.maskedInput]}
                        placeholder="Should be redacted"
                        placeholderTextColor="#999"
                        secureTextEntry={true}
                        accessibilityLabel="ph-no-capture"
                    />

                    <Text style={styles.label}>Credit Card (PostHogMaskView)</Text>
                    <PostHogMaskView>
                        <TextInput
                            style={[styles.input, styles.maskedInput]}
                            placeholder="Should be redacted"
                            placeholderTextColor="#999"
                            keyboardType="numeric"
                        />
                    </PostHogMaskView>

                    <Text style={styles.label}>SSN (ph-no-capture)</Text>
                    <TextInput
                        style={[styles.input, styles.maskedInput]}
                        placeholder="Should be redacted"
                        placeholderTextColor="#999"
                        keyboardType="numeric"
                        accessibilityLabel="ph-no-capture"
                    />

                    <Button title="Submit (captures event)" onPress={() => {
                        posthog.capture('login_form_submitted', {
                            screen: 'session-replay-masking',
                        })
                    }} />
                </View>
            </ThemedView>

            {/* Debug info */}
            <ThemedView style={styles.sectionContainer}>
                <ThemedText type="subtitle">Debug Info</ThemedText>
                <Text style={styles.debugText}>
                    {`posthog-react-native: 4.37.6\n`}
                    {`posthog-react-native-session-replay: 1.5.1\n`}
                    {`posthog-android (transitive): 3.34.3\n`}
                    {`react-native: 0.81.5\n`}
                    {`expo: ~54.0.27\n`}
                    {`newArchEnabled: true\n`}
                    {`maskAllTextInputs: false (masks all text if true)\n`}
                    {`maskAllImages: false\n`}
                    {`\nTest: ph-no-capture inputs should be redacted,\n`}
                    {`unmasked input should be visible in replay.`}
                </Text>
            </ThemedView>
        </ParallaxScrollView>
    )
}

const styles = StyleSheet.create({
    headerImage: {
        color: '#FF6B6B',
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
    statusText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#333',
        padding: 8,
        backgroundColor: '#f0f0f0',
        borderRadius: 4,
    },
    inputGroup: {
        gap: 4,
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
        color: '#555',
    },
    input: {
        borderWidth: 1,
        borderColor: '#ccc',
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
        backgroundColor: '#fff',
        color: '#000',
    },
    maskedInput: {
        borderColor: '#e74c3c',
        borderWidth: 2,
    },
    multilineInput: {
        minHeight: 100,
        textAlignVertical: 'top',
    },
    formContainer: {
        gap: 8,
        padding: 16,
        backgroundColor: '#f9f9f9',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e0e0e0',
    },
    formTitle: {
        fontSize: 20,
        fontWeight: '700',
        textAlign: 'center',
        marginBottom: 8,
        color: '#333',
    },
    debugText: {
        fontSize: 12,
        fontFamily: 'SpaceMono',
        color: '#666',
        padding: 8,
        backgroundColor: '#f5f5f5',
        borderRadius: 4,
    },
})
