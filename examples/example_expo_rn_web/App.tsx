import { StatusBar } from 'expo-status-bar'
import { StyleSheet, Text, View } from 'react-native'

import PostHog from 'posthog-react-native'

export const posthog = new PostHog('phc_pQ70jJhZKHRvDIL5ruOErnPy6xiAiWCqlL4ayELj4X8', {
  host: 'https://us.i.posthog.com',
  flushAt: 1,
  captureAppLifecycleEvents: false,
  sendFeatureFlagEvent: false,
  preloadFeatureFlags: false,
  // persistence: 'memory',
})
posthog.debug(true)
posthog.capture('test')

export default function App() {
  return (
    <View style={styles.container}>
      <Text>Open up App.tsx to start working on your app!</Text>
      <StatusBar style="auto" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
