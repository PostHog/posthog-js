import { render, fireEvent, waitFor } from '@testing-library/preact'
import '@testing-library/jest-dom'
import { ConversationsWidget } from '../../../extensions/conversations/external/components/ConversationsWidget'
import { ConversationsRemoteConfig } from '../../../posthog-conversations-types'
import { createConversationsError } from '../../../extensions/conversations/external/errors'
import Config from '../../../config'

describe('ConversationsWidget', () => {
    const config: ConversationsRemoteConfig = {
        enabled: true,
        token: 'test-token',
        widgetEnabled: true,
        greetingText: 'Hello!',
    }

    beforeEach(() => {
        Element.prototype.scrollIntoView = vi.fn()
    })

    describe('greeting links', () => {
        function renderGreeting(greetingText: string) {
            return render(
                <ConversationsWidget
                    config={{ ...config, greetingText }}
                    initialState="open"
                    onSendMessage={vi.fn().mockResolvedValue(undefined)}
                />
            )
        }

        it('renders explicit links using the reply link styling and new-tab protections', () => {
            const { getByRole, getByText } = renderGreeting(
                'Welcome! Read [FAQ](https://example.com/faq?q=help&lang=en) or [contact us](mailto:help@example.com).'
            )
            const faq = getByRole('link', { name: 'FAQ' })
            expect(faq).toHaveAttribute('href', 'https://example.com/faq?q=help&lang=en')
            expect(faq).toHaveAttribute('target', '_blank')
            expect(faq).toHaveAttribute('rel', 'noopener noreferrer')
            expect(faq).toHaveAttribute('referrerpolicy', 'no-referrer')
            expect(faq).toHaveStyle({ textDecoration: 'underline' })
            expect(getByRole('link', { name: 'contact us' })).toHaveAttribute('href', 'mailto:help@example.com')
            expect(getByText(/Welcome! Read/)).toHaveTextContent('Welcome! Read FAQ or contact us.')
        })

        it('preserves plain text and newlines around links', () => {
            const { getByText, getByRole } = renderGreeting('Hello <friend> & welcome!\n\n[FAQ](/help)\nThank you.')
            const greeting = getByText(/Hello <friend>/)
            expect(greeting.textContent).toBe('Hello <friend> & welcome!FAQThank you.')
            expect(greeting.querySelectorAll('br')).toHaveLength(3)
            expect(getByRole('link', { name: 'FAQ' })).toHaveAttribute('href', '/help')
        })

        it.each([
            'Hello <friend> & welcome!\nHow can we help?',
            'Read https://example.com/faq first.',
            '**Hello** _there_',
            '[FAQ](https://example.com',
            '[FAQ]()',
            '[FAQ](https://example.com "title")',
            '[FAQ](https://example.com/a(b))',
            '[outer [FAQ](https://example.com)]',
            '![FAQ](https://example.com/image.png)',
            '\\[FAQ](https://example.com)',
        ])('preserves unsupported or plain text literally: %s', (greetingText) => {
            const { getByText, container } = renderGreeting(greetingText)
            expect(getByText(greetingText.replace(/\n/g, ''), { exact: true })).toBeInTheDocument()
            expect(container.querySelectorAll('a[href]')).toHaveLength(0)
        })

        it.each([
            'javascript:evil',
            'JaVaScRiPt:evil',
            'java\u0000script:evil',
            'java\u200bscript:evil',
            'java\tscript:evil',
            'java script:evil',
            'vbscript:evil',
            'data:text/html,evil',
            'file:///etc/passwd',
            '//example.com',
            'ftp://example.com',
            'javascript&#58;evil',
        ])('does not activate unsafe or unsupported URLs: %s', (url) => {
            const greetingText = `[FAQ](${url})`
            const { container } = renderGreeting(greetingText)
            expect(container.querySelectorAll('a[href]')).toHaveLength(0)
            expect(container.textContent).toContain(greetingText)
        })

        it('renders HTML and link labels as text, never as markup', () => {
            const { container, getByRole } = renderGreeting(
                '<script>alert(1)</script><img src=x onerror=alert(1)> [<b>FAQ</b>](https://example.com/"onclick="evil)'
            )
            expect(container.querySelectorAll('script, img, b, [onclick], [onerror]')).toHaveLength(0)
            expect(getByRole('link', { name: '<b>FAQ</b>' })).toHaveAttribute(
                'href',
                'https://example.com/"onclick="evil'
            )
            expect(container.textContent).toContain('<script>alert(1)</script><img src=x onerror=alert(1)>')
        })

        it('does not create a greeting for an empty string', () => {
            const { queryByText, getByPlaceholderText, container } = renderGreeting('')
            expect(queryByText('Support')).not.toBeInTheDocument()
            expect(getByPlaceholderText('Type your message...')).toBeInTheDocument()
            expect(container.querySelectorAll('a[href]')).toHaveLength(0)
        })
    })

    it('should open restore request view from footer link', () => {
        const { getByText, getByPlaceholderText } = render(
            <ConversationsWidget
                config={config}
                initialState="open"
                onSendMessage={vi.fn().mockResolvedValue(undefined)}
                onRequestRestoreLink={vi.fn().mockResolvedValue({ ok: true })}
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
                onSendMessage={vi.fn().mockResolvedValue(undefined)}
                onRequestRestoreLink={vi.fn().mockResolvedValue({ ok: true })}
            />
        )

        fireEvent.click(getByText('Recover them here'))
        fireEvent.click(getByText('Send restore link'))

        expect(await findByText('Email is required')).toBeInTheDocument()
    })

    it('should request restore link and show success message', async () => {
        const onRequestRestoreLink = vi.fn().mockResolvedValue({ ok: true })
        const { getByText, getByPlaceholderText } = render(
            <ConversationsWidget
                config={config}
                initialState="open"
                onSendMessage={vi.fn().mockResolvedValue(undefined)}
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

    it('should render handled restore failures without logging them again', async () => {
        const error = createConversationsError(
            'network',
            'Unable to reach the server. Please check your connection and try again.'
        )
        const previousDebug = Config.DEBUG
        Config.DEBUG = true
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        try {
            const { getByText, getByPlaceholderText, findByText } = render(
                <ConversationsWidget
                    config={config}
                    initialState="open"
                    onSendMessage={vi.fn().mockResolvedValue(undefined)}
                    onRequestRestoreLink={vi.fn().mockRejectedValue(error)}
                />
            )

            fireEvent.click(getByText('Recover them here'))
            fireEvent.input(getByPlaceholderText('you@example.com'), { target: { value: 'user@example.com' } })
            fireEvent.click(getByText('Send restore link'))

            expect(await findByText(error.message)).toBeInTheDocument()
            expect(errorSpy).not.toHaveBeenCalled()
        } finally {
            errorSpy.mockRestore()
            Config.DEBUG = previousDebug
        }
    })

    it('should return to ticket view when closing restore request with multiple tickets', () => {
        const onViewChange = vi.fn()
        const { getByText, getByLabelText } = render(
            <ConversationsWidget
                config={config}
                initialState="open"
                initialView="tickets"
                showTicketList={true}
                onSendMessage={vi.fn().mockResolvedValue(undefined)}
                onRequestRestoreLink={vi.fn().mockResolvedValue({ ok: true })}
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
                onSendMessage={vi.fn().mockResolvedValue(undefined)}
                onRequestRestoreLink={vi.fn().mockResolvedValue({ ok: true })}
                isUserIdentified={false}
                initialUserTraits={null}
            />
        )

        expect(queryByText('Recover them here')).not.toBeInTheDocument()
    })

    it('should render handled send failures without logging them again', async () => {
        const error = createConversationsError(
            'network',
            'Unable to reach the server. Please check your connection and try again.'
        )
        const previousDebug = Config.DEBUG
        Config.DEBUG = true
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        try {
            const { getByPlaceholderText, getByLabelText, findByText, queryByText } = render(
                <ConversationsWidget
                    config={config}
                    initialState="open"
                    onSendMessage={vi.fn().mockRejectedValue(error)}
                    onRequestRestoreLink={vi.fn().mockResolvedValue({ ok: true })}
                />
            )

            fireEvent.input(getByPlaceholderText('Type your message...'), {
                target: { value: 'A message that should be removed' },
            })
            fireEvent.click(getByLabelText('Send message'))

            expect(await findByText(error.message)).toBeInTheDocument()
            expect(queryByText('A message that should be removed')).not.toBeInTheDocument()
            expect(errorSpy).not.toHaveBeenCalled()
        } finally {
            errorSpy.mockRestore()
            Config.DEBUG = previousDebug
        }
    })

    it('should log unexpected send failures at error', async () => {
        const error = new Error('Unexpected send failure')
        const previousDebug = Config.DEBUG
        Config.DEBUG = true
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        try {
            const { getByPlaceholderText, getByLabelText, findByText } = render(
                <ConversationsWidget
                    config={config}
                    initialState="open"
                    onSendMessage={vi.fn().mockRejectedValue(error)}
                    onRequestRestoreLink={vi.fn().mockResolvedValue({ ok: true })}
                />
            )

            fireEvent.input(getByPlaceholderText('Type your message...'), {
                target: { value: 'Trigger an unexpected failure' },
            })
            fireEvent.click(getByLabelText('Send message'))

            expect(await findByText(error.message)).toBeInTheDocument()
            expect(errorSpy).toHaveBeenCalledWith(
                expect.stringContaining('[ConversationsWidget]'),
                'Failed to send message',
                error
            )
        } finally {
            errorSpy.mockRestore()
            Config.DEBUG = previousDebug
        }
    })
})
