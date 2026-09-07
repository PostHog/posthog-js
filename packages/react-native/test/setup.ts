import { localStorage } from './mocks/local-storage'
import * as ExpoApplication from './mocks/expo-application'
import * as ExpoDevice from './mocks/expo-device'
import * as ExpoLocalization from './mocks/expo-localization'

vi.mock('../src/optional/OptionalExpoApplication', () => ({ OptionalExpoApplication: ExpoApplication }))
vi.mock('../src/optional/OptionalExpoDevice', () => ({ OptionalExpoDevice: ExpoDevice }))
vi.mock('../src/optional/OptionalExpoLocalization', () => ({ OptionalExpoLocalization: ExpoLocalization }))

// jest-expo exposes the Node global as `window`, so preserve that behavior for
// tests which replace `window.fetch` while production code calls global `fetch`.
;(globalThis as any).window = (globalThis as any).window ?? globalThis
;(globalThis as any).localStorage = localStorage

const failOnUnexpectedConsoleOutput = (): void => {
  console.debug = (...args) => {
    throw new Error(`Unexpected console.debug: ${args}`)
  }

  console.error = (...args) => {
    throw new Error(`Unexpected console.error: ${args}`)
  }

  console.info = (...args) => {
    throw new Error(`Unexpected console.info: ${args}`)
  }

  console.log = (...args) => {
    throw new Error(`Unexpected console.log: ${args}`)
  }

  console.warn = (...args) => {
    throw new Error(`Unexpected console.warn: ${args}`)
  }
}

failOnUnexpectedConsoleOutput()

beforeEach(() => {
  failOnUnexpectedConsoleOutput()
  localStorage.clear()
})
