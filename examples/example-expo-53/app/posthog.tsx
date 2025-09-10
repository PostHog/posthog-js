import PostHog from 'posthog-react-native'

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
