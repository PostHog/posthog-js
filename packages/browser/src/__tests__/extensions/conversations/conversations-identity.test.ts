/* eslint-disable compat/compat */
import { PostHogConversations, ConversationsManager } from '../../../extensions/conversations/posthog-conversations'
import { ConversationsRemoteConfig } from '../../../posthog-conversations-types'
import { PostHog } from '../../../posthog-core'
import { RemoteConfig } from '../../../types'
import { assignableWindow } from '../../../utils/globals'
import { createMockPostHog, createMockConfig, createMockPersistence } from '../../helpers/posthog-instance'

describe('Conversations Identity Verification', () => {
    let conversations: PostHogConversations
    let mockPostHog: PostHog
    let mockManager: ConversationsManager

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

        const config = createMockConfig({
            api_host: 'https://test.posthog.com',
            token: 'test-token',
            disable_conversations: false,
        })

        mockPostHog = createMockPostHog({
            config,
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
            setIdentity: jest.fn((distinctId: string, hash: string) => {
                mockPostHog.config.identity_distinct_id = distinctId
                mockPostHog.config.identity_hash = hash
                ;(mockPostHog as any).conversations?._onIdentityChanged()
            }),
            clearIdentity: jest.fn(() => {
                delete mockPostHog.config.identity_distinct_id
                delete mockPostHog.config.identity_hash
                ;(mockPostHog as any).conversations?._onIdentityCleared()
            }),
        })

        assignableWindow.__PosthogExtensions__ = {
            initConversations: undefined,
            loadExternalDependency: jest.fn((_instance, _path, callback) => {
                assignableWindow.__PosthogExtensions__!.initConversations = jest.fn().mockReturnValue(mockManager)
                callback(null)
            }),
        }

        conversations = new PostHogConversations(mockPostHog)
        ;(mockPostHog as any).conversations = conversations
    })

    function loadConversations() {
        conversations.onRemoteConfig(remoteConfig as RemoteConfig)
    }

    describe('setIdentity', () => {
        it('should delegate to posthog.setIdentity() which stores on top-level config', () => {
            conversations.setIdentity('user_123', 'a1b2c3d4')

            expect(mockPostHog.config.identity_distinct_id).toBe('user_123')
            expect(mockPostHog.config.identity_hash).toBe('a1b2c3d4')
        })

        it('should forward to manager via _onIdentityChanged when manager is loaded', () => {
            loadConversations()
            conversations.setIdentity('user_123', 'a1b2c3d4')

            expect(mockManager.setIdentity).toHaveBeenCalled()
        })

        it('should store on config even when manager is not loaded yet', () => {
            conversations.setIdentity('user_123', 'a1b2c3d4')

            expect(mockPostHog.config.identity_distinct_id).toBe('user_123')
            expect(mockPostHog.config.identity_hash).toBe('a1b2c3d4')
            expect(mockManager.setIdentity).not.toHaveBeenCalled()
        })

        it('should be read by manager when it loads later', () => {
            conversations.setIdentity('user_123', 'a1b2c3d4')

            expect(mockPostHog.config.identity_distinct_id).toBe('user_123')

            loadConversations()

            expect(assignableWindow.__PosthogExtensions__!.initConversations).toHaveBeenCalled()
        })
    })

    describe('clearIdentity', () => {
        it('should remove identity from posthog.config', () => {
            mockPostHog.config.identity_distinct_id = 'user_123'
            mockPostHog.config.identity_hash = 'a1b2c3d4'
            conversations.clearIdentity()

            expect(mockPostHog.config.identity_distinct_id).toBeUndefined()
            expect(mockPostHog.config.identity_hash).toBeUndefined()
        })

        it('should forward to manager via _onIdentityCleared when manager is loaded', () => {
            loadConversations()
            conversations.clearIdentity()

            expect(mockManager.clearIdentity).toHaveBeenCalled()
        })

        it('should not throw when manager is not loaded', () => {
            expect(() => conversations.clearIdentity()).not.toThrow()
        })
    })

    describe('reset', () => {
        it('should delegate reset to manager', () => {
            loadConversations()
            conversations.reset()

            expect(mockManager.reset).toHaveBeenCalled()
        })
    })

    describe('init-time identity config', () => {
        it('should pass through init config to manager construction', () => {
            mockPostHog.config.identity_distinct_id = 'user_123'
            mockPostHog.config.identity_hash = 'a1b2c3d4'

            loadConversations()

            expect(assignableWindow.__PosthogExtensions__!.initConversations).toHaveBeenCalled()
            expect(mockPostHog.config.identity_distinct_id).toBe('user_123')
        })

        it('should not interfere when no identity config is set', () => {
            expect(mockPostHog.config.identity_distinct_id).toBeUndefined()

            loadConversations()

            expect(assignableWindow.__PosthogExtensions__!.initConversations).toHaveBeenCalled()
            expect(mockPostHog.config.identity_distinct_id).toBeUndefined()
        })
    })
})
