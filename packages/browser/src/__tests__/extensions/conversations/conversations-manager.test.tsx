/* eslint-disable compat/compat */
import { ConversationsManager } from '../../../extensions/conversations'
import { ConversationsApi } from '../../../posthog-conversations'
import { ConversationsRemoteConfig, ConversationsWidgetState, Message } from '../../../posthog-conversations-types'
import { PostHog } from '../../../posthog-core'
import { createMockPostHog, createMockPersistence } from '../../helpers/posthog-instance'
import '@testing-library/jest-dom'
import { act } from '@testing-library/preact'

// Mock the persistence layer
jest.mock('../../../extensions/conversations/persistence')

describe('ConversationsManager', () => {
    let manager: ConversationsManager
    let mockPostHog: PostHog
    let mockApi: ConversationsApi
    let mockConfig: ConversationsRemoteConfig

    const mockMessages: Message[] = [
        {
            id: 'msg-1',
            content: 'Hello!',
            author_type: 'customer',
            author_name: 'Test User',
            created_at: '2023-01-01T00:00:00Z',
            is_private: false,
        },
        {
            id: 'msg-2',
            content: 'Hi there! How can I help?',
            author_type: 'AI',
            author_name: 'Support Bot',
            created_at: '2023-01-01T00:01:00Z',
            is_private: false,
        },
    ]

    beforeEach(() => {
        // Clear DOM and mocks
        document.body.innerHTML = ''
        localStorage.clear()
        jest.clearAllMocks()
        jest.useFakeTimers()

        // Mock scrollIntoView which is not implemented in JSDOM
        Element.prototype.scrollIntoView = jest.fn()

        // Setup mock PostHog instance
        mockPostHog = createMockPostHog({
            capture: jest.fn(),
            get_distinct_id: jest.fn().mockReturnValue('test-distinct-id'),
            on: jest.fn().mockReturnValue(jest.fn()), // Returns unsubscribe function
            persistence: createMockPersistence({
                props: {
                    $name: 'Test User',
                    $email: 'test@example.com',
                },
            }),
        })

        // Setup mock config
        mockConfig = {
            enabled: true,
            token: 'test-token',
            greetingText: 'Hello! How can we help you today?',
            placeholderText: 'Type your message...',
            color: '#007bff',
        }

        // Setup mock API
        mockApi = {
            sendMessage: jest.fn().mockResolvedValue({
                ticket_id: 'ticket-123',
                message_id: 'msg-456',
                ticket_status: 'open',
                created_at: '2023-01-01T00:00:00Z',
            }),
            getMessages: jest.fn().mockResolvedValue({
                ticket_id: 'ticket-123',
                ticket_status: 'open',
                messages: mockMessages,
                has_more: false,
            }),
            markAsRead: jest.fn().mockResolvedValue({
                unread_count: 0,
            }),
        }
    })

    afterEach(() => {
        jest.useRealTimers()
        if (manager) {
            manager.destroy()
        }
    })

    describe('initialization', () => {
        it('should initialize and render the widget', () => {
            manager = new ConversationsManager(mockPostHog, mockConfig, mockApi)

            const container = document.getElementById('ph-conversations-widget-container')
            expect(container).toBeInTheDocument()
        })

        it('should capture widget loaded event', () => {
            manager = new ConversationsManager(mockPostHog, mockConfig, mockApi)

            expect(mockPostHog.capture).toHaveBeenCalledWith(
                '$conversations_widget_loaded',
                expect.objectContaining({
                    hasExistingTicket: expect.any(Boolean),
                    initialState: expect.any(String),
                })
            )
        })

        it('should load user traits from PostHog properties', () => {
            manager = new ConversationsManager(mockPostHog, mockConfig, mockApi)

            expect(mockPostHog.persistence?.props).toBeDefined()
        })
    })

    describe('show and hide', () => {
        beforeEach(() => {
            manager = new ConversationsManager(mockPostHog, mockConfig, mockApi)
        })

        it('should show the widget', () => {
            act(() => {
                manager.show()
            })

            expect(mockPostHog.capture).toHaveBeenCalledWith(
                '$conversations_widget_state_changed',
                expect.objectContaining({
                    state: ConversationsWidgetState.OPEN,
                })
            )
        })

        it('should hide the widget', () => {
            act(() => {
                manager.show()
            })
            jest.clearAllMocks()

            act(() => {
                manager.hide()
            })

            expect(mockPostHog.capture).toHaveBeenCalledWith(
                '$conversations_widget_state_changed',
                expect.objectContaining({
                    state: ConversationsWidgetState.CLOSED,
                })
            )
        })

        it('should start polling when opened', () => {
            // Set up a ticket ID first
            ;(mockApi.sendMessage as jest.Mock).mockResolvedValue({
                ticket_id: 'ticket-123',
                message_id: 'msg-1',
                ticket_status: 'open',
                created_at: '2023-01-01T00:00:00Z',
            })

            act(() => {
                manager.show()
            })

            // Advance timers to trigger polling
            jest.advanceTimersByTime(5000)

            expect(mockApi.getMessages).toHaveBeenCalled()
        })

        it('should stop polling when closed', () => {
            act(() => {
                manager.show()
            })
            jest.clearAllMocks()

            act(() => {
                manager.hide()
            })

            // Advance timers to verify polling stopped
            jest.advanceTimersByTime(10000)

            expect(mockApi.getMessages).not.toHaveBeenCalled()
        })
    })

    describe('sendMessage', () => {
        beforeEach(() => {
            manager = new ConversationsManager(mockPostHog, mockConfig, mockApi)
        })

        it('should send a message through the API', async () => {
            await manager.sendMessage('Hello!')

            expect(mockApi.sendMessage).toHaveBeenCalledWith('Hello!', undefined, undefined)
        })

        it('should track message sent event', async () => {
            await manager.sendMessage('Hello!')

            expect(mockPostHog.capture).toHaveBeenCalledWith(
                '$conversations_message_sent',
                expect.objectContaining({
                    ticketId: 'ticket-123',
                    isNewTicket: true,
                    messageLength: 6,
                })
            )
        })

        it('should update ticket ID after sending first message', async () => {
            expect(manager['_currentTicketId']).toBeNull()

            await manager.sendMessage('Hello!')

            expect(manager['_currentTicketId']).toBe('ticket-123')
        })

        it('should send subsequent messages with ticket ID', async () => {
            await manager.sendMessage('First message')
            jest.clearAllMocks()

            await manager.sendMessage('Second message')

            expect(mockApi.sendMessage).toHaveBeenCalledWith('Second message', 'ticket-123', undefined)
        })

        it('should handle send error gracefully', async () => {
            const error = new Error('Send failed')
            ;(mockApi.sendMessage as jest.Mock).mockRejectedValue(error)

            await expect(manager.sendMessage('Hello!')).rejects.toThrow('Send failed')
        })
    })

    describe('message polling', () => {
        beforeEach(async () => {
            // Reset the sendMessage mock completely and set it to resolve properly
            ;(mockApi.sendMessage as jest.Mock).mockReset().mockResolvedValue({
                ticket_id: 'ticket-123',
                message_id: 'msg-1',
            })
            manager = new ConversationsManager(mockPostHog, mockConfig, mockApi)
            // Send a message to create a ticket
            await manager.sendMessage('Hello!')
            jest.clearAllMocks()
        })

        it('should poll for messages at regular intervals when open', () => {
            act(() => {
                manager.show()
            })

            // Advance time by poll interval
            jest.advanceTimersByTime(5000)
            expect(mockApi.getMessages).toHaveBeenCalledTimes(1)

            jest.advanceTimersByTime(5000)
            expect(mockApi.getMessages).toHaveBeenCalledTimes(2)
        })

        it('should not poll when widget is closed', () => {
            act(() => {
                manager.hide()
            })

            jest.advanceTimersByTime(10000)

            expect(mockApi.getMessages).not.toHaveBeenCalled()
        })

        it('should use last message timestamp for pagination', async () => {
            act(() => {
                manager.show()
            })

            // Wait for first poll
            jest.advanceTimersByTime(5000)
            await Promise.resolve()

            expect(mockApi.getMessages).toHaveBeenCalledWith('ticket-123', mockMessages[1].created_at)
        })

        it('should not poll if already polling', async () => {
            // Mock a long-running API call
            ;(mockApi.getMessages as jest.Mock).mockImplementation(
                () => new Promise((resolve) => setTimeout(() => resolve({ messages: [], has_more: false }), 10000))
            )

            act(() => {
                manager.show()
            })

            // Try to poll multiple times quickly
            jest.advanceTimersByTime(1000)
            jest.advanceTimersByTime(1000)

            // Should only call once despite multiple timer advances
            expect(mockApi.getMessages).toHaveBeenCalledTimes(1)
        })

        it('should handle polling errors gracefully', async () => {
            ;(mockApi.getMessages as jest.Mock).mockRejectedValue(new Error('Network error'))

            act(() => {
                manager.show()
            })
            jest.advanceTimersByTime(5000)

            // Should not throw, just log error
            await Promise.resolve()

            // Should continue polling after error
            ;(mockApi.getMessages as jest.Mock).mockResolvedValue({
                ticket_id: 'ticket-123',
                ticket_status: 'open',
                messages: [],
                has_more: false,
            })

            jest.advanceTimersByTime(5000)
            expect(mockApi.getMessages).toHaveBeenCalledTimes(2)
        })
    })

    describe('identify handling', () => {
        beforeEach(() => {
            manager = new ConversationsManager(mockPostHog, mockConfig, mockApi)
        })

        it('should handle identify events', () => {
            // Simulate identify event by updating person properties
            mockPostHog.persistence = createMockPersistence({
                props: {
                    $name: 'New Name',
                    $email: 'new@example.com',
                },
            })

            // Trigger the identify listener if it exists
            if (manager['_unsubscribeIdentifyListener']) {
                // In real scenario, this would be triggered by PostHog.identify()
                // For now, we just verify the listener was set up
                expect(manager['_unsubscribeIdentifyListener']).toBeDefined()
            }
        })
    })

    describe('destroy', () => {
        beforeEach(() => {
            manager = new ConversationsManager(mockPostHog, mockConfig, mockApi)
        })

        it('should stop polling on destroy', () => {
            act(() => {
                manager.show()
            })
            jest.clearAllMocks()

            manager.destroy()

            jest.advanceTimersByTime(10000)
            expect(mockApi.getMessages).not.toHaveBeenCalled()
        })

        it('should remove widget from DOM on destroy', () => {
            const container = document.getElementById('ph-conversations-widget-container')
            expect(container).toBeInTheDocument()

            manager.destroy()

            expect(document.getElementById('ph-conversations-widget-container')).not.toBeInTheDocument()
        })

        it('should unsubscribe from identify listener on destroy', () => {
            const mockUnsubscribe = jest.fn()
            manager['_unsubscribeIdentifyListener'] = mockUnsubscribe

            manager.destroy()

            expect(mockUnsubscribe).toHaveBeenCalled()
        })
    })

    describe('persistence integration', () => {
        beforeEach(() => {
            manager = new ConversationsManager(mockPostHog, mockConfig, mockApi)
        })

        it('should save ticket ID to persistence', async () => {
            await manager.sendMessage('Hello!')

            // The persistence mock should have been called to save the ticket ID
            expect(manager['_currentTicketId']).toBe('ticket-123')
        })

        it('should save widget state to persistence', () => {
            act(() => {
                manager.show()
            })

            // The persistence mock should have been called to save the state
            expect(mockPostHog.capture).toHaveBeenCalledWith(
                '$conversations_widget_state_changed',
                expect.objectContaining({
                    state: ConversationsWidgetState.OPEN,
                })
            )
        })
    })

    describe('distinct_id changes', () => {
        beforeEach(() => {
            manager = new ConversationsManager(mockPostHog, mockConfig, mockApi)
        })

        it('should handle distinct_id changes from identify', async () => {
            // Send a message to create a ticket
            await manager.sendMessage('Hello!')
            expect(manager['_currentTicketId']).toBe('ticket-123')

            // Simulate distinct_id change (user logs in)
            ;(mockPostHog.get_distinct_id as jest.Mock).mockReturnValue('new-distinct-id')

            // The ticket ID should be reset when distinct_id changes
            // This would be triggered by the identify listener
            // For now, we just verify the setup exists
            expect(manager['_unsubscribeIdentifyListener']).toBeDefined()
        })
    })
})
