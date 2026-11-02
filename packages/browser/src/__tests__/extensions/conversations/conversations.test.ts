import type { Mock as VitestMock } from 'vitest'
import { PostHogConversations, ConversationsManager } from '../../../extensions/conversations/posthog-conversations'
import {
    ConversationsRemoteConfig,
    SendMessageResponse,
    GetMessagesResponse,
} from '../../../posthog-conversations-types'
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
        vi.clearAllMocks()

        // Setup mock manager
        mockManager = {
            show: vi.fn(),
            hide: vi.fn(),
            open: vi.fn(),
            close: vi.fn(),
            setTheme: vi.fn(),
            reset: vi.fn(),
            setIdentity: vi.fn(),
            clearIdentity: vi.fn(),
            sendMessage: vi.fn(async (): Promise<SendMessageResponse> => ({
                ticket_id: 'test-ticket',
                message_id: 'test-message',
                ticket_status: 'new',
                created_at: '2026-01-01T00:00:00Z',
                unread_count: 0,
            })),
            getMessages: vi.fn(async (): Promise<GetMessagesResponse> => ({
                ticket_id: 'test-ticket',
                ticket_status: 'new',
                messages: [],
                has_more: false,
                unread_count: 0,
            })),
            markAsRead: vi.fn(async () => ({ success: true, unread_count: 0 })),
            getTickets: vi.fn(async () => ({ count: 0, results: [] })),
            getCurrentTicketId: vi.fn(() => null),
            getWidgetSessionId: vi.fn(() => 'test-widget-session'),
            isVisible: vi.fn().mockReturnValue(true),
            requestRestoreLink: vi.fn(),
            restoreFromToken: vi.fn(),
            restoreFromUrlToken: vi.fn(),
        }

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
                endpointFor: vi.fn().mockReturnValue('https://test.posthog.com/api/test'),
            } as any,
            consent: {
                isOptedOut: vi.fn().mockReturnValue(false),
            } as any,
            get_distinct_id: vi.fn().mockReturnValue('test-distinct-id'),
            on: vi.fn().mockReturnValue(vi.fn()), // Returns unsubscribe function
        })

        // Setup PostHog extensions
        // initConversations is initially undefined (script not loaded)
        // loadExternalDependency callback will set it (simulating script load)
        assignableWindow.__PosthogExtensions__ = {
            initConversations: undefined,
            loadExternalDependency: vi.fn((_instance, _path, callback) => {
                // Simulate script loading by setting initConversations
                assignableWindow.__PosthogExtensions__!.initConversations = vi.fn().mockReturnValue(mockManager)
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

            conversations.onRemoteConfig({ ok: true, config: remoteConfig as RemoteConfig })
            conversations.loadIfEnabled()

            expect(assignableWindow.__PosthogExtensions__?.loadExternalDependency).not.toHaveBeenCalled()
        })

        it('should set isAvailable to false when conversations is null', () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: null,
            }

            conversations.onRemoteConfig({ ok: true, config: remoteConfig as RemoteConfig })

            expect(conversations.isAvailable()).toBe(false)
            expect(conversations.getUnavailableReason()).toBe('disabled_in_project')
        })

        it('should not load when conversations is boolean true (no token)', () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: true,
            }

            conversations.onRemoteConfig({ ok: true, config: remoteConfig as RemoteConfig })

            // Boolean true without token won't load the manager
            expect(conversations.isAvailable()).toBe(false)
        })

        it('should set isAvailable to false when conversations is boolean false', () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: false,
            }

            conversations.onRemoteConfig({ ok: true, config: remoteConfig as RemoteConfig })

            expect(conversations.isAvailable()).toBe(false)
        })

        it('should handle ConversationsRemoteConfig object', () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-token',
                    greetingText: 'Hello!',
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig({ ok: true, config: remoteConfig as RemoteConfig })

            expect(conversations.isAvailable()).toBe(true)
        })

        it('should load conversations if enabled and all conditions are met', () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-token',
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig({ ok: true, config: remoteConfig as RemoteConfig })

            expect(assignableWindow.__PosthogExtensions__?.loadExternalDependency).toHaveBeenCalledWith(
                mockPostHog,
                'conversations',
                expect.any(Function)
            )
        })
    })

    describe('getUnavailableReason', () => {
        const validRemoteConfig: Partial<RemoteConfig> = {
            conversations: { enabled: true, token: 'test-token' } as ConversationsRemoteConfig,
        }

        it('returns null once conversations are available', () => {
            conversations.onRemoteConfig({ ok: true, config: validRemoteConfig as RemoteConfig })

            expect(conversations.isAvailable()).toBe(true)
            expect(conversations.getUnavailableReason()).toBeNull()
        })

        it('returns remote_config_pending before remote config arrives', () => {
            expect(conversations.getUnavailableReason()).toBe('remote_config_pending')
        })

        it('returns remote_config_failed when remote config fails', () => {
            conversations.onRemoteConfig({ ok: false })

            expect(conversations.getUnavailableReason()).toBe('remote_config_failed')
        })

        it('returns disabled_in_project when successful remote config omits conversations', () => {
            conversations.onRemoteConfig({ ok: true, config: {} as RemoteConfig })

            expect(conversations.getUnavailableReason()).toBe('disabled_in_project')
        })

        it('returns disabled_by_config when disabled via config', () => {
            mockPostHog.config.disable_conversations = true

            expect(conversations.getUnavailableReason()).toBe('disabled_by_config')
        })

        it('returns disabled_in_project when disabled in remote config', () => {
            const remoteConfig: Partial<RemoteConfig> = { conversations: false }
            conversations.onRemoteConfig({ ok: true, config: remoteConfig as RemoteConfig })

            expect(conversations.getUnavailableReason()).toBe('disabled_in_project')
        })

        it('returns missing_token when enabled without a token', () => {
            const remoteConfig: Partial<RemoteConfig> = { conversations: true }
            conversations.onRemoteConfig({ ok: true, config: remoteConfig as RemoteConfig })

            expect(conversations.getUnavailableReason()).toBe('missing_token')
        })

        it('returns extensions_unavailable when the extensions global is absent', () => {
            assignableWindow.__PosthogExtensions__ = undefined
            conversations.onRemoteConfig({ ok: true, config: validRemoteConfig as RemoteConfig })

            expect(conversations.getUnavailableReason()).toBe('extensions_unavailable')
        })

        // The toolbar's internal instance is deliberately never given the conversations manager, so
        // reporting it as not_loaded would send someone hunting for a load failure that never happened.
        it('returns disabled_for_toolbar for the toolbar internal instance', () => {
            // Literal because TOOLBAR_INTERNAL_INSTANCE_NAME is private to general-utils. If it ever
            // changes, isToolbarInstance stops matching and this test fails rather than going quiet.
            mockPostHog.config.name = 'ph_toolbar_internal'
            conversations.onRemoteConfig({ ok: true, config: validRemoteConfig as RemoteConfig })

            expect(conversations.isAvailable()).toBe(false)
            expect(conversations.getUnavailableReason()).toBe('disabled_for_toolbar')
        })

        it('returns load_failed when the lazy bundle fails to load', () => {
            assignableWindow.__PosthogExtensions__!.loadExternalDependency = vi.fn((_instance, _path, callback) => {
                callback(new Event('error'))
            })
            conversations.onRemoteConfig({ ok: true, config: validRemoteConfig as RemoteConfig })

            expect(conversations.isAvailable()).toBe(false)
            expect(conversations.getUnavailableReason()).toBe('load_failed')
        })

        it('returns initializing while retrying after a load failure', () => {
            let attempt = 0
            let finishRetry: (() => void) | undefined
            assignableWindow.__PosthogExtensions__!.loadExternalDependency = vi.fn((_instance, _path, callback) => {
                attempt++
                if (attempt === 1) {
                    callback(new Event('error'))
                } else {
                    finishRetry = () => callback(new Event('error'))
                }
            })
            conversations.onRemoteConfig({ ok: true, config: validRemoteConfig as RemoteConfig })
            expect(conversations.getUnavailableReason()).toBe('load_failed')

            conversations.loadIfEnabled()

            expect(conversations.getUnavailableReason()).toBe('initializing')
            finishRetry!()
            expect(conversations.getUnavailableReason()).toBe('load_failed')
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
            conversations.onRemoteConfig({ ok: true, config: validRemoteConfig as RemoteConfig })
            expect(assignableWindow.__PosthogExtensions__?.loadExternalDependency).toHaveBeenCalledTimes(1)

            conversations.loadIfEnabled()
            expect(assignableWindow.__PosthogExtensions__?.loadExternalDependency).toHaveBeenCalledTimes(1)
        })

        it('should not load for toolbar internal instance', () => {
            mockPostHog.config.name = 'ph_toolbar_internal'
            conversations.onRemoteConfig({ ok: true, config: validRemoteConfig as RemoteConfig })

            expect(assignableWindow.__PosthogExtensions__?.loadExternalDependency).not.toHaveBeenCalled()
        })

        it('should not load if conversations are disabled', () => {
            mockPostHog.config.disable_conversations = true
            conversations.onRemoteConfig({ ok: true, config: validRemoteConfig as RemoteConfig })

            expect(assignableWindow.__PosthogExtensions__?.loadExternalDependency).not.toHaveBeenCalled()
        })

        it('should not load in cookieless mode without consent', () => {
            mockPostHog.config.cookieless_mode = 'always'
            ;(mockPostHog.consent.isOptedOut as VitestMock).mockReturnValue(true)

            conversations.onRemoteConfig({ ok: true, config: validRemoteConfig as RemoteConfig })

            expect(assignableWindow.__PosthogExtensions__?.loadExternalDependency).not.toHaveBeenCalled()
        })

        it('should not load if PostHog extensions are not found', () => {
            assignableWindow.__PosthogExtensions__ = undefined

            conversations.onRemoteConfig({ ok: true, config: validRemoteConfig as RemoteConfig })

            expect(conversations.isAvailable()).toBe(false)
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

            conversations.onRemoteConfig({ ok: true, config: disabledConfig as RemoteConfig })

            expect(assignableWindow.__PosthogExtensions__?.loadExternalDependency).not.toHaveBeenCalled()
        })

        it('should not load if token is missing', () => {
            const noTokenConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: '',
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig({ ok: true, config: noTokenConfig as RemoteConfig })

            expect(assignableWindow.__PosthogExtensions__?.loadExternalDependency).not.toHaveBeenCalled()
        })

        it('should use already loaded conversations code if available', () => {
            assignableWindow.__PosthogExtensions__ = {
                initConversations: vi.fn().mockReturnValue(mockManager),
            }

            conversations.onRemoteConfig({ ok: true, config: validRemoteConfig as RemoteConfig })

            expect(assignableWindow.__PosthogExtensions__.initConversations).toHaveBeenCalledWith(
                expect.objectContaining({ enabled: true, token: 'test-token' }),
                mockPostHog
            )
        })

        it('should handle load error gracefully', () => {
            assignableWindow.__PosthogExtensions__ = {
                loadExternalDependency: vi.fn((_instance, _path, callback) => {
                    callback('Load failed')
                }),
            }

            conversations.onRemoteConfig({ ok: true, config: validRemoteConfig as RemoteConfig })

            expect(conversations.isAvailable()).toBe(false)
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

            conversations.onRemoteConfig({ ok: true, config: remoteConfig as RemoteConfig })
            expect(conversations.isAvailable()).toBe(true)

            conversations.reset()

            expect(mockManager.reset).toHaveBeenCalled()
            expect(conversations.isAvailable()).toBe(false)
        })

        it('should be a no-op if manager is not loaded', () => {
            // Don't load the manager
            expect(conversations.isAvailable()).toBe(false)

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

            conversations.onRemoteConfig({ ok: true, config: remoteConfig as RemoteConfig })
            expect(conversations.isAvailable()).toBe(true)

            conversations.reset()

            expect(conversations.isAvailable()).toBe(false)
        })

        describe('when reset() runs while the bundle is loading', () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-token',
                } as ConversationsRemoteConfig,
            }
            let finishLoading: () => void
            let initConversations: VitestMock

            beforeEach(() => {
                initConversations = vi.fn().mockReturnValue(mockManager)
                assignableWindow.__PosthogExtensions__!.loadExternalDependency = vi.fn((_instance, _path, callback) => {
                    finishLoading = () => {
                        assignableWindow.__PosthogExtensions__!.initConversations = initConversations
                        callback(null)
                    }
                })
            })

            it('re-checks consent before finishing initialization', () => {
                mockPostHog.config.cookieless_mode = 'on_reject'
                conversations.onRemoteConfig({ ok: true, config: remoteConfig as RemoteConfig })

                conversations.reset()
                ;(mockPostHog.consent.isOptedOut as VitestMock).mockReturnValue(true)
                // core replays the cached remote config after reset
                conversations.onRemoteConfig({ ok: true, config: remoteConfig as RemoteConfig })
                finishLoading()

                expect(initConversations).not.toHaveBeenCalled()
                expect(conversations.isAvailable()).toBe(false)
                expect(conversations.getUnavailableReason()).toBe('consent_opted_out')
            })

            it('initializes once with the replayed config', () => {
                conversations.onRemoteConfig({ ok: true, config: remoteConfig as RemoteConfig })

                conversations.reset()
                conversations.onRemoteConfig({ ok: true, config: remoteConfig as RemoteConfig })
                finishLoading()

                expect(initConversations).toHaveBeenCalledTimes(1)
                expect(conversations.isAvailable()).toBe(true)
                expect(assignableWindow.__PosthogExtensions__?.loadExternalDependency).toHaveBeenCalledTimes(1)
            })

            it('stays unloaded when no remote config arrives after the reset', () => {
                conversations.onRemoteConfig({ ok: true, config: remoteConfig as RemoteConfig })

                conversations.reset()
                finishLoading()

                expect(initConversations).not.toHaveBeenCalled()
                expect(conversations.isAvailable()).toBe(false)
                expect(conversations.getUnavailableReason()).toBe('remote_config_pending')
            })
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
            conversations.onRemoteConfig({ ok: true, config: remoteConfig as RemoteConfig })
        })

        describe('show', () => {
            it('should call show on the manager', () => {
                conversations.show()

                expect(mockManager.show).toHaveBeenCalled()
            })

            it('should not throw if manager is not loaded', () => {
                const newConversations = new PostHogConversations(mockPostHog)

                expect(() => newConversations.show()).not.toThrow()
            })
        })

        describe('hide', () => {
            it('should call hide on the manager', () => {
                conversations.hide()

                expect(mockManager.hide).toHaveBeenCalled()
            })

            it('should not throw if manager is not loaded', () => {
                const newConversations = new PostHogConversations(mockPostHog)

                expect(() => newConversations.hide()).not.toThrow()
            })
        })

        describe('open', () => {
            it('should call open on the manager', () => {
                conversations.open()

                expect(mockManager.open).toHaveBeenCalled()
            })

            it('should not throw if manager is not loaded', () => {
                const newConversations = new PostHogConversations(mockPostHog)

                expect(() => newConversations.open()).not.toThrow()
            })
        })

        describe('close', () => {
            it('should call close on the manager', () => {
                conversations.close()

                expect(mockManager.close).toHaveBeenCalled()
            })

            it('should not throw if manager is not loaded', () => {
                const newConversations = new PostHogConversations(mockPostHog)

                expect(() => newConversations.close()).not.toThrow()
            })
        })

        describe('before the bundle loads', () => {
            const remoteConfig = {
                ok: true,
                config: {
                    conversations: { enabled: true, token: 'test-token' },
                } as RemoteConfig,
            }

            it('runs a queued open() once the bundle loads', () => {
                const late = new PostHogConversations(mockPostHog)
                ;(mockManager.open as VitestMock).mockClear()

                late.open()
                expect(mockManager.open).not.toHaveBeenCalled()

                late.onRemoteConfig(remoteConfig)

                expect(mockManager.open).toHaveBeenCalledTimes(1)
            })

            it('keeps the latest queued action', () => {
                const late = new PostHogConversations(mockPostHog)
                ;(mockManager.open as VitestMock).mockClear()
                ;(mockManager.close as VitestMock).mockClear()

                late.open()
                late.close()
                late.onRemoteConfig(remoteConfig)

                expect(mockManager.open).not.toHaveBeenCalled()
                expect(mockManager.close).toHaveBeenCalledTimes(1)
            })

            it('drops a queued open() when conversations are disabled', () => {
                const late = new PostHogConversations(mockPostHog)
                ;(mockManager.open as VitestMock).mockClear()

                late.open()
                late.onRemoteConfig({ ok: true, config: { conversations: false } as RemoteConfig })
                late.onRemoteConfig(remoteConfig)

                expect(mockManager.open).not.toHaveBeenCalled()
            })

            it('drops a queued open() on reset', () => {
                const late = new PostHogConversations(mockPostHog)
                ;(mockManager.open as VitestMock).mockClear()

                late.open()
                late.reset()
                late.onRemoteConfig(remoteConfig)

                expect(mockManager.open).not.toHaveBeenCalled()
            })

            it('drops a queued open() when hide() follows it', () => {
                const late = new PostHogConversations(mockPostHog)
                ;(mockManager.open as VitestMock).mockClear()

                late.open()
                late.hide()
                late.onRemoteConfig(remoteConfig)

                expect(mockManager.open).not.toHaveBeenCalled()
            })

            it('keeps a queued close() when hide() follows it', () => {
                const late = new PostHogConversations(mockPostHog)
                ;(mockManager.close as VitestMock).mockClear()

                late.close()
                late.hide()
                late.onRemoteConfig(remoteConfig)

                expect(mockManager.close).toHaveBeenCalledTimes(1)
            })

            it('applies setTheme() calls once the bundle loads, merged together', () => {
                const late = new PostHogConversations(mockPostHog)
                ;(mockManager.setTheme as VitestMock).mockClear()

                late.setTheme({ primary: '#111111', dark: { background: '#000000' } })
                late.setTheme({ colorScheme: 'auto', dark: { text: '#ffffff' } })
                expect(mockManager.setTheme).not.toHaveBeenCalled()

                late.onRemoteConfig(remoteConfig)

                expect(mockManager.setTheme).toHaveBeenCalledTimes(1)
                expect(mockManager.setTheme).toHaveBeenCalledWith({
                    primary: '#111111',
                    colorScheme: 'auto',
                    dark: { background: '#000000', text: '#ffffff' },
                })
            })

            it('keeps the theme across reset()', () => {
                const late = new PostHogConversations(mockPostHog)
                late.onRemoteConfig(remoteConfig)
                late.setTheme({ primary: '#111111' })
                ;(mockManager.setTheme as VitestMock).mockClear()

                late.reset()
                late.onRemoteConfig(remoteConfig)

                expect(mockManager.setTheme).toHaveBeenCalledWith({ primary: '#111111', dark: {} })
            })
        })

        describe('setTheme', () => {
            it('forwards the patch to a loaded manager', () => {
                conversations.setTheme({ colorScheme: 'dark' })

                expect(mockManager.setTheme).toHaveBeenCalledWith({ colorScheme: 'dark' })
            })

            it('does not throw when called without a theme', () => {
                expect(() => conversations.setTheme(undefined as any)).not.toThrow()
            })
        })
    })

    describe('PostHog instance passing', () => {
        let capturedPosthog: PostHog

        beforeEach(() => {
            assignableWindow.__PosthogExtensions__ = {
                initConversations: vi.fn((_config, posthog) => {
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

            conversations.onRemoteConfig({ ok: true, config: remoteConfig as RemoteConfig })
        })

        it('should pass the PostHog instance directly to initConversations', () => {
            expect(capturedPosthog).toBe(mockPostHog)
        })
    })

    describe('isAvailable', () => {
        it('should return false before loading', () => {
            expect(conversations.isAvailable()).toBe(false)
        })

        it('should return true after loading with valid config', () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-token',
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig({ ok: true, config: remoteConfig as RemoteConfig })

            expect(conversations.isAvailable()).toBe(true)
        })

        it('should return false when disabled in remote config', () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: false,
            }

            conversations.onRemoteConfig({ ok: true, config: remoteConfig as RemoteConfig })

            expect(conversations.isAvailable()).toBe(false)
        })
    })

    describe('isVisible', () => {
        it('should return false when manager is not loaded', () => {
            expect(conversations.isVisible()).toBe(false)
        })

        it('should delegate to manager when loaded', () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-token',
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig({ ok: true, config: remoteConfig as RemoteConfig })

            expect(conversations.isAvailable()).toBe(true)
            ;(mockManager.isVisible as VitestMock).mockReturnValue(true)
            expect(conversations.isVisible()).toBe(true)
            ;(mockManager.isVisible as VitestMock).mockReturnValue(false)
            expect(conversations.isVisible()).toBe(false)
        })
    })

    describe('domain filtering (now handled by ConversationsManager)', () => {
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

        // NOTE: Domain filtering is now done in ConversationsManager, not PostHogConversations
        // The bundle should always load when enabled=true, regardless of domain
        // The ConversationsManager decides whether to render the widget based on domain

        it('should load bundle regardless of domain (domain check moved to ConversationsManager)', () => {
            Object.defineProperty(window, 'location', {
                value: { hostname: 'other-site.com' },
                writable: true,
            })

            const mockInit = vi.fn().mockReturnValue(mockManager)
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

            conversations.onRemoteConfig({ ok: true, config: remoteConfig as RemoteConfig })

            // Bundle should still load - domain check is done in ConversationsManager
            expect(mockInit).toHaveBeenCalled()
            expect(conversations.isAvailable()).toBe(true)
        })
    })

    describe('identity handling', () => {
        it('should pass PostHog instance to initConversations for identity checks', () => {
            // Create a PostHog instance where _isIdentified returns true
            const identifiedPostHog = createMockPostHog({
                config: createMockConfig({
                    api_host: 'https://test.posthog.com',
                    token: 'test-token',
                    disable_conversations: false,
                }),
                persistence: createMockPersistence({
                    props: {},
                }),
                requestRouter: {
                    endpointFor: vi.fn().mockReturnValue('https://test.posthog.com/api/test'),
                } as any,
                consent: {
                    isOptedOut: vi.fn().mockReturnValue(false),
                } as any,
                get_distinct_id: vi.fn().mockReturnValue('identified-user-123'),
                on: vi.fn().mockReturnValue(vi.fn()),
                capture: vi.fn(),
                _isIdentified: vi.fn().mockReturnValue(true),
            })

            const mockInit = vi.fn().mockReturnValue(mockManager)
            assignableWindow.__PosthogExtensions__ = {
                initConversations: mockInit,
            }

            const identifiedConversations = new PostHogConversations(identifiedPostHog)

            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-token',
                } as ConversationsRemoteConfig,
            }

            identifiedConversations.onRemoteConfig({ ok: true, config: remoteConfig as RemoteConfig })

            // The initConversations is called with the PostHog instance
            // The ConversationsManager will use posthog._isIdentified() to determine
            // if the identification form should be shown
            expect(mockInit).toHaveBeenCalledWith(
                expect.objectContaining({ enabled: true, token: 'test-token' }),
                identifiedPostHog
            )
        })
    })
})
