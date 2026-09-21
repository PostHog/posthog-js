import { window } from '../utils/globals'
import type { ReplayRuntime } from './runtime'

export const replayWindow = window as (Window & { __PosthogExtensions__?: ReplayRuntime }) | undefined
