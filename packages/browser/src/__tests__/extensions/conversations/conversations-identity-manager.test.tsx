/* eslint-disable compat/compat */
import { ConversationsManager } from '../../../extensions/conversations/external'
import { ConversationsRemoteConfig } from '../../../posthog-conversations-types'
import { PostHog } from '../../../posthog-core'
import '@testing-library/jest-dom'
import { act } from '@testing-library/preact'

jest.mock('../../../extensions/conversations/external/persistence', () => {
    return {
        ConversationsPersistence: jest.fn().mockImplementation(() => {
            let storedTicketId: string | null = null
            return {
                getOrCreateWidgetSessionId: jest.fn().mockReturnValue('test-widget-session-id'),
                setWidgetSessionId: jest.fn(),
                loadTicketId: jest.fn(() => storedTicketId),
                saveTicketId: jest.fn((ticketId: string) => {
                    storedTicketId = ticketId
                }),
                clearTicketId: jest.fn(() => {
                    storedTicketId = null
                }),
                loadWidgetState: jest.fn().mockReturnValue('closed'),
                saveWidgetState: jest.fn(),
                loadUserTraits: jest.fn().mockReturnValue(null),
                saveUserTraits: jest.fn(),
                clearWidgetSessionId: jest.fn(),
                clearAll: jest.fn(() => {
                    storedTicketId = null
                }),
            }
        }),
    }
})

