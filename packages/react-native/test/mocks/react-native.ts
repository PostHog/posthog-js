import React from 'react'

const createComponent = (displayName: string) => {
  const Component = React.forwardRef<any, any>(({ children, ...props }, ref) =>
    React.createElement('div', { ...props, ref, 'data-rn-component': displayName }, children)
  )
  Component.displayName = displayName
  return Component
}

const remove = vi.fn()
const addEventListener = vi.fn(() => ({ remove }))

export const Platform = {
  OS: 'ios',
  Version: '17.0',
  select: vi.fn((options: Record<string, any>) => options?.ios ?? options?.native ?? options?.default),
}

export const StyleSheet = {
  create: vi.fn((styles: any) => styles),
  flatten: vi.fn((style: any) => style),
  compose: vi.fn((style1: any, style2: any) => [style1, style2]),
  hairlineWidth: 1,
  absoluteFill: {},
  absoluteFillObject: {},
}

export const AppState = {
  currentState: 'active',
  addEventListener,
  removeEventListener: vi.fn(),
}

export const Linking = {
  addEventListener,
  removeEventListener: vi.fn(),
  getInitialURL: vi.fn(() => Promise.resolve(null)),
  canOpenURL: vi.fn(() => Promise.resolve(true)),
  openURL: vi.fn(() => Promise.resolve()),
}

export const Dimensions = {
  get: vi.fn(() => ({ width: 750, height: 1334, scale: 2, fontScale: 2 })),
  addEventListener,
  removeEventListener: vi.fn(),
}

export const Keyboard = {
  addListener: addEventListener,
  dismiss: vi.fn(),
}

export const UIManager = {
  hasViewManagerConfig: vi.fn(() => true),
  getViewManagerConfig: vi.fn(() => ({})),
}

export const NativeModules = {}
export const NativeEventEmitter = vi.fn()

export const useWindowDimensions = vi.fn(() => ({ width: 750, height: 1334, scale: 2, fontScale: 2 }))

export const View = createComponent('View')
export const Text = createComponent('Text')
export const TouchableOpacity = createComponent('TouchableOpacity')
export const Pressable = createComponent('Pressable')
export const ScrollView = createComponent('ScrollView')
export const TextInput = createComponent('TextInput')
export const KeyboardAvoidingView = createComponent('KeyboardAvoidingView')
export const Modal = createComponent('Modal')
export const SafeAreaView = createComponent('SafeAreaView')
export const Image = createComponent('Image')

export type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension'
export type GestureResponderEvent = any
export type StyleProp<T> = T | T[] | null | undefined
export type ViewStyle = Record<string, any>
export type TextStyle = Record<string, any>
export type ImageStyle = Record<string, any>
export type ViewProps = Record<string, any>
