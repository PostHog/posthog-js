import React from 'react'
import { NativeModules, StyleSheet, Text, View } from 'react-native'
import PostHog from 'posthog-react-native'
import * as PostHogReactNativePlugin from '@posthog/react-native-plugin'

const nativePluginLinked = NativeModules.PosthogReactNativePlugin != null
const javascriptPackagesLoaded =
    typeof PostHog === 'function' && typeof PostHogReactNativePlugin.isEnabled === 'function'

export default function App(): React.JSX.Element {
    if (!nativePluginLinked || !javascriptPackagesLoaded) {
        throw new Error('PostHog React Native SwiftPM integration is not linked')
    }

    return (
        <View style={styles.container}>
            <Text testID="posthog-spm-status">PostHog SwiftPM integration linked</Text>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        flex: 1,
        justifyContent: 'center',
    },
})
