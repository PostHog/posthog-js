import type RNSafeAreaContext from 'react-native-safe-area-context'

let OptionalRNSafeArea: typeof RNSafeAreaContext | undefined = undefined

try {
  OptionalRNSafeArea = require('react-native-safe-area-context')
} catch (e) {}

function createDefaultInsets(): RNSafeAreaContext.EdgeInsets {
  // If the library isn't available, fall back to a default which should cover most devices
  return { top: 60, bottom: 30, left: 0, right: 0 }
}

export const useOptionalSafeAreaInsets = (): RNSafeAreaContext.EdgeInsets => {
  const useSafeAreaInsets = OptionalRNSafeArea?.useSafeAreaInsets ?? createDefaultInsets
  try {
    // oxlint-disable-next-line react-hooks/rules-of-hooks -- The selected function is always a hook or a hook-free fallback.
    return useSafeAreaInsets()
  } catch (err) {
    return createDefaultInsets()
  }
}
