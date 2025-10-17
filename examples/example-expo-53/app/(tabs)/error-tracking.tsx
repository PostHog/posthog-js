import { Button, StyleSheet } from 'react-native'

import ParallaxScrollView from '@/components/ParallaxScrollView'
import { ThemedText } from '@/components/ThemedText'
import { ThemedView } from '@/components/ThemedView'
import { IconSymbol } from '@/components/ui/IconSymbol'
import { usePostHog } from 'posthog-react-native'

export default function ErrorTrackingScreen() {
    const posthog = usePostHog()
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
            <Button
                onPress={() => posthog.captureException(new Error('User clicked Capture Error'))}
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
})
