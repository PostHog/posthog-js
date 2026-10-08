import type AsyncStorage from '@react-native-async-storage/async-storage'

export let OptionalAsyncStorage: typeof AsyncStorage | undefined = undefined

try {
  OptionalAsyncStorage = require('@react-native-async-storage/async-storage').default
} catch (e) {}
