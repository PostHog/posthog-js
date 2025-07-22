import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import 'react-native-reanimated'

import { PostHogProvider, PostHogSurveyProvider } from 'posthog-react-native'

import { useColorScheme } from '@/hooks/useColorScheme'
import { posthog } from './posthog'

export default function RootLayout() {
  const colorScheme = useColorScheme()
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  })

  if (!loaded) {
    // Async font loading only occurs in development.
    return null
  }

  return (
    <PostHogProvider
      client={posthog}
      autocapture={{
        captureScreens: false, // expo-router requires this to be false and capture screens manually
        captureTouches: true,
        customLabelProp: 'ph-my-label',
      }}
      debug={true}
    >
      <PostHogSurveyProvider client={posthog}>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="+not-found" />
          </Stack>
          <StatusBar style="auto" />
        </ThemeProvider>
      </PostHogSurveyProvider>
    </PostHogProvider>
  )
}
