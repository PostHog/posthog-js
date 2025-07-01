import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
  createNavigationContainerRef,
  // NavigationContainer,
  // NavigationIndependentTree,
} from '@react-navigation/native'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import 'react-native-reanimated'

import { PostHogProvider, PostHogSurveyProvider } from 'posthog-react-native'

import { useColorScheme } from '@/hooks/useColorScheme'
import { posthog } from './posthog'

export const navigationRef = createNavigationContainerRef()

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
        captureScreens: true, // TODO: not working with Expo 53/@react-navigation/native
        captureTouches: true,
        customLabelProp: 'ph-my-label',
        navigationRef: navigationRef,
      }}
      debug={true}
    >
      <PostHogSurveyProvider client={posthog}>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack ref={navigationRef}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="+not-found" />
          </Stack>
          <StatusBar style="auto" />
        </ThemeProvider>
      </PostHogSurveyProvider>
    </PostHogProvider>
  )
}
