import * as React from 'react'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { PostHogProvider } from '../../context'
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
    let posthog

    const renderWith = (instance, flag = 'test', matchValue = true) =>
        render(
            <PostHogProvider client={instance}>
                <PostHogFeature flag={flag} match={matchValue}>
                    <div data-testid="helloDiv">Hello</div>
                </PostHogFeature>
            </PostHogProvider>
        )

    beforeEach(() => {
        // IntersectionObserver isn't available in test environment
        const mockIntersectionObserver = jest.fn()
        mockIntersectionObserver.mockReturnValue({
            observe: () => null,
            unobserve: () => null,
            disconnect: () => null,
        })

        // eslint-disable-next-line compat/compat
        window.IntersectionObserver = mockIntersectionObserver

        posthog = {
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
        }
    })

    it('should track interactions with the feature component', () => {
        renderWith(posthog)

        fireEvent.click(screen.getByTestId('helloDiv'))
        expect(posthog.capture).toHaveBeenCalledWith('$feature_interaction', {
            feature_flag: 'test',
            $set: { '$feature_interaction/test': true },
        })
        expect(posthog.capture).toHaveBeenCalledTimes(1)
    })

    it('should not fire for every interaction with the feature component', () => {
        renderWith(posthog)

        fireEvent.click(screen.getByTestId('helloDiv'))
        expect(posthog.capture).toHaveBeenCalledWith('$feature_interaction', {
            feature_flag: 'test',
            $set: { '$feature_interaction/test': true },
        })
        expect(posthog.capture).toHaveBeenCalledTimes(1)

        fireEvent.click(screen.getByTestId('helloDiv'))
        fireEvent.click(screen.getByTestId('helloDiv'))
        fireEvent.click(screen.getByTestId('helloDiv'))
        expect(posthog.capture).toHaveBeenCalledTimes(1)
    })

    it('should track an interaction with each child node of the feature component', () => {
        render(
            <PostHogProvider client={posthog}>
                <PostHogFeature flag={'test'} match={true}>
                    <div data-testid="helloDiv">Hello</div>
                    <div data-testid="worldDiv">World!</div>
                </PostHogFeature>
            </PostHogProvider>
        )

        fireEvent.click(screen.getByTestId('helloDiv'))
        fireEvent.click(screen.getByTestId('helloDiv'))
        fireEvent.click(screen.getByTestId('worldDiv'))
        fireEvent.click(screen.getByTestId('worldDiv'))
        fireEvent.click(screen.getByTestId('worldDiv'))
        expect(posthog.capture).toHaveBeenCalledWith('$feature_interaction', {
            feature_flag: 'test',
            $set: { '$feature_interaction/test': true },
        })
        expect(posthog.capture).toHaveBeenCalledTimes(1)
    })

    it('should not fire events when interaction is disabled', () => {
        render(
            <PostHogProvider client={posthog}>
                <PostHogFeature flag={'test'} match={true} trackInteraction={false}>
                    <div data-testid="helloDiv">Hello</div>
                </PostHogFeature>
            </PostHogProvider>
        )

        fireEvent.click(screen.getByTestId('helloDiv'))
        expect(posthog.capture).not.toHaveBeenCalled()

        fireEvent.click(screen.getByTestId('helloDiv'))
        fireEvent.click(screen.getByTestId('helloDiv'))
        fireEvent.click(screen.getByTestId('helloDiv'))
        expect(posthog.capture).not.toHaveBeenCalled()
    })

    it('should fire events when interaction is disabled but re-enabled after', () => {
        const DynamicUpdateComponent = () => {
            const [trackInteraction, setTrackInteraction] = useState(false)

            return (
                <>
                    <div
                        data-testid="clicker"
                        onClick={() => {
                            setTrackInteraction(true)
                        }}
                    >
                        Click me
                    </div>
                    <PostHogFeature flag={'test'} match={true} trackInteraction={trackInteraction}>
                        <div data-testid="helloDiv">Hello</div>
                    </PostHogFeature>
                </>
            )
        }

        render(
            <PostHogProvider client={posthog}>
                <DynamicUpdateComponent />
            </PostHogProvider>
        )

        fireEvent.click(screen.getByTestId('helloDiv'))
        expect(posthog.capture).not.toHaveBeenCalled()

        fireEvent.click(screen.getByTestId('clicker'))
        fireEvent.click(screen.getByTestId('helloDiv'))
        fireEvent.click(screen.getByTestId('helloDiv'))
        expect(posthog.capture).toHaveBeenCalledWith('$feature_interaction', {
            feature_flag: 'test',
            $set: { '$feature_interaction/test': true },
        })
        expect(posthog.capture).toHaveBeenCalledTimes(1)
    })

    it('should not show the feature component if the flag is not enabled', () => {
        renderWith(posthog, 'test_value')

        expect(screen.queryByTestId('helloDiv')).not.toBeInTheDocument()
        expect(posthog.capture).not.toHaveBeenCalled()

        // check if any elements are found
        const allTags = screen.queryAllByText(/.*/)

        // Assert that no random elements are found
        expect(allTags.length).toEqual(2)
        expect(allTags[0].tagName).toEqual('BODY')
        expect(allTags[1].tagName).toEqual('DIV')
    })

    it('should fallback when provided', () => {
        render(
            <PostHogProvider client={posthog}>
                <PostHogFeature flag={'test_false'} match={true} fallback={<div data-testid="nope">Nope</div>}>
                    <div data-testid="helloDiv">Hello</div>
                </PostHogFeature>
            </PostHogProvider>
        )

        expect(screen.queryByTestId('helloDiv')).not.toBeInTheDocument()
        expect(posthog.capture).not.toHaveBeenCalled()

        fireEvent.click(screen.getByTestId('nope'))
        expect(posthog.capture).not.toHaveBeenCalled()
    })

    it('should handle showing multivariate flags with bool match', () => {
        renderWith(posthog, 'multivariate_feature')

        expect(screen.queryByTestId('helloDiv')).not.toBeInTheDocument()
        expect(posthog.capture).not.toHaveBeenCalled()
    })

    it('should handle showing multivariate flags with incorrect match', () => {
        renderWith(posthog, 'multivariate_feature', 'string-valueCXCC')

        expect(screen.queryByTestId('helloDiv')).not.toBeInTheDocument()
        expect(posthog.capture).not.toHaveBeenCalled()
    })

    it('should handle showing multivariate flags', () => {
        renderWith(posthog, 'multivariate_feature', 'string-value')

        expect(screen.queryByTestId('helloDiv')).toBeInTheDocument()
        expect(posthog.capture).not.toHaveBeenCalled()

        fireEvent.click(screen.getByTestId('helloDiv'))
        expect(posthog.capture).toHaveBeenCalledWith('$feature_interaction', {
            feature_flag: 'multivariate_feature',
            feature_flag_variant: 'string-value',
            $set: { '$feature_interaction/multivariate_feature': 'string-value' },
        })
        expect(posthog.capture).toHaveBeenCalledTimes(1)
    })

    it('should handle payload flags', () => {
        render(
            <PostHogProvider client={posthog}>
                <PostHogFeature flag={'example_feature_payload'} match={'test'}>
                    {(payload) => {
                        return <div data-testid={`hi_${payload.name}`}>Hullo</div>
                    }}
                </PostHogFeature>
            </PostHogProvider>
        )

        expect(screen.queryByTestId('hi_example_feature_1_payload')).toBeInTheDocument()
        expect(posthog.capture).not.toHaveBeenCalled()

        fireEvent.click(screen.getByTestId('hi_example_feature_1_payload'))
        expect(posthog.capture).toHaveBeenCalledTimes(1)
    })
})
