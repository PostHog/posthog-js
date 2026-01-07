/* eslint-disable compat/compat */
import { PostHogConversations, ConversationsManager } from '../../../extensions/conversations/posthog-conversations'
import {
    ConversationsRemoteConfig,
    SendMessageResponse,
    GetMessagesResponse,
    MarkAsReadResponse,
    GetTicketsResponse,
    UserProvidedTraits,
} from '../../../posthog-conversations-types'
import { PostHog } from '../../../posthog-core'
import { RemoteConfig } from '../../../types'
import { assignableWindow } from '../../../utils/globals'
import { createMockPostHog, createMockConfig, createMockPersistence } from '../../helpers/posthog-instance'
import Config from '../../../config'

describe('Conversations API Methods', () => {
    let conversations: PostHogConversations
    let mockPostHog: PostHog
    let mockManager: ConversationsManager
    let consoleWarnSpy: jest.SpyInstance

    beforeEach(() => {
        // Clear localStorage
        localStorage.clear()
        jest.clearAllMocks()

        // Enable debug mode so logger actually logs
        Config.DEBUG = true

        // Spy on console.warn
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()

        // Setup mock manager with API methods
        mockManager = {
            show: jest.fn(),
            hide: jest.fn(),
            reset: jest.fn(),
            isVisible: jest.fn().mockReturnValue(true),
            sendMessage: jest.fn(),
            getMessages: jest.fn(),
            markAsRead: jest.fn(),
            getTickets: jest.fn(),
            getCurrentTicketId: jest.fn(),
            getWidgetSessionId: jest.fn(),
        } as unknown as ConversationsManager

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
            on: jest.fn().mockReturnValue(jest.fn()),
        })

        // Setup PostHog extensions
        assignableWindow.__PosthogExtensions__ = {
            initConversations: undefined,
            loadExternalDependency: jest.fn((_instance, _path, callback) => {
                assignableWindow.__PosthogExtensions__!.initConversations = jest.fn().mockReturnValue(mockManager)
                callback(null)
            }),
        }

        conversations = new PostHogConversations(mockPostHog)
    })

    afterEach(() => {
        consoleWarnSpy.mockRestore()
        Config.DEBUG = false
    })

    describe('Lazy Loading Behavior', () => {
        it('should return null from sendMessage when conversations not available', async () => {
            const result = await conversations.sendMessage('Hello')

            expect(result).toBeNull()
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                '[PostHog.js] [Conversations]',
                expect.stringContaining('Conversations not available yet')
            )
        })

        it('should return null from getMessages when conversations not available', async () => {
            const result = await conversations.getMessages()

            expect(result).toBeNull()
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                '[PostHog.js] [Conversations]',
                expect.stringContaining('Conversations not available yet')
            )
        })

        it('should return null from markAsRead when conversations not available', async () => {
            const result = await conversations.markAsRead()

            expect(result).toBeNull()
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                '[PostHog.js] [Conversations]',
                expect.stringContaining('Conversations not available yet')
            )
        })

        it('should return null from getTickets when conversations not available', async () => {
            const result = await conversations.getTickets()

            expect(result).toBeNull()
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                '[PostHog.js] [Conversations]',
                expect.stringContaining('Conversations not available yet')
            )
        })

        it('should return null from getCurrentTicketId when conversations not available', () => {
            const result = conversations.getCurrentTicketId()

            expect(result).toBeNull()
            expect(consoleWarnSpy).not.toHaveBeenCalled() // Safe method, no warning
        })

        it('should return null from getWidgetSessionId when conversations not available', () => {
            const result = conversations.getWidgetSessionId()

            expect(result).toBeNull()
            expect(consoleWarnSpy).not.toHaveBeenCalled() // Safe method, no warning
        })
    })

    describe('API Methods After Loading', () => {
        beforeEach(async () => {
            // Load conversations
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-conversations-token',
                    widgetEnabled: false,
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)
            await conversations.loadIfEnabled()
        })

        describe('sendMessage', () => {
            it('should send a message and create a new ticket', async () => {
                const mockResponse: SendMessageResponse = {
                    ticket_id: 'ticket-123',
                    message_id: 'msg-456',
                    ticket_status: 'open',
                    created_at: '2024-01-01T00:00:00Z',
                    unread_count: 0,
                }

                ;(mockManager.sendMessage as jest.Mock).mockResolvedValue(mockResponse)

                const result = await conversations.sendMessage('Hello!')

                expect(result).toEqual(mockResponse)
                expect(mockManager.sendMessage).toHaveBeenCalledWith('Hello!', undefined, undefined)
            })

            it('should send a message with user traits', async () => {
                const mockResponse: SendMessageResponse = {
                    ticket_id: 'ticket-123',
                    message_id: 'msg-456',
                    ticket_status: 'open',
                    created_at: '2024-01-01T00:00:00Z',
                    unread_count: 0,
                }

                const userTraits: UserProvidedTraits = {
                    name: 'John Doe',
                    email: 'john@example.com',
                }

                ;(mockManager.sendMessage as jest.Mock).mockResolvedValue(mockResponse)

                const result = await conversations.sendMessage('Hello!', userTraits)

                expect(result).toEqual(mockResponse)
                expect(mockManager.sendMessage).toHaveBeenCalledWith('Hello!', userTraits, undefined)
            })

            it('should force creation of a new ticket when newTicket is true', async () => {
                const mockResponse: SendMessageResponse = {
                    ticket_id: 'ticket-789',
                    message_id: 'msg-999',
                    ticket_status: 'open',
                    created_at: '2024-01-01T00:00:00Z',
                    unread_count: 0,
                }

                ;(mockManager.sendMessage as jest.Mock).mockResolvedValue(mockResponse)

                const result = await conversations.sendMessage('Start new conversation', undefined, true)

                expect(result).toEqual(mockResponse)
                expect(mockManager.sendMessage).toHaveBeenCalledWith('Start new conversation', undefined, true)
            })

            it('should force creation of a new ticket with user traits', async () => {
                const mockResponse: SendMessageResponse = {
                    ticket_id: 'ticket-new',
                    message_id: 'msg-new',
                    ticket_status: 'open',
                    created_at: '2024-01-01T00:00:00Z',
                    unread_count: 0,
                }

                const userTraits: UserProvidedTraits = {
                    name: 'Jane Doe',
                    email: 'jane@example.com',
                }

                ;(mockManager.sendMessage as jest.Mock).mockResolvedValue(mockResponse)

                const result = await conversations.sendMessage('New ticket please', userTraits, true)

                expect(result).toEqual(mockResponse)
                expect(mockManager.sendMessage).toHaveBeenCalledWith('New ticket please', userTraits, true)
            })
        })

        describe('getMessages', () => {
            it('should get messages for current ticket', async () => {
                const mockResponse: GetMessagesResponse = {
                    ticket_id: 'ticket-123',
                    ticket_status: 'open',
                    messages: [
                        {
                            id: 'msg-1',
                            content: 'Hello',
                            author_type: 'customer',
                            created_at: '2024-01-01T00:00:00Z',
                            is_private: false,
                        },
                    ],
                    has_more: false,
                    unread_count: 0,
                }

                ;(mockManager.getMessages as jest.Mock).mockResolvedValue(mockResponse)

                const result = await conversations.getMessages()

                expect(result).toEqual(mockResponse)
                expect(mockManager.getMessages).toHaveBeenCalledWith(undefined, undefined)
            })

            it('should get messages for specific ticket', async () => {
                const mockResponse: GetMessagesResponse = {
                    ticket_id: 'ticket-456',
                    ticket_status: 'open',
                    messages: [],
                    has_more: false,
                    unread_count: 0,
                }

                ;(mockManager.getMessages as jest.Mock).mockResolvedValue(mockResponse)

                const result = await conversations.getMessages('ticket-456')

                expect(result).toEqual(mockResponse)
                expect(mockManager.getMessages).toHaveBeenCalledWith('ticket-456', undefined)
            })

            it('should get messages after a specific timestamp', async () => {
                const mockResponse: GetMessagesResponse = {
                    ticket_id: 'ticket-123',
                    ticket_status: 'open',
                    messages: [],
                    has_more: false,
                    unread_count: 0,
                }

                const afterTimestamp = '2024-01-01T12:00:00Z'

                ;(mockManager.getMessages as jest.Mock).mockResolvedValue(mockResponse)

                const result = await conversations.getMessages(undefined, afterTimestamp)

                expect(result).toEqual(mockResponse)
                expect(mockManager.getMessages).toHaveBeenCalledWith(undefined, afterTimestamp)
            })
        })

        describe('markAsRead', () => {
            it('should mark messages as read for current ticket', async () => {
                const mockResponse: MarkAsReadResponse = {
                    success: true,
                    unread_count: 0,
                }

                ;(mockManager.markAsRead as jest.Mock).mockResolvedValue(mockResponse)

                const result = await conversations.markAsRead()

                expect(result).toEqual(mockResponse)
                expect(mockManager.markAsRead).toHaveBeenCalledWith(undefined)
            })

            it('should mark messages as read for specific ticket', async () => {
                const mockResponse: MarkAsReadResponse = {
                    success: true,
                    unread_count: 0,
                }

                ;(mockManager.markAsRead as jest.Mock).mockResolvedValue(mockResponse)

                const result = await conversations.markAsRead('ticket-789')

                expect(result).toEqual(mockResponse)
                expect(mockManager.markAsRead).toHaveBeenCalledWith('ticket-789')
            })
        })

        describe('getTickets', () => {
            it('should get list of tickets with default options', async () => {
                const mockResponse: GetTicketsResponse = {
                    count: 2,
                    results: [
                        {
                            id: 'ticket-1',
                            status: 'open',
                            unread_count: 1,
                            last_message: 'Hello',
                            last_message_at: '2024-01-01T00:00:00Z',
                            message_count: 5,
                            created_at: '2024-01-01T00:00:00Z',
                        },
                        {
                            id: 'ticket-2',
                            status: 'resolved',
                            unread_count: 0,
                            last_message: 'Thanks!',
                            last_message_at: '2024-01-02T00:00:00Z',
                            message_count: 10,
                            created_at: '2024-01-02T00:00:00Z',
                        },
                    ],
                }

                ;(mockManager.getTickets as jest.Mock).mockResolvedValue(mockResponse)

                const result = await conversations.getTickets()

                expect(result).toEqual(mockResponse)
                expect(mockManager.getTickets).toHaveBeenCalledWith(undefined)
            })

            it('should get tickets with pagination options', async () => {
                const mockResponse: GetTicketsResponse = {
                    count: 100,
                    results: [],
                }

                ;(mockManager.getTickets as jest.Mock).mockResolvedValue(mockResponse)

                const result = await conversations.getTickets({
                    limit: 10,
                    offset: 20,
                })

                expect(result).toEqual(mockResponse)
                expect(mockManager.getTickets).toHaveBeenCalledWith({
                    limit: 10,
                    offset: 20,
                })
            })

            it('should get tickets filtered by status', async () => {
                const mockResponse: GetTicketsResponse = {
                    count: 5,
                    results: [],
                }

                ;(mockManager.getTickets as jest.Mock).mockResolvedValue(mockResponse)

                const result = await conversations.getTickets({
                    status: 'open',
                    limit: 20,
                    offset: 0,
                })

                expect(result).toEqual(mockResponse)
                expect(mockManager.getTickets).toHaveBeenCalledWith({
                    status: 'open',
                    limit: 20,
                    offset: 0,
                })
            })
        })

        describe('getCurrentTicketId', () => {
            it('should return current ticket ID when available', () => {
                ;(mockManager.getCurrentTicketId as jest.Mock).mockReturnValue('ticket-abc')

                const result = conversations.getCurrentTicketId()

                expect(result).toBe('ticket-abc')
                expect(mockManager.getCurrentTicketId).toHaveBeenCalled()
            })

            it('should return null when no active ticket', () => {
                ;(mockManager.getCurrentTicketId as jest.Mock).mockReturnValue(null)

                const result = conversations.getCurrentTicketId()

                expect(result).toBeNull()
                expect(mockManager.getCurrentTicketId).toHaveBeenCalled()
            })
        })

        describe('getWidgetSessionId', () => {
            it('should return widget session ID', () => {
                ;(mockManager.getWidgetSessionId as jest.Mock).mockReturnValue('session-xyz')

                const result = conversations.getWidgetSessionId()

                expect(result).toBe('session-xyz')
                expect(mockManager.getWidgetSessionId).toHaveBeenCalled()
            })
        })
    })

    describe('Error Handling', () => {
        beforeEach(async () => {
            // Load conversations
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-conversations-token',
                    widgetEnabled: false,
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)
            await conversations.loadIfEnabled()
        })

        it('should handle sendMessage errors', async () => {
            const error = new Error('Network error')
            ;(mockManager.sendMessage as jest.Mock).mockRejectedValue(error)

            await expect(conversations.sendMessage('Hello')).rejects.toThrow('Network error')
        })

        it('should handle getMessages errors', async () => {
            const error = new Error('Ticket not found')
            ;(mockManager.getMessages as jest.Mock).mockRejectedValue(error)

            await expect(conversations.getMessages('invalid-ticket')).rejects.toThrow('Ticket not found')
        })

        it('should handle markAsRead errors', async () => {
            const error = new Error('Failed to mark as read')
            ;(mockManager.markAsRead as jest.Mock).mockRejectedValue(error)

            await expect(conversations.markAsRead('ticket-123')).rejects.toThrow('Failed to mark as read')
        })

        it('should handle getTickets errors', async () => {
            const error = new Error('Failed to fetch tickets')
            ;(mockManager.getTickets as jest.Mock).mockRejectedValue(error)

            await expect(conversations.getTickets()).rejects.toThrow('Failed to fetch tickets')
        })
    })

    describe('Integration with show()', () => {
        it('should return null before remote config is loaded', async () => {
            // Before remote config, API methods return null
            expect(await conversations.sendMessage('Test')).toBeNull()
            expect(conversations.isAvailable()).toBe(false)
        })

        it('should load conversations when remote config is set and allow API usage', async () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-conversations-token',
                    widgetEnabled: false,
                } as ConversationsRemoteConfig,
            }

            // onRemoteConfig automatically calls loadIfEnabled()
            conversations.onRemoteConfig(remoteConfig as RemoteConfig)

            // Wait a tick for the loading to complete
            await new Promise((resolve) => setTimeout(resolve, 0))

            // After loading, conversations should be available
            expect(conversations.isAvailable()).toBe(true)

            // After loading, API methods work
            const mockResponse: SendMessageResponse = {
                ticket_id: 'ticket-123',
                message_id: 'msg-456',
                ticket_status: 'open',
                created_at: '2024-01-01T00:00:00Z',
                unread_count: 0,
            }

            ;(mockManager.sendMessage as jest.Mock).mockResolvedValue(mockResponse)

            const result = await conversations.sendMessage('Test')
            expect(result).toEqual(mockResponse)
        })
    })

    describe('isAvailable helper', () => {
        it('should return false when conversations not available', () => {
            expect(conversations.isAvailable()).toBe(false)
        })

        it('should return true when conversations available', async () => {
            const remoteConfig: Partial<RemoteConfig> = {
                conversations: {
                    enabled: true,
                    token: 'test-conversations-token',
                    widgetEnabled: false,
                } as ConversationsRemoteConfig,
            }

            conversations.onRemoteConfig(remoteConfig as RemoteConfig)
            await conversations.loadIfEnabled()

            expect(conversations.isAvailable()).toBe(true)
        })
    })
})
