import { Image } from 'expo-image'
import { Pressable, StyleSheet, View } from 'react-native'
import { usePostHog } from 'posthog-react-native'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'

import { useEffect } from 'react'

export default function HomeScreen() {
    const posthog = usePostHog()

    const handleTestEvent = () => {
        posthog.capture('clicked test event on rn-expo home')
    }

    useEffect(() => {
        posthog.getSurveys().then((s) => {
            console.log('All surveys:', JSON.stringify(s, null, 2))
        })
    }, [posthog])

    return (
        <ThemedView style={styles.container}>
            <View style={styles.content}>
                <Image
                    source={{ uri: 'https://posthog.com/brand/posthog-logo.svg' }}
                    style={styles.logo}
                    contentFit="contain"
                />
                <ThemedText style={styles.title}>RN (Expo) Playground</ThemedText>
                <ThemedText style={styles.subtitle}>
                    This is a demo app to test and explore PostHog's react-native SDK.
                </ThemedText>
                <Pressable style={styles.button} onPress={handleTestEvent}>
                    <ThemedText style={styles.buttonText}>Emit Test Event</ThemedText>
                </Pressable>
            </View>
        </ThemedView>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    logo: {
        width: 200,
        height: 50,
        marginBottom: 16,
    },
    title: {
        fontSize: 24,
        fontWeight: '600',
        marginBottom: 16,
    },
    subtitle: {
        fontSize: 16,
        opacity: 0.6,
        textAlign: 'center',
        marginBottom: 32,
    },
    button: {
        backgroundColor: '#F54E00',
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
    },
    buttonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
})
