import { initConversations } from '../extensions/conversations/external'
import { assignableWindow } from '@posthog/browser-common/utils/globals'

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.initConversations = initConversations

export default initConversations
