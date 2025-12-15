/* eslint-disable compat/compat */
import { PostHogConversations, ConversationsManager } from '../../../extensions/conversations/posthog-conversations'
import { ConversationsRemoteConfig } from '../../../posthog-conversations-types'
import { PostHog } from '../../../posthog-core'
import { RemoteConfig } from '../../../types'
import { assignableWindow } from '../../../utils/globals'
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
            enable: jest.fn(),
            disable: jest.fn(),
            destroy: jest.fn(),
            reset: jest.fn(),
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
                mockPostHog
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
        it('should delegate to the lazy-loaded manager reset method', () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-token',
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)
            expect(conversations.isLoaded()).toBe(true)

            conversations.reset()

            expect(mockManager.reset).toHaveBeenCalled()
            expect(conversations.isLoaded()).toBe(false)
        })

        it('should be a no-op if manager is not loaded', () => {
            // Don't load the manager
            expect(conversations.isLoaded()).toBe(false)

            // Should not throw
            expect(() => conversations.reset()).not.toThrow()
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

        describe('enable', () => {
            it('should call enable on the manager', () => {
                conversations.enable()

                expect(mockManager.enable).toHaveBeenCalled()
            })

            it('should not throw if manager is not loaded', () => {
                const newConversations = new PostHogConversations(mockPostHog)

                expect(() => newConversations.enable()).not.toThrow()
            })
        })

        describe('disable', () => {
            it('should call disable on the manager', () => {
                conversations.disable()

                expect(mockManager.disable).toHaveBeenCalled()
            })

            it('should not throw if manager is not loaded', () => {
                const newConversations = new PostHogConversations(mockPostHog)

                expect(() => newConversations.disable()).not.toThrow()
            })
        })
    })

    describe('PostHog instance passing', () => {
        let capturedPosthog: PostHog

        beforeEach(() => {
            assignableWindow.__PosthogExtensions__ = {
                initConversations: jest.fn((config, posthog) => {
                    capturedPosthog = posthog
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

        it('should pass the PostHog instance directly to initConversations', () => {
            expect(capturedPosthog).toBe(mockPostHog)
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

    describe('domain filtering', () => {
        const originalLocation = window.location

        beforeEach(() => {
            // Reset for each test
            Object.defineProperty(window, 'location', {
                value: { hostname: 'app.example.com' },
                writable: true,
            })
        })

        afterEach(() => {
            Object.defineProperty(window, 'location', {
                value: originalLocation,
                writable: true,
            })
        })

        it('should load when domains is empty (allow all)', () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-token',
                    domains: [],
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)

            expect(assignableWindow.__PosthogExtensions__?.initConversations).toHaveBeenCalled()
        })

        it('should load when domains is not present (allow all)', () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-token',
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)

            expect(assignableWindow.__PosthogExtensions__?.initConversations).toHaveBeenCalled()
        })

        it('should load when current domain matches exactly', () => {
            Object.defineProperty(window, 'location', {
                value: { hostname: 'example.com' },
                writable: true,
            })

            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-token',
                    domains: ['https://example.com'],
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)

            expect(assignableWindow.__PosthogExtensions__?.initConversations).toHaveBeenCalled()
        })

        it('should load when current domain matches wildcard pattern', () => {
            Object.defineProperty(window, 'location', {
                value: { hostname: 'app.example.com' },
                writable: true,
            })

            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-token',
                    domains: ['https://*.example.com'],
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)

            expect(assignableWindow.__PosthogExtensions__?.initConversations).toHaveBeenCalled()
        })

        it('should load when wildcard matches root domain too', () => {
            Object.defineProperty(window, 'location', {
                value: { hostname: 'example.com' },
                writable: true,
            })

            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-token',
                    domains: ['https://*.example.com'],
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)

            expect(assignableWindow.__PosthogExtensions__?.initConversations).toHaveBeenCalled()
        })

        it('should NOT load when current domain does not match any allowed domain', () => {
            Object.defineProperty(window, 'location', {
                value: { hostname: 'other-site.com' },
                writable: true,
            })

            // Track if initConversations was called
            const mockInit = jest.fn().mockReturnValue(mockManager)
            assignableWindow.__PosthogExtensions__ = {
                initConversations: mockInit,
            }

            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-token',
                    domains: ['https://example.com', 'https://*.posthog.com'],
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)

            expect(mockInit).not.toHaveBeenCalled()
            expect(conversations.isLoaded()).toBe(false)
        })

        it('should match any domain in the list', () => {
            Object.defineProperty(window, 'location', {
                value: { hostname: 'app.posthog.com' },
                writable: true,
            })

            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-token',
                    domains: ['https://example.com', 'https://*.posthog.com'],
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)

            expect(assignableWindow.__PosthogExtensions__?.initConversations).toHaveBeenCalled()
        })

        it('should ignore invalid domain URLs gracefully', () => {
            Object.defineProperty(window, 'location', {
                value: { hostname: 'example.com' },
                writable: true,
            })

            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-token',
                    domains: ['not-a-valid-url', 'https://example.com'],
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)

            expect(assignableWindow.__PosthogExtensions__?.initConversations).toHaveBeenCalled()
        })
    })
})
