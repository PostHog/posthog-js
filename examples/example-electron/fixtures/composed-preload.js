import { contextBridge } from 'electron'
import { exposePostHogBridge } from '@posthog/electron/preload/helper'

// Bundle both APIs into one sandbox-compatible preload; never expose raw IPC.
contextBridge.exposeInMainWorld('applicationFixture', {
    name: 'composed-sandbox-preload',
    version: 1,
})
exposePostHogBridge()
