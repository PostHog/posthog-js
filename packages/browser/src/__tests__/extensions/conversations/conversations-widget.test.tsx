/* eslint-disable compat/compat */
import { render, fireEvent, waitFor } from '@testing-library/preact'
import '@testing-library/jest-dom'
import { ConversationsWidget } from '../../../extensions/conversations/external/components/ConversationsWidget'
import { ConversationsRemoteConfig } from '../../../posthog-conversations-types'

describe('ConversationsWidget restore request UI', () => {
    const config: ConversationsRemoteConfig = {
        enabled: true,
        token: 'test-token',
        widgetEnabled: true,
        greetingText: 'Hello!',
    }

    beforeEach(() => {
        Element.prototype.scrollIntoView = jest.fn()
    })

    it('should open restore request view from footer link', () => {
        const { getByText, getByPlaceholderText } = render(
            <ConversationsWidget
                config={config}
                initialState="open"
                onSendMessage={jest.fn().mockResolvedValue(undefined)}
                onRequestRestoreLink={jest.fn().mockResolvedValue({ ok: true })}
            />
        )

        fireEvent.click(getByText('Recover them here'))

        // Check that we're in the restore request view by looking for the email input
        expect(getByPlaceholderText('you@example.com')).toBeInTheDocument()
        expect(getByText('Send restore link')).toBeInTheDocument()
    })

    it('should require an email before restore request submit', async () => {
        const { getByText, findByText } = render(
            <ConversationsWidget
                config={config}
                initialState="open"
                onSendMessage={jest.fn().mockResolvedValue(undefined)}
                onRequestRestoreLink={jest.fn().mockResolvedValue({ ok: true })}
            />
        )

        fireEvent.click(getByText('Recover them here'))
        fireEvent.click(getByText('Send restore link'))

        expect(await findByText('Email is required')).toBeInTheDocument()
    })

    it('should request restore link and show success message', async () => {
        const onRequestRestoreLink = jest.fn().mockResolvedValue({ ok: true })
        const { getByText, getByPlaceholderText } = render(
            <ConversationsWidget
                config={config}
                initialState="open"
                onSendMessage={jest.fn().mockResolvedValue(undefined)}
                onRequestRestoreLink={onRequestRestoreLink}
            />
        )

        fireEvent.click(getByText('Recover them here'))
        fireEvent.input(getByPlaceholderText('you@example.com'), { target: { value: 'user@example.com' } })
        fireEvent.click(getByText('Send restore link'))

        await waitFor(() => {
            expect(onRequestRestoreLink).toHaveBeenCalledWith('user@example.com')
        })
        expect(
            getByText('Check your email for a secure restore link. If an account is found, we sent it.')
        ).toBeInTheDocument()
    })

    it('should return to ticket view when closing restore request with multiple tickets', () => {
        const onViewChange = jest.fn()
        const { getByText, getByLabelText } = render(
            <ConversationsWidget
                config={config}
                initialState="open"
                initialView="tickets"
                hasMultipleTickets={true}
                onSendMessage={jest.fn().mockResolvedValue(undefined)}
                onRequestRestoreLink={jest.fn().mockResolvedValue({ ok: true })}
                onViewChange={onViewChange}
            />
        )

        fireEvent.click(getByText('Recover them here'))
        fireEvent.click(getByLabelText('Back to conversations'))

        expect(onViewChange).toHaveBeenNthCalledWith(1, 'restore_request')
        expect(onViewChange).toHaveBeenNthCalledWith(2, 'tickets')
    })

    it('should hide recover footer when in identification view', () => {
        const { queryByText } = render(
            <ConversationsWidget
                config={{ ...config, requireEmail: true }}
                initialState="open"
                onSendMessage={jest.fn().mockResolvedValue(undefined)}
                onRequestRestoreLink={jest.fn().mockResolvedValue({ ok: true })}
                isUserIdentified={false}
                initialUserTraits={null}
            />
        )

        expect(queryByText('Recover them here')).not.toBeInTheDocument()
    })
})
