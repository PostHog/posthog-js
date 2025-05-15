import * as Preact from 'preact'
import { PostHog } from '../posthog-core'
import { document as _document, window as _window } from '../utils/globals'
import { logger } from '../utils/logger'

// We cast the types here which is dangerous but protected by the top level generateSurveys call
const window = _window as Window & typeof globalThis
const document = _document as Document

export class ChatManager {
    private _posthog: PostHog

    constructor(posthog: PostHog) {
        this._posthog = posthog
    }

    public evaluateDisplayLogic = (): void => {
        logger.info('PostHogChat evaluateDisplayLogic')
    }
}

// This is the main exported function
export function loadChat(posthog: PostHog) {
    // NOTE: Important to ensure we never try and run chat without a window environment
    if (!document || !window) {
        return
    }

    const chatManager = new ChatManager(posthog)
    chatManager.evaluateDisplayLogic()

    // evaluate chat visibility every second
    setInterval(() => {
        chatManager.evaluateDisplayLogic()
    }, 1000)
    return chatManager
}
