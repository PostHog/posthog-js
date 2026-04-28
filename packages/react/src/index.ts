import posthogJs from 'posthog-js'
import { setDefaultPostHogInstance } from './context/posthog-default'

setDefaultPostHogInstance(posthogJs)

export * from './context'
export * from './hooks'
export * from './components'
export * from './helpers'
