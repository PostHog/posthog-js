import React from 'react'

const createComponent = (displayName: string) => {
  const Component = React.forwardRef<any, any>(({ children, ...props }, ref) =>
    React.createElement('div', { ...props, ref, 'data-rn-component': displayName }, children)
  )
  Component.displayName = displayName
  return Component
}

const remove = jest.fn()
const addEventListener = jest.fn(() => ({ remove }))

export const Platform = {
  OS: 'ios',
  Version: '17.0',
  select: jest.fn((options: Record<string, any>) => options?.ios ?? options?.native ?? options?.default),
}

export const StyleSheet = {
  create: jest.fn((styles: any) => styles),
  flatten: jest.fn((style: any) => style),
  compose: jest.fn((style1: any, style2: any) => [style1, style2]),
  hairlineWidth: 1,
  absoluteFill: {},
  absoluteFillObject: {},
}

export const AppState = {
  currentState: 'active',
  addEventListener,
  removeEventListener: jest.fn(),
}

export const Linking = {
  addEventListener,
  removeEventListener: jest.fn(),
  getInitialURL: jest.fn(() => Promise.resolve(null)),
  canOpenURL: jest.fn(() => Promise.resolve(true)),
  openURL: jest.fn(() => Promise.resolve()),
}

export const Dimensions = {
  get: jest.fn(() => ({ width: 750, height: 1334, scale: 2, fontScale: 2 })),
  addEventListener,
  removeEventListener: jest.fn(),
}

export const Keyboard = {
  addListener: addEventListener,
  dismiss: jest.fn(),
}

export const UIManager = {
  hasViewManagerConfig: jest.fn(() => true),
  getViewManagerConfig: jest.fn(() => ({})),
}

export const NativeModules = {}
export const NativeEventEmitter = jest.fn()

export const useWindowDimensions = jest.fn(() => ({ width: 750, height: 1334, scale: 2, fontScale: 2 }))

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
