import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native'
import { useFonts } from 'expo-font'
import { Stack, usePathname } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import 'react-native-reanimated'

import { PostHogProvider, PostHogSurveyProvider } from 'posthog-react-native'

import { useColorScheme } from '@/hooks/useColorScheme'
import { posthog } from './posthog'

export default function RootLayout() {
    const colorScheme = useColorScheme()

    // Demo of deferring popover surveys via `autoPresentSurveys`. Here we defer while the
    // Surveys screen is open so an auto-popover doesn't fight that screen's demo UI, and
    // let it present anywhere else. Real apps wire this to whatever should hold a popover
    // back — e.g. a native formSheet/modal being on top — and are responsible for flipping
    // it true again (here, on route change), or the survey stays deferred and never shows.
    const pathname = usePathname()
    const autoPresentSurveys = pathname !== '/surveys'

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
            <PostHogSurveyProvider client={posthog} autoPresentSurveys={autoPresentSurveys}>
                <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
                    <Stack>
                        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                        <Stack.Screen name="surveys" options={{ title: 'Surveys' }} />
                        <Stack.Screen name="+not-found" />
                    </Stack>
                    <StatusBar style="auto" />
                </ThemeProvider>
            </PostHogSurveyProvider>
        </PostHogProvider>
    )
}
