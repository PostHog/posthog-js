/* eslint-disable compat/compat */
import { PostHogConversations, ConversationsApi, ConversationsManager } from '../../../posthog-conversations'
import { ConversationsRemoteConfig } from '../../../posthog-conversations-types'
import { PostHog } from '../../../posthog-core'
import { RemoteConfig } from '../../../types'
import { assignableWindow } from '../../../utils/globals'
import { createMockPostHog, createMockConfig, createMockPersistence } from '../../helpers/posthog-instance'
import { RequestRouter } from '../../../utils/request-router'

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
            requestRouter: new RequestRouter(mockPostHog as any),
            consent: {
                isOptedOut: jest.fn().mockReturnValue(false),
            } as any,
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
                mockPostHog,
                expect.objectContaining({ enabled: true, token: 'test-token' }),
                expect.any(Object)
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

    describe('API integration', () => {
        let capturedApi: ConversationsApi

        beforeEach(() => {
            assignableWindow.__PosthogExtensions__ = {
                initConversations: jest.fn((_instance, _config, api) => {
                    capturedApi = api
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

        describe('sendMessage', () => {
            it('should send message with correct payload including widget_session_id', async () => {
                ;(mockPostHog._send_request as jest.Mock).mockImplementation(({ callback }) => {
                    callback({
                        statusCode: 200,
                        json: {
                            ticket_id: 'ticket-123',
                            message_id: 'msg-456',
                            ticket_status: 'open',
                            created_at: '2023-01-01T00:00:00Z',
                        },
                    })
                })

                const result = await capturedApi.sendMessage('Hello!', undefined, undefined, 'test-widget-session-id')

                expect(mockPostHog._send_request).toHaveBeenCalledWith(
                    expect.objectContaining({
                        method: 'POST',
                        url: expect.stringContaining('/api/conversations/v1/widget/message'),
                        data: expect.objectContaining({
                            widget_session_id: 'test-widget-session-id',
                            distinct_id: 'test-distinct-id',
                            message: 'Hello!',
                            traits: expect.objectContaining({
                                name: 'Test User',
                                email: 'test@example.com',
                            }),
                        }),
                        headers: {
                            'X-Conversations-Token': 'test-conversations-token',
                        },
                    })
                )

                expect(result).toEqual({
                    ticket_id: 'ticket-123',
                    message_id: 'msg-456',
                    ticket_status: 'open',
                    created_at: '2023-01-01T00:00:00Z',
                })
            })

            it('should include ticket_id if provided', async () => {
                ;(mockPostHog._send_request as jest.Mock).mockImplementation(({ callback }) => {
                    callback({
                        statusCode: 200,
                        json: {
                            ticket_id: 'existing-ticket',
                            message_id: 'msg-456',
                            ticket_status: 'open',
                            created_at: '2023-01-01T00:00:00Z',
                        },
                    })
                })

                await capturedApi.sendMessage('Hello!', 'existing-ticket')

                expect(mockPostHog._send_request).toHaveBeenCalledWith(
                    expect.objectContaining({
                        data: expect.objectContaining({
                            ticket_id: 'existing-ticket',
                        }),
                    })
                )
            })

            it('should use user-provided traits over PostHog properties', async () => {
                ;(mockPostHog._send_request as jest.Mock).mockImplementation(({ callback }) => {
                    callback({
                        statusCode: 200,
                        json: {
                            ticket_id: 'ticket-123',
                            message_id: 'msg-456',
                            ticket_status: 'open',
                            created_at: '2023-01-01T00:00:00Z',
                        },
                    })
                })

                await capturedApi.sendMessage('Hello!', undefined, {
                    name: 'Override Name',
                    email: 'override@example.com',
                })

                expect(mockPostHog._send_request).toHaveBeenCalledWith(
                    expect.objectContaining({
                        data: expect.objectContaining({
                            traits: {
                                name: 'Override Name',
                                email: 'override@example.com',
                            },
                        }),
                    })
                )
            })

            it('should handle 429 rate limit error', async () => {
                ;(mockPostHog._send_request as jest.Mock).mockImplementation(({ callback }) => {
                    callback({
                        statusCode: 429,
                        json: {},
                    })
                })

                await expect(capturedApi.sendMessage('Hello!')).rejects.toThrow(
                    'Too many requests. Please wait before trying again.'
                )
            })

            it('should handle 4xx error', async () => {
                ;(mockPostHog._send_request as jest.Mock).mockImplementation(({ callback }) => {
                    callback({
                        statusCode: 400,
                        json: { detail: 'Invalid message' },
                    })
                })

                await expect(capturedApi.sendMessage('Hello!')).rejects.toThrow('Invalid message')
            })

            it('should handle invalid response', async () => {
                ;(mockPostHog._send_request as jest.Mock).mockImplementation(({ callback }) => {
                    callback({
                        statusCode: 200,
                        json: null,
                    })
                })

                await expect(capturedApi.sendMessage('Hello!')).rejects.toThrow('Invalid response from server')
            })
        })

        describe('getMessages', () => {
            it('should fetch messages with widget_session_id in query params', async () => {
                ;(mockPostHog._send_request as jest.Mock).mockImplementation(({ callback }) => {
                    callback({
                        statusCode: 200,
                        json: {
                            ticket_id: 'ticket-123',
                            ticket_status: 'open',
                            messages: [
                                {
                                    id: 'msg-1',
                                    content: 'Hello',
                                    author_type: 'customer',
                                    created_at: '2023-01-01T00:00:00Z',
                                    is_private: false,
                                },
                            ],
                            has_more: false,
                        },
                    })
                })

                const result = await capturedApi.getMessages('ticket-123', undefined, 'test-widget-session-id')

                expect(mockPostHog._send_request).toHaveBeenCalledWith(
                    expect.objectContaining({
                        method: 'GET',
                        url: expect.stringContaining('/api/conversations/v1/widget/messages/ticket-123'),
                        headers: {
                            'X-Conversations-Token': 'test-conversations-token',
                        },
                    })
                )

                // Verify widget_session_id is in URL
                const callArgs = (mockPostHog._send_request as jest.Mock).mock.calls[0][0]
                expect(callArgs.url).toContain('widget_session_id=test-widget-session-id')
                // Verify distinct_id is NOT in URL (access control is via widget_session_id only)
                expect(callArgs.url).not.toContain('distinct_id=')

                expect(result).toEqual({
                    ticket_id: 'ticket-123',
                    ticket_status: 'open',
                    messages: expect.arrayContaining([
                        expect.objectContaining({
                            id: 'msg-1',
                            content: 'Hello',
                        }),
                    ]),
                    has_more: false,
                })
            })

            it('should include after parameter for pagination', async () => {
                ;(mockPostHog._send_request as jest.Mock).mockImplementation(({ callback }) => {
                    callback({
                        statusCode: 200,
                        json: {
                            ticket_id: 'ticket-123',
                            ticket_status: 'open',
                            messages: [],
                            has_more: false,
                        },
                    })
                })

                await capturedApi.getMessages('ticket-123', 'cursor-456', 'test-widget-session-id')

                expect(mockPostHog._send_request).toHaveBeenCalledWith(
                    expect.objectContaining({
                        url: expect.stringContaining('after=cursor-456'),
                    })
                )
            })

            it('should handle 429 rate limit error', async () => {
                ;(mockPostHog._send_request as jest.Mock).mockImplementation(({ callback }) => {
                    callback({
                        statusCode: 429,
                        json: {},
                    })
                })

                await expect(capturedApi.getMessages('ticket-123')).rejects.toThrow(
                    'Too many requests. Please wait before trying again.'
                )
            })

            it('should handle 4xx error', async () => {
                ;(mockPostHog._send_request as jest.Mock).mockImplementation(({ callback }) => {
                    callback({
                        statusCode: 404,
                        json: { detail: 'Ticket not found' },
                    })
                })

                await expect(capturedApi.getMessages('ticket-123')).rejects.toThrow('Ticket not found')
            })

            it('should handle invalid response', async () => {
                ;(mockPostHog._send_request as jest.Mock).mockImplementation(({ callback }) => {
                    callback({
                        statusCode: 200,
                        json: null,
                    })
                })

                await expect(capturedApi.getMessages('ticket-123')).rejects.toThrow('Invalid response from server')
            })
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
