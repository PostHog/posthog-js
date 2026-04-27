import { Platform, UIManager } from 'react-native'
import type * as ReactNativeSvg from 'react-native-svg'

const hasViewManagerConfig = (name: string): boolean => {
  try {
    return !!UIManager.hasViewManagerConfig?.(name)
  } catch (e) {
    return false
  }
}

const hasNativeSvgSupport = (): boolean => {
  if (Platform.OS === 'web') {
    return true
  }

  const svgViewName = Platform.OS === 'android' ? 'RNSVGSvgViewAndroid' : 'RNSVGSvgView'

  return !!(hasViewManagerConfig(svgViewName) && hasViewManagerConfig('RNSVGPath'))
}

export let OptionalReactNativeSvg: typeof ReactNativeSvg | undefined = undefined

try {
  const ReactNativeSvg = require('react-native-svg')
  if (hasNativeSvgSupport()) {
    OptionalReactNativeSvg = ReactNativeSvg
  }
} catch (e) {}
