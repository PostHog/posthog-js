import React, { useContext } from 'react'
import { mocked } from 'ts-jest/utils'
import { render } from '@testing-library/react'
import posthog from 'posthog-js'
import { PostHogProvider, getPostHogContext } from '..'

describe('PostHogProvider component', () => {
    beforeEach(() => {
        posthog.init('test_token', {
            api_host: 'https://test.com',
        })
    })

    it('should render children components', () => {
        const { getByText } = render(
            <PostHogProvider client={posthog}>
                <div>Test</div>
            </PostHogProvider>
        )

        expect(getByText('Test')).toBeTruthy()
    })

    it('should require a client', () => {
        const mockedConsole = mocked(console)
        jest.spyOn(mockedConsole, 'error').mockImplementation(() => null)

        expect(() => {
            render(
                <PostHogProvider client={undefined}>
                    <div>Test</div>
                </PostHogProvider>
            )
        }).toThrow()
    })

    it('should make the context consumable by the children', () => {
        const TestChild = () => {
            const context = useContext(getPostHogContext())
            expect(context.client).toEqual(posthog)
            return null
        }

        render(
            <PostHogProvider client={posthog}>
                <TestChild />
                <TestChild />
            </PostHogProvider>
        )
    })
})
