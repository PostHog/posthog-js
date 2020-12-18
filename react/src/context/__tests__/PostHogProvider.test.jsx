import React, { useContext } from 'react'
import { render } from '@testing-library/react'
import { PostHogProvider, getPostHogContext } from '..'

describe('PostHogProvider component', () => {
    given('render', () => () =>
        render(<PostHogProvider client={given.posthog}>{given.childComponent}</PostHogProvider>)
    )
    given('childComponent', () => <div>Test</div>)
    given('posthog', () => ({}))

    it('should render children components', () => {
        expect(given.render().getByText('Test')).toBeTruthy()
    })

    it('should require a client', () => {
        given('posthog', () => undefined)
        console.error = jest.fn()

        expect(() => given.render()).toThrow()
    })

    it('should make the context consumable by the children', () => {
        function TestChild() {
            const context = useContext(getPostHogContext())
            expect(context.client).toEqual(given.posthog)
            return null
        }

        given('childComponent', () => (
            <>
                <TestChild />
                <TestChild />
            </>
        ))

        given.render()
    })
})