describe('ConversationsManager Identity Verification', () => {
    let manager: ConversationsManager
    let mockPosthog: PostHog
    let mockConfig: ConversationsRemoteConfig

    const createMockGetTicketsResponse = () => ({
        results: [],
        has_more: false,
    })

    beforeEach(() => {
        document.body.innerHTML = ''
        localStorage.clear()
        jest.clearAllMocks()
        jest.useFakeTimers()
        window.history.replaceState({}, '', '/')

        Element.prototype.scrollIntoView = jest.fn()

        mockConfig = {
            enabled: true,
            widgetEnabled: false,
            token: 'test-token',
        }

        mockPosthog = {
            config: {
                token: 'test-token',
                api_host: 'https://test.posthog.com',
            },
            _send_request: jest.fn((options) => {
                const url = options.url as string
                const method = options.method as string
                if (url.includes('/widget/tickets') && method === 'GET') {
                    options.callback({
                        statusCode: 200,
                        json: createMockGetTicketsResponse(),
                    })
                } else if (method === 'POST' && url.endsWith('/widget/message')) {
                    options.callback({
                        statusCode: 200,
                        json: {
                            ticket_id: 'ticket-123',
                            message_id: 'msg-456',
                            ticket_status: 'open',
                            created_at: '2023-01-01T00:00:00Z',
                            unread_count: 0,
                        },
                    })
                } else if (url.includes('/read') && method === 'POST') {
                    options.callback({
                        statusCode: 200,
                        json: { success: true, unread_count: 0 },
                    })
                } else if (url.includes('/widget/messages/') && method === 'GET') {
                    options.callback({
                        statusCode: 200,
                        json: {
                            ticket_id: 'ticket-123',
                            ticket_status: 'open',
                            messages: [],
                            has_more: false,
                            unread_count: 0,
                        },
                    })
                }
            }),
            requestRouter: {
                endpointFor: jest.fn((_type: string, path: string) => `https://test.posthog.com${path}`),
            },
            get_distinct_id: jest.fn().mockReturnValue('test-distinct-id'),
            get_property: jest.fn().mockReturnValue(undefined),
            get_session_id: jest.fn().mockReturnValue('test-session-id'),
            get_session_replay_url: jest.fn().mockReturnValue(null),
            persistence: {
                props: {},
                get_property: jest.fn(),
                register: jest.fn(),
                unregister: jest.fn(),
                isDisabled: jest.fn().mockReturnValue(false),
            },
            capture: jest.fn(),
            on: jest.fn().mockReturnValue(jest.fn()),
            _isIdentified: jest.fn().mockReturnValue(false),
        } as unknown as PostHog
    })

    afterEach(() => {
        jest.useRealTimers()
        if (manager) {
            manager.destroy()
        }
    })

    const flushPromises = async () => {
        await act(async () => {
            await Promise.resolve()
            jest.runAllTimers()
        })
    }

    describe('init-time identity from config', () => {
        it('should read identity from top-level posthog.config during construction', () => {
            ;(mockPosthog as any).config.identity_distinct_id = 'user_123'
            ;(mockPosthog as any).config.identity_hash = 'abc123hash'

            manager = new ConversationsManager(mockConfig, mockPosthog)

            expect(manager['_identityConfig']).toEqual({
                identity_distinct_id: 'user_123',
                identity_hash: 'abc123hash',
            })
        })

        it('should skip restore token when identity config is set', async () => {
            window.history.replaceState({}, '', '/?ph_conv_restore=restore-token-1')
            ;(mockPosthog as any).config.identity_distinct_id = 'user_123'
            ;(mockPosthog as any).config.identity_hash = 'abc123hash'

            manager = new ConversationsManager(mockConfig, mockPosthog)
            await flushPromises()

            // Should NOT call the restore endpoint
            const calls = (mockPosthog._send_request as jest.Mock).mock.calls
            const restoreCalls = calls.filter(
                (c: any) => c[0].url?.includes('/widget/restore') && c[0].method === 'POST'
            )
            expect(restoreCalls).toHaveLength(0)
        })

        it('should not set identity when config fields are undefined', () => {
            manager = new ConversationsManager(mockConfig, mockPosthog)

            expect(manager['_identityConfig']).toBeNull()
        })

        it('should not set identity when only one config field is set', () => {
            ;(mockPosthog as any).config.identity_distinct_id = 'user_123'

            manager = new ConversationsManager(mockConfig, mockPosthog)

            expect(manager['_identityConfig']).toBeNull()
        })
    })

    describe('setIdentity / clearIdentity', () => {
        beforeEach(() => {
            manager = new ConversationsManager(mockConfig, mockPosthog)
        })

        it('should store identity config', () => {
            manager.setIdentity({
                identity_distinct_id: 'user_456',
                identity_hash: 'def456hash',
            })

            expect(manager['_identityConfig']).toEqual({
                identity_distinct_id: 'user_456',
                identity_hash: 'def456hash',
            })
        })

        it('should trigger ticket reload on setIdentity', () => {
            jest.clearAllMocks()

            manager.setIdentity({
                identity_distinct_id: 'user_456',
                identity_hash: 'def456hash',
            })

            const calls = (mockPosthog._send_request as jest.Mock).mock.calls
            const ticketCalls = calls.filter((c: any) => c[0].url?.includes('/widget/tickets'))
            expect(ticketCalls.length).toBeGreaterThan(0)
        })

        it('should clear identity config on clearIdentity', () => {
            manager.setIdentity({
                identity_distinct_id: 'user_456',
                identity_hash: 'def456hash',
            })

            manager.clearIdentity()

            expect(manager['_identityConfig']).toBeNull()
        })

        it('should clear identity on reset', () => {
            manager.setIdentity({
                identity_distinct_id: 'user_456',
                identity_hash: 'def456hash',
            })

            manager.reset()

            expect(manager['_identityConfig']).toBeNull()
        })
    })

    describe('API calls in identity mode', () => {
        beforeEach(() => {
            ;(mockPosthog as any).config.identity_distinct_id = 'user_123'
            ;(mockPosthog as any).config.identity_hash = 'abc123hash'
            manager = new ConversationsManager(mockConfig, mockPosthog)
            jest.clearAllMocks()
        })

        it('sendMessage should include identity fields instead of widget_session_id', async () => {
            await act(async () => {
                await manager.sendMessage('Hello!')
            })

            const call = (mockPosthog._send_request as jest.Mock).mock.calls.find(
                (c: any) => c[0].url?.includes('/widget/message') && c[0].method === 'POST'
            )
            expect(call).toBeDefined()
            const data = call[0].data
            expect(data.identity_distinct_id).toBe('user_123')
            expect(data.identity_hash).toBe('abc123hash')
            expect(data.distinct_id).toBe('user_123')
            expect(data.widget_session_id).toBeUndefined()
        })

        it('getMessages should include identity fields in query params', async () => {
            await act(async () => {
                await manager.getMessages('ticket-123')
            })

            const call = (mockPosthog._send_request as jest.Mock).mock.calls.find(
                (c: any) => c[0].url?.includes('/widget/messages/ticket-123') && c[0].method === 'GET'
            )
            expect(call).toBeDefined()
            const url = call[0].url as string
            expect(url).toContain('identity_distinct_id=user_123')
            expect(url).toContain('identity_hash=abc123hash')
            expect(url).not.toContain('widget_session_id')
        })

        it('markAsRead should include identity fields in body', async () => {
            await act(async () => {
                await manager.markAsRead('ticket-123')
            })

            const call = (mockPosthog._send_request as jest.Mock).mock.calls.find(
                (c: any) => c[0].url?.includes('/read') && c[0].method === 'POST'
            )
            expect(call).toBeDefined()
            const data = call[0].data
            expect(data.identity_distinct_id).toBe('user_123')
            expect(data.identity_hash).toBe('abc123hash')
            expect(data.widget_session_id).toBeUndefined()
        })

        it('getTickets should include identity fields in query params', async () => {
            await act(async () => {
                await manager.getTickets()
            })

            const call = (mockPosthog._send_request as jest.Mock).mock.calls.find(
                (c: any) => c[0].url?.includes('/widget/tickets') && c[0].method === 'GET'
            )
            expect(call).toBeDefined()
            const url = call[0].url as string
            expect(url).toContain('identity_distinct_id=user_123')
            expect(url).toContain('identity_hash=abc123hash')
            expect(url).not.toContain('widget_session_id')
        })
    })

    describe('API calls in legacy mode (no identity)', () => {
        beforeEach(() => {
            manager = new ConversationsManager(mockConfig, mockPosthog)
            jest.clearAllMocks()
        })

        it('sendMessage should include widget_session_id', async () => {
            await act(async () => {
                await manager.sendMessage('Hello!')
            })

            const call = (mockPosthog._send_request as jest.Mock).mock.calls.find(
                (c: any) => c[0].url?.includes('/widget/message') && c[0].method === 'POST'
            )
            expect(call).toBeDefined()
            const data = call[0].data
            expect(data.widget_session_id).toBe('test-widget-session-id')
            expect(data.distinct_id).toBe('test-distinct-id')
            expect(data.identity_distinct_id).toBeUndefined()
            expect(data.identity_hash).toBeUndefined()
        })

        it('getTickets should include widget_session_id in query params', async () => {
            await act(async () => {
                await manager.getTickets()
            })

            const call = (mockPosthog._send_request as jest.Mock).mock.calls.find(
                (c: any) => c[0].url?.includes('/widget/tickets') && c[0].method === 'GET'
            )
            expect(call).toBeDefined()
            const url = call[0].url as string
            expect(url).toContain('widget_session_id=test-widget-session-id')
            expect(url).not.toContain('identity_distinct_id')
            expect(url).not.toContain('identity_hash')
        })
    })
})
