import { Platform } from 'react-native'

type ReactNativeGlobal = {
  HermesInternal?: {
    enablePromiseRejectionTracker?: (args: {
      allRejections: boolean
      onUnhandled?: (id: string, error: any) => void
      onHandled?: (id: string, error: any) => void
    }) => void
    hasPromise?: () => boolean
  }
  ErrorUtils?: {
    getGlobalHandler?: () => (error: Error, isFatal: boolean) => void
    setGlobalHandler?: (handler: (error: Error, isFatal: boolean) => void) => void
  }
  onunhandledrejection?: (event: unknown) => void
}

// fallback for older environments
const _global: typeof global | undefined = typeof global !== 'undefined' ? global : undefined

// works after for ECMAScript 2020 (React Native >= 0.63)
const _globalThis: typeof globalThis | undefined = typeof globalThis !== 'undefined' ? globalThis : undefined

export const GLOBAL_OBJ = (_globalThis ?? _global) as unknown as ReactNativeGlobal

/** Checks if the current platform is web */
export function isWeb(): boolean {
  return Platform.OS === 'web'
}

export const isHermes = () => !!GLOBAL_OBJ.HermesInternal
