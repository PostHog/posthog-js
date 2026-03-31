/* eslint-disable compat/compat */
import { PostHogConversations, ConversationsManager } from '../../../extensions/conversations/posthog-conversations'
import { ConversationsIdentityConfig, ConversationsRemoteConfig } from '../../../posthog-conversations-types'
import { PostHog } from '../../../posthog-core'
import { RemoteConfig } from '../../../types'
import { assignableWindow } from '../../../utils/globals'
import { createMockPostHog, createMockConfig, createMockPersistence } from '../../helpers/posthog-instance'

describe('Conversations Identity Verification', () => {
    let conversations: PostHogConversations
    let mockPostHog: PostHog
    let mockManager: ConversationsManager

    const validIdentity: ConversationsIdentityConfig = {
        identity_distinct_id: 'user_123',
        identity_hash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    }

    const remoteConfig: Partial<RemoteConfig> = {
        conversations: {
            enabled: true,
            token: 'test-conversations-token',
        } as ConversationsRemoteConfig,
    }

    beforeEach(() => {
        localStorage.clear()
        jest.clearAllMocks()

        mockManager = {
            show: jest.fn(),
            hide: jest.fn(),
            reset: jest.fn(),
            isVisible: jest.fn().mockReturnValue(true),
            sendMessage: jest.fn(),
            getMessages: jest.fn(),
            markAsRead: jest.fn(),
            getTickets: jest.fn(),
            requestRestoreLink: jest.fn(),
            restoreFromToken: jest.fn(),
            restoreFromUrlToken: jest.fn(),
            getCurrentTicketId: jest.fn(),
            getWidgetSessionId: jest.fn(),
            setIdentity: jest.fn(),
            clearIdentity: jest.fn(),
        } as unknown as ConversationsManager

        mockPostHog = createMockPostHog({
            config: createMockConfig({
                api_host: 'https://test.posthog.com',
                token: 'test-token',
                disable_conversations: false,
            }),
            persistence: createMockPersistence({
                props: {},
            }),
            requestRouter: {
                endpointFor: jest.fn().mockReturnValue('https://test.posthog.com/api/test'),
            } as any,
            consent: {
                isOptedOut: jest.fn().mockReturnValue(false),
            } as any,
            get_distinct_id: jest.fn().mockReturnValue('test-distinct-id'),
            on: jest.fn().mockReturnValue(jest.fn()),
        })

        assignableWindow.__PosthogExtensions__ = {
            initConversations: undefined,
            loadExternalDependency: jest.fn((_instance, _path, callback) => {
                assignableWindow.__PosthogExtensions__!.initConversations = jest.fn().mockReturnValue(mockManager)
                callback(null)
            }),
        }

        conversations = new PostHogConversations(mockPostHog)
    })

    function loadConversations() {
        conversations.onRemoteConfig(remoteConfig as RemoteConfig)
    }

    describe('setIdentity', () => {
        it('should store identity on posthog.config.conversations', () => {
            conversations.setIdentity(validIdentity)

            expect(mockPostHog.config.conversations).toEqual(validIdentity)
        })

        it('should forward to manager when manager is loaded', () => {
            loadConversations()
            conversations.setIdentity(validIdentity)

            expect(mockManager.setIdentity).toHaveBeenCalledWith(validIdentity)
        })

        it('should store on config even when manager is not loaded yet', () => {
            conversations.setIdentity(validIdentity)

            expect(mockPostHog.config.conversations).toEqual(validIdentity)
            expect(mockManager.setIdentity).not.toHaveBeenCalled()
        })

        it('should be read by manager when it loads later', () => {
            conversations.setIdentity(validIdentity)

            expect(mockPostHog.config.conversations).toEqual(validIdentity)

            loadConversations()

            // The initConversations function was called, meaning the manager was created.
            // The manager reads config.conversations in its _initialize() method.
            expect(assignableWindow.__PosthogExtensions__!.initConversations).toHaveBeenCalled()
        })
    })

    describe('clearIdentity', () => {
        it('should remove identity from posthog.config', () => {
            mockPostHog.config.conversations = validIdentity
            conversations.clearIdentity()

            expect(mockPostHog.config.conversations).toBeUndefined()
        })

        it('should forward to manager when manager is loaded', () => {
            loadConversations()
            conversations.clearIdentity()

            expect(mockManager.clearIdentity).toHaveBeenCalled()
        })

        it('should not throw when manager is not loaded', () => {
            expect(() => conversations.clearIdentity()).not.toThrow()
        })
    })

    describe('reset', () => {
        it('should clear identity from config', () => {
            mockPostHog.config.conversations = validIdentity
            loadConversations()

            conversations.reset()

            expect(mockPostHog.config.conversations).toBeUndefined()
        })

        it('should delegate reset to manager', () => {
            loadConversations()
            conversations.reset()

            expect(mockManager.reset).toHaveBeenCalled()
        })
    })

    describe('init-time identity config', () => {
        it('should pass through init config to manager construction', () => {
            mockPostHog.config.conversations = validIdentity

            loadConversations()

            // Manager was created and config.conversations was set before construction
            expect(assignableWindow.__PosthogExtensions__!.initConversations).toHaveBeenCalled()
            expect(mockPostHog.config.conversations).toEqual(validIdentity)
        })

        it('should not interfere when no identity config is set', () => {
            expect(mockPostHog.config.conversations).toBeUndefined()

            loadConversations()

            expect(assignableWindow.__PosthogExtensions__!.initConversations).toHaveBeenCalled()
            expect(mockPostHog.config.conversations).toBeUndefined()
        })
    })
})
