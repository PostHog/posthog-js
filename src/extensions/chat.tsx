import * as Preact from 'preact'
import { PostHog } from '../posthog-core'
import { document as _document, window as _window } from '../utils/globals'
import { logger } from '../utils/logger'
import { PosthogChatBox } from './chat/components/PosthogChatBox'

// We cast the types here which is dangerous but protected by the top level generateSurveys call
const window = _window as Window & typeof globalThis
const document = _document as Document

export const retrieveChatShadowRoot = () => {
    const chatClassName = 'PostHogChat'
    const existingDiv = document.querySelector(`.${chatClassName}`)

    if (existingDiv && existingDiv.shadowRoot) {
        return existingDiv.shadowRoot
    }

    // If it doesn't exist, create it
    const div = document.createElement('div')
    // addSurveyCSSVariablesToElement(div, survey.appearance)
    div.className = chatClassName
    const shadow = div.attachShadow({ mode: 'open' })
    // const stylesheet = getSurveyStylesheet(posthog)
    // if (stylesheet) {
    //     const existingStylesheet = shadow.querySelector('style')
    //     if (existingStylesheet) {
    //         shadow.removeChild(existingStylesheet)
    //     }
    //     shadow.appendChild(stylesheet)
    // }
    document.body.appendChild(div)
    return shadow
}

export class ChatManager {
    private _posthog: PostHog

    constructor(posthog: PostHog) {
        this._posthog = posthog
    }

    public evaluateDisplayLogic = (): void => {
        logger.info('PostHogChat evaluateDisplayLogic')
        this._posthog?.chat.getChat()
        const shadowRoot = retrieveChatShadowRoot()
        Preact.render(<PosthogChatBox posthog={this._posthog} />, shadowRoot)
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
    //setInterval(() => {
    //    chatManager.evaluateDisplayLogic()
    //}, 1000)
    return chatManager
}
