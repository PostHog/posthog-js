import { Image } from 'expo-image'
import { Platform, StyleSheet, Button, View } from 'react-native'

import { HelloWave } from '@/components/HelloWave'
import ParallaxScrollView from '@/components/ParallaxScrollView'
import { ThemedText } from '@/components/ThemedText'
import { ThemedView } from '@/components/ThemedView'
import { posthog } from '../posthog'
import { useState } from 'react'

export default function HomeScreen() {
  const [buttonText, setButtonText] = useState(
    `Tap the Explore tab to learn more about what's included in this starter app.`
  )
  const [replayStatus, setReplayStatus] = useState('Unknown')

  const handleClick = () => {
    posthog.capture('button_clicked', { name: 'example' })
    setButtonText('button_clicked' + new Date().toISOString())
  }

  const handleStartRecording = async (resumeCurrent: boolean) => {
    try {
      await posthog.startSessionRecording(resumeCurrent)
      setReplayStatus(`Started (resume=${resumeCurrent})`)
    } catch (e) {
      setReplayStatus(`Error: ${e}`)
    }
  }

  const handleStopRecording = async () => {
    try {
      await posthog.stopSessionRecording()
      setReplayStatus('Stopped')
    } catch (e) {
      setReplayStatus(`Error: ${e}`)
    }
  }

  const handleCheckStatus = async () => {
    try {
      const isActive = await posthog.isSessionReplayActive()
      setReplayStatus(`Active: ${isActive}`)
    } catch (e) {
      setReplayStatus(`Error: ${e}`)
    }
  }

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }}
      headerImage={<Image source={require('@/assets/images/partial-react-logo.png')} style={styles.reactLogo} />}
    >
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">Welcome!</ThemedText>
        <HelloWave />
      </ThemedView>
      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">Step 1: Try it</ThemedText>
        <ThemedText>
          Edit <ThemedText type="defaultSemiBold">app/(tabs)/index.tsx</ThemedText> to see changes. Press{' '}
          <ThemedText type="defaultSemiBold">
            {Platform.select({
              ios: 'cmd + d',
              android: 'cmd + m',
              web: 'F12',
            })}
          </ThemedText>{' '}
          to open developer tools.
        </ThemedText>
      </ThemedView>
      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">Step 2: Explore</ThemedText>
        <ThemedText onPress={handleClick}>{buttonText}</ThemedText>
      </ThemedView>
      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">Step 3: Get a fresh start</ThemedText>
        <ThemedText>
          {`When you're ready, run `}
          <ThemedText type="defaultSemiBold">npm run reset-project</ThemedText> to get a fresh{' '}
          <ThemedText type="defaultSemiBold">app</ThemedText> directory. This will move the current{' '}
          <ThemedText type="defaultSemiBold">app</ThemedText> to{' '}
          <ThemedText type="defaultSemiBold">app-example</ThemedText>.
        </ThemedText>
      </ThemedView>
      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">Session Replay Controls</ThemedText>
        <ThemedText>Status: {replayStatus}</ThemedText>
        <View style={styles.buttonContainer}>
          <Button title="Start (Resume)" onPress={() => handleStartRecording(true)} />
          <Button title="Start (New)" onPress={() => handleStartRecording(false)} />
          <Button title="Stop" onPress={handleStopRecording} />
          <Button title="Check Status" onPress={handleCheckStatus} />
        </View>
      </ThemedView>
    </ParallaxScrollView>
  )
}

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepContainer: {
    gap: 8,
    marginBottom: 8,
  },
  buttonContainer: {
    gap: 8,
    marginTop: 8,
  },
  reactLogo: {
    height: 178,
    width: 290,
    bottom: 0,
    left: 0,
    position: 'absolute',
  },
})
