/* eslint-disable compat/compat */
import { PostHogConversations, ConversationsManager } from '../../../posthog-conversations'
import { ConversationsRemoteConfig } from '../../../posthog-conversations-types'
import { PostHog } from '../../../posthog-core'
import { RemoteConfig } from '../../../types'
import { assignableWindow, ConversationsApiHelpers } from '../../../utils/globals'
import { createMockPostHog, createMockConfig, createMockPersistence } from '../../helpers/posthog-instance'

describe('PostHogConversations', () => {
    let conversations: PostHogConversations
    let mockPostHog: PostHog
    let mockManager: ConversationsManager

    beforeEach(() => {
        // Clear localStorage
        localStorage.clear()
        jest.clearAllMocks()

        // Setup mock manager
        mockManager = {
            show: jest.fn(),
            hide: jest.fn(),
            sendMessage: jest.fn(),
            destroy: jest.fn(),
        } as ConversationsManager

        // Setup mock PostHog instance
        mockPostHog = createMockPostHog({
            config: createMockConfig({
                api_host: 'https://test.posthog.com',
                token: 'test-token',
                disable_conversations: false,
            }),
            persistence: createMockPersistence({
                props: {
                    $name: 'Test User',
                    $email: 'test@example.com',
                },
            }),
            requestRouter: {
                endpointFor: jest.fn().mockReturnValue('https://test.posthog.com/api/test'),
            } as any,
            consent: {
                isOptedOut: jest.fn().mockReturnValue(false),
            } as any,
            get_distinct_id: jest.fn().mockReturnValue('test-distinct-id'),
            on: jest.fn().mockReturnValue(jest.fn()), // Returns unsubscribe function
        })

        // Setup PostHog extensions
        // initConversations is initially undefined (script not loaded)
        // loadExternalDependency callback will set it (simulating script load)
        assignableWindow.__PosthogExtensions__ = {
            initConversations: undefined,
            loadExternalDependency: jest.fn((_instance, _path, callback) => {
                // Simulate script loading by setting initConversations
                assignableWindow.__PosthogExtensions__!.initConversations = jest.fn().mockReturnValue(mockManager)
                callback(null)
            }),
        }

        conversations = new PostHogConversations(mockPostHog)
    })

    describe('onRemoteConfig', () => {
        it('should not load conversations if disabled in config', () => {
            mockPostHog.config.disable_conversations = true
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-conversations-token',
                },
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)
            conversations.loadIfEnabled()

            expect(assignableWindow.__PosthogExtensions__?.loadExternalDependency).not.toHaveBeenCalled()
        })

        it('should set isEnabled to false when conversations is null', () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: null,
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)

            expect(conversations.isEnabled()).toBe(false)
        })

        it('should set isEnabled to true when conversations is boolean true', () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: true,
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)

            expect(conversations.isEnabled()).toBe(true)
        })

        it('should set isEnabled to false when conversations is boolean false', () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: false,
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)

            expect(conversations.isEnabled()).toBe(false)
        })

        it('should handle ConversationsRemoteConfig object', () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-token',
                    greetingText: 'Hello!',
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)

            expect(conversations.isEnabled()).toBe(true)
        })

        it('should load conversations if enabled and all conditions are met', () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-token',
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)

            expect(assignableWindow.__PosthogExtensions__?.loadExternalDependency).toHaveBeenCalledWith(
                mockPostHog,
                'conversations',
                expect.any(Function)
            )
        })
    })

    describe('loadIfEnabled', () => {
        const validRemoteConfig: Partial<RemoteConfig> = {
            conversations: {
                enabled: true,
                token: 'test-token',
            } as ConversationsRemoteConfig,
        }

        it('should not load if already loaded', () => {
            conversations.onRemoteConfig(validRemoteConfig as RemoteConfig)
            expect(assignableWindow.__PosthogExtensions__?.loadExternalDependency).toHaveBeenCalledTimes(1)

            conversations.loadIfEnabled()
            expect(assignableWindow.__PosthogExtensions__?.loadExternalDependency).toHaveBeenCalledTimes(1)
        })

        it('should not load if conversations are disabled', () => {
            mockPostHog.config.disable_conversations = true
            conversations.onRemoteConfig(validRemoteConfig as RemoteConfig)

            expect(assignableWindow.__PosthogExtensions__?.loadExternalDependency).not.toHaveBeenCalled()
        })

        it('should not load in cookieless mode without consent', () => {
            mockPostHog.config.cookieless_mode = 'always'
            ;(mockPostHog.consent.isOptedOut as jest.Mock).mockReturnValue(true)

            conversations.onRemoteConfig(validRemoteConfig as RemoteConfig)

            expect(assignableWindow.__PosthogExtensions__?.loadExternalDependency).not.toHaveBeenCalled()
        })

        it('should not load if PostHog extensions are not found', () => {
            assignableWindow.__PosthogExtensions__ = undefined

            conversations.onRemoteConfig(validRemoteConfig as RemoteConfig)

            expect(conversations.isLoaded()).toBe(false)
        })

        it('should not load if remote config is not loaded yet', () => {
            conversations.loadIfEnabled()

            expect(assignableWindow.__PosthogExtensions__?.loadExternalDependency).not.toHaveBeenCalled()
        })

        it('should not load if conversations are not enabled', () => {
            const disabledConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: false,
                    token: 'test-token',
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig(disabledConfig as RemoteConfig)

            expect(assignableWindow.__PosthogExtensions__?.loadExternalDependency).not.toHaveBeenCalled()
        })

        it('should not load if token is missing', () => {
            const noTokenConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: '',
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig(noTokenConfig as RemoteConfig)

            expect(assignableWindow.__PosthogExtensions__?.loadExternalDependency).not.toHaveBeenCalled()
        })

        it('should use already loaded conversations code if available', () => {
            assignableWindow.__PosthogExtensions__ = {
                initConversations: jest.fn().mockReturnValue(mockManager),
            }

            conversations.onRemoteConfig(validRemoteConfig as RemoteConfig)

            expect(assignableWindow.__PosthogExtensions__.initConversations).toHaveBeenCalledWith(
                expect.objectContaining({ enabled: true, token: 'test-token' }),
                expect.objectContaining({
                    sendRequest: expect.any(Function),
                    endpointFor: expect.any(Function),
                    getDistinctId: expect.any(Function),
                    getPersonProperties: expect.any(Function),
                    capture: expect.any(Function),
                    on: expect.any(Function),
                })
            )
        })

        it('should handle load error gracefully', () => {
            assignableWindow.__PosthogExtensions__ = {
                loadExternalDependency: jest.fn((_instance, _path, callback) => {
                    callback('Load failed')
                }),
            }

            conversations.onRemoteConfig(validRemoteConfig as RemoteConfig)

            expect(conversations.isLoaded()).toBe(false)
        })
    })

    describe('reset', () => {
        it('should clear conversation-related data from localStorage', () => {
            localStorage.setItem('ph_conversations_ticket_id', 'test-ticket')
            localStorage.setItem('ph_conversations_user_traits', '{"name":"Test"}')
            localStorage.setItem('other_key', 'should-remain')

            conversations.reset()

            expect(localStorage.getItem('ph_conversations_ticket_id')).toBeNull()
            expect(localStorage.getItem('ph_conversations_user_traits')).toBeNull()
            expect(localStorage.getItem('other_key')).toBe('should-remain')
        })

        it('should destroy the manager if it exists', () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-token',
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)
            expect(conversations.isLoaded()).toBe(true)

            conversations.reset()

            expect(mockManager.destroy).toHaveBeenCalled()
            expect(conversations.isLoaded()).toBe(false)
        })

        it('should reset state', () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-token',
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)
            expect(conversations.isEnabled()).toBe(true)

            conversations.reset()

            expect(conversations.isEnabled()).toBe(false)
        })
    })

    describe('API methods', () => {
        beforeEach(() => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-token',
                } as ConversationsRemoteConfig,
            }
            conversations.onRemoteConfig(remoteConfig as RemoteConfig)
        })

        describe('open', () => {
            it('should call show on the manager', () => {
                conversations.open()

                expect(mockManager.show).toHaveBeenCalled()
            })

            it('should not throw if manager is not loaded', () => {
                const newConversations = new PostHogConversations(mockPostHog)

                expect(() => newConversations.open()).not.toThrow()
            })
        })

        describe('close', () => {
            it('should call hide on the manager', () => {
                conversations.close()

                expect(mockManager.hide).toHaveBeenCalled()
            })

            it('should not throw if manager is not loaded', () => {
                const newConversations = new PostHogConversations(mockPostHog)

                expect(() => newConversations.close()).not.toThrow()
            })
        })

        describe('sendMessage', () => {
            it('should call sendMessage on the manager', () => {
                conversations.sendMessage('Hello!')

                expect(mockManager.sendMessage).toHaveBeenCalledWith('Hello!')
            })

            it('should not send empty messages', () => {
                conversations.sendMessage('')
                conversations.sendMessage('   ')

                expect(mockManager.sendMessage).not.toHaveBeenCalled()
            })

            it('should not throw if manager is not loaded', () => {
                const newConversations = new PostHogConversations(mockPostHog)

                expect(() => newConversations.sendMessage('test')).not.toThrow()
            })
        })
    })

    describe('API helpers creation', () => {
        let capturedApiHelpers: ConversationsApiHelpers

        beforeEach(() => {
            assignableWindow.__PosthogExtensions__ = {
                initConversations: jest.fn((config, apiHelpers) => {
                    capturedApiHelpers = apiHelpers
                    return mockManager
                }),
            }

            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-conversations-token',
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)
        })

        it('should create apiHelpers with all required methods', () => {
            expect(capturedApiHelpers).toBeDefined()
            expect(typeof capturedApiHelpers.sendRequest).toBe('function')
            expect(typeof capturedApiHelpers.endpointFor).toBe('function')
            expect(typeof capturedApiHelpers.getDistinctId).toBe('function')
            expect(typeof capturedApiHelpers.getPersonProperties).toBe('function')
            expect(typeof capturedApiHelpers.capture).toBe('function')
            expect(typeof capturedApiHelpers.on).toBe('function')
        })

        it('sendRequest should call PostHog._send_request', () => {
            capturedApiHelpers.sendRequest({
                url: 'https://test.com/api',
                method: 'POST',
                data: { test: 'data' },
                headers: { 'X-Test': 'header' },
                callback: jest.fn(),
            })

            expect(mockPostHog._send_request).toHaveBeenCalledWith({
                url: 'https://test.com/api',
                method: 'POST',
                data: { test: 'data' },
                headers: { 'X-Test': 'header' },
                callback: expect.any(Function),
            })
        })

        it('endpointFor should call PostHog.requestRouter.endpointFor', () => {
            capturedApiHelpers.endpointFor('api', '/test/path')

            expect(mockPostHog.requestRouter.endpointFor).toHaveBeenCalledWith('api', '/test/path')
        })

        it('getDistinctId should call PostHog.get_distinct_id', () => {
            capturedApiHelpers.getDistinctId()

            expect(mockPostHog.get_distinct_id).toHaveBeenCalled()
        })

        it('getPersonProperties should return persistence props', () => {
            const result = capturedApiHelpers.getPersonProperties()

            expect(result).toEqual({
                $name: 'Test User',
                $email: 'test@example.com',
            })
        })

        it('capture should call PostHog.capture', () => {
            capturedApiHelpers.capture('test_event', { prop: 'value' })

            expect(mockPostHog.capture).toHaveBeenCalledWith('test_event', { prop: 'value' })
        })

        it('on should call PostHog.on', () => {
            const handler = jest.fn()
            capturedApiHelpers.on('eventCaptured', handler)

            expect(mockPostHog.on).toHaveBeenCalledWith('eventCaptured', handler)
        })
    })

    describe('isLoaded', () => {
        it('should return false before loading', () => {
            expect(conversations.isLoaded()).toBe(false)
        })

        it('should return true after loading', () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-token',
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)

            expect(conversations.isLoaded()).toBe(true)
        })
    })

    describe('isEnabled', () => {
        it('should return false before remote config', () => {
            expect(conversations.isEnabled()).toBe(false)
        })

        it('should return true when enabled in remote config', () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-token',
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)

            expect(conversations.isEnabled()).toBe(true)
        })

        it('should return false when disabled in remote config', () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: false,
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)

            expect(conversations.isEnabled()).toBe(false)
        })
    })
})
