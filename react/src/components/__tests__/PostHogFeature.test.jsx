import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { PostHogContext, PostHogProvider } from '../../context'
import { PostHogFeature } from '../'
import '@testing-library/jest-dom'

const FEATURE_FLAG_STATUS = {
    multivariate_feature: 'string-value',
    example_feature_payload: 'test',
    test: true,
    test_false: false,
}

const FEATURE_FLAG_PAYLOADS = {
    example_feature_payload: {
        id: 1,
        name: 'example_feature_1_payload',
        key: 'example_feature_1_payload',
    },
}

describe('PostHogFeature component', () => {
    given('featureFlag', () => 'test')
    given('matchValue', () => true)
    given(
        'render',
        () => () =>
            render(
                <PostHogProvider client={given.posthog}>
                    <PostHogFeature flag={given.featureFlag} match={given.matchValue}>
                        <div data-testid="helloDiv">Hello</div>
                    </PostHogFeature>
                </PostHogProvider>
            )
    )
    given('posthog', () => ({
        isFeatureEnabled: (flag) => !!FEATURE_FLAG_STATUS[flag],
        getFeatureFlag: (flag) => FEATURE_FLAG_STATUS[flag],
        getFeatureFlagPayload: (flag) => FEATURE_FLAG_PAYLOADS[flag],
        onFeatureFlags: (callback) => {
            const activeFlags = []
            for (const flag in FEATURE_FLAG_STATUS) {
                if (FEATURE_FLAG_STATUS[flag]) {
                    activeFlags.push(flag)
                }
            }
            callback(activeFlags)
            return () => {}
        },
        capture: jest.fn(),
    }))

    beforeEach(() => {
        // IntersectionObserver isn't available in test environment
        const mockIntersectionObserver = jest.fn()
        mockIntersectionObserver.mockReturnValue({
            observe: () => null,
            unobserve: () => null,
            disconnect: () => null,
        })
        window.IntersectionObserver = mockIntersectionObserver
    })

    it('should track interactions with the feature component', () => {
        given.render()

        fireEvent.click(screen.getByTestId('helloDiv'))
        expect(given.posthog.capture).toHaveBeenCalledWith('$feature_interaction', {
            feature_flag: 'test',
            $set: { '$feature_interaction/test': true },
        })
        expect(given.posthog.capture).toHaveBeenCalledTimes(1)
    })

    it('should not fire for every interaction with the feature component', () => {
        given.render()

        fireEvent.click(screen.getByTestId('helloDiv'))
        expect(given.posthog.capture).toHaveBeenCalledWith('$feature_interaction', {
            feature_flag: 'test',
            $set: { '$feature_interaction/test': true },
        })
        expect(given.posthog.capture).toHaveBeenCalledTimes(1)

        fireEvent.click(screen.getByTestId('helloDiv'))
        fireEvent.click(screen.getByTestId('helloDiv'))
        fireEvent.click(screen.getByTestId('helloDiv'))
        expect(given.posthog.capture).toHaveBeenCalledTimes(1)
    })

    it('should not show the feature component if the flag is not enabled', () => {
        given('featureFlag', () => 'test_false')
        given.render()

        expect(screen.queryByTestId('helloDiv')).not.toBeInTheDocument()
        expect(given.posthog.capture).not.toHaveBeenCalled()

        // check if any elements are found
        const allTags = screen.queryAllByText(/.*/)

        // Assert that no random elements are found
        expect(allTags.length).toEqual(2)
        expect(allTags[0].tagName).toEqual('BODY')
        expect(allTags[1].tagName).toEqual('DIV')
    })

    it('should fallback when provided', () => {
        given('featureFlag', () => 'test_false')
        given(
            'render',
            () => () =>
                render(
                    <PostHogProvider client={given.posthog}>
                        <PostHogFeature
                            flag={given.featureFlag}
                            match={given.matchValue}
                            fallback={<div data-testid="nope">Nope</div>}
                        >
                            <div data-testid="helloDiv">Hello</div>
                        </PostHogFeature>
                    </PostHogProvider>
                )
        )
        given.render()

        expect(screen.queryByTestId('helloDiv')).not.toBeInTheDocument()
        expect(given.posthog.capture).not.toHaveBeenCalled()

        fireEvent.click(screen.getByTestId('nope'))
        expect(given.posthog.capture).not.toHaveBeenCalled()
    })

    it('should handle showing multivariate flags with bool match', () => {
        given('featureFlag', () => 'multivariate_feature')
        given('matchValue', () => true)

        given.render()

        expect(screen.queryByTestId('helloDiv')).not.toBeInTheDocument()
        expect(given.posthog.capture).not.toHaveBeenCalled()
    })

    it('should handle showing multivariate flags with incorrect match', () => {
        given('featureFlag', () => 'multivariate_feature')
        given('matchValue', () => 'string-valueCXCC')

        given.render()

        expect(screen.queryByTestId('helloDiv')).not.toBeInTheDocument()
        expect(given.posthog.capture).not.toHaveBeenCalled()
    })

    it('should handle showing multivariate flags', () => {
        given('featureFlag', () => 'multivariate_feature')
        given('matchValue', () => 'string-value')

        given.render()

        expect(screen.queryByTestId('helloDiv')).toBeInTheDocument()
        expect(given.posthog.capture).not.toHaveBeenCalled()

        fireEvent.click(screen.getByTestId('helloDiv'))
        expect(given.posthog.capture).toHaveBeenCalledTimes(1)
    })

    it('should handle payload flags', () => {
        given('featureFlag', () => 'example_feature_payload')
        given('matchValue', () => 'test')
        given(
            'render',
            () => () =>
                render(
                    <PostHogProvider client={given.posthog}>
                        <PostHogFeature flag={given.featureFlag} match={given.matchValue}>
                            {(payload) => {
                                return <div data-testid={`hi_${payload.name}`}>Hullo</div>
                            }}
                        </PostHogFeature>
                    </PostHogProvider>
                )
        )

        given.render()

        expect(screen.queryByTestId('hi_example_feature_1_payload')).toBeInTheDocument()
        expect(given.posthog.capture).not.toHaveBeenCalled()

        fireEvent.click(screen.getByTestId('hi_example_feature_1_payload'))
        expect(given.posthog.capture).toHaveBeenCalledTimes(1)
    })
})
