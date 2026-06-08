import { useState, useEffect } from 'react';
import { StyleSheet, View, Text, Platform } from 'react-native';
import type PostHogReactNativePlugin from 'posthog-react-native-plugin';

export let OptionalReactNativePlugin:
  | typeof PostHogReactNativePlugin
  | undefined;

try {
  OptionalReactNativePlugin = Platform.select({
    macos: undefined,
    web: undefined,
    default: require('posthog-react-native-plugin'), // Only Android and iOS
  });
} catch (e) {
  // do nothing
  console.warn(
    'PostHog Debug',
    `Error loading posthog-react-native-plugin: ${e}`
  );
}

export default function App() {
  const [result, setResult] = useState<string | undefined>();

  useEffect(() => {
    if (OptionalReactNativePlugin) {
      setResult('ok');
      // OptionalReactNativePlugin.isEnabled().then((isEnabled) => {
      //   console.warn('PostHog Debug', `isEnabled: ${isEnabled}`);
      //   setResult(isEnabled.valueOf().toString());
      // });
      // OptionalReactNativePlugin.startSession(
      //   'e58ed763-928c-4155-bee9-fdbaaadc15f3'
      // )
      //   .then(() => {
      //     setResult('ok');
      //   })
      //   .catch(() => {
      //     setResult('failed');
      //   });
      // OptionalReactNativePlugin.setup(
      //   'e58ed763-928c-4155-bee9-fdbaaadc15f3',
      //   {
      //     apiKey: 'phc_QFbR1y41s5sxnNTZoyKG2NJo2RlsCIWkUfdpawgb40D',
      //     host: 'https://us.i.posthog.com',
      //   },
      //   {
      //     sessionReplay: { enabled: true, sdkReplayConfig: {}, decideReplayConfig: {} },
      //     errorTracking: { nativeAutocapture: true },
      //   }
      // )
      //   .then(() => {
      //     OptionalReactNativePlugin?.isEnabled().then((isEnabled) => {
      //       console.warn('PostHog Debug', `isEnabled: ${isEnabled}`);
      //       setResult(`isEnabled: ${isEnabled}`);
      //     });
      //   })
      //   .then(() => {
      //     setResult('ok');
      //   })
      //   .catch(() => {
      //     setResult('failed');
      //   });
    } else {
      console.warn('PostHog Debug', `meh`);
    }
  }, []);

  return (
    <View style={styles.container}>
      <Text>Result: {result}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  box: {
    width: 60,
    height: 60,
    marginVertical: 20,
  },
});
