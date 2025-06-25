import React, { useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { StyleSheet, Text, View } from 'react-native'
import PostHog, { PostHogProvider, PostHogSurveyProvider } from 'posthog-react-native'
// import { WebView } from 'react-native-webview';

export const posthog = new PostHog('phc_QFbR1y41s5sxnNTZoyKG2NJo2RlsCIWkUfdpawgb40D', {
  host: 'https://us.i.posthog.com',
  flushAt: 1,
  enableSessionReplay: true,
  captureAppLifecycleEvents: true,
  // if using WebView, you have to disable masking for text inputs and images
  // sessionReplayConfig: {
  //   maskAllTextInputs: false,
  //   maskAllImages: false,
  // },
})
posthog.debug(true)

export const SharedPostHogProvider = (props: any) => {
  return (
    <PostHogProvider
      client={posthog}
      autocapture={{
        captureScreens: true,
        captureTouches: true,
        customLabelProp: 'ph-my-label',
      }}
      debug={true}
    >
      {props.children}
    </PostHogProvider>
  )
}

// you can use accessibilityLabel='ph-no-capture' to prevent capturing the WebView
// const MyWebComponent = () => {
//   return <WebView source={{ uri: 'https://reactnative.dev/' }} style={{ flex: 1 }} />;
// }

export default function App() {
  const [buttonText, setButtonText] = useState('Open up App.js to start working on your app!')

  const handleClick = () => {
    posthog.capture('button_clicked', { name: 'example' })
    setButtonText('button_clicked' + new Date().toISOString())
  }

  return (
    <SharedPostHogProvider>
      <PostHogSurveyProvider client={posthog}>
        <View style={styles.container}>
          <Text onPress={handleClick}>{buttonText}</Text>
          <StatusBar style="auto" />
        </View>
      </PostHogSurveyProvider>
    </SharedPostHogProvider>
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
