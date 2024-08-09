import { SegmentAnalytics, SegmentUser, setupSegmentIntegration } from './segment-integration'
import { PostHog } from '../posthog-core'
import { afterEach, beforeEach } from '@jest/globals'
import { PostHogConfig, Properties } from '../types'
import { PostHogPersistence } from '../posthog-persistence'
import { USER_STATE } from '../constants'

describe('segment-integration', () => {
    let config: PostHogConfig
    let posthog: PostHog
    let persistence: PostHogPersistence

    const segment: SegmentAnalytics = <SegmentAnalytics>{
        user: function (): SegmentUser {
            return <SegmentUser>{
                id: function (): string | undefined {
                    return 'phani'
                },
                anonymousId: function (): string | undefined {
                    return 'phani'
                },
            }
        },
        // eslint-disable-next-line compat/compat
        register: jest.fn(() => Promise.resolve()),
    }

    beforeEach(() => {
        config = {
            token: 'testtoken',
            api_host: 'https://app.posthog.com',
            persistence: 'memory',
            segment: segment,
        } as unknown as PostHogConfig
        persistence = new PostHogPersistence(config)
        posthog = {
            config: config,
            segment_config: {
                user_id: 'phani raj',
            },
            register: (properties: Properties, days?: number) => {
                posthog.persistence?.register(properties, days)
            },
            persistence: persistence,
            _addCaptureHook: jest.fn(),
        } as unknown as PostHog
    })

    afterEach(() => {
        posthog.persistence?.clear()
    })

    describe('#setupPostHogFromSegment', () => {
        it('sets userId from segment user', async () => {
            setupSegmentIntegration(posthog, () => {
                expect(posthog.persistence?.get_property(USER_STATE)).toEqual('identified')
            })
        })

        it('sets userId from segment config', () => {
            segment.user = function (): SegmentUser {
                return <SegmentUser>{
                    id: function (): string | undefined {
                        return undefined
                    },
                    anonymousId: function (): string | undefined {
                        return 'anonymous segment user'
                    },
                }
            }

            posthog.config.segment_config = {
                user_id: 'custom segment user',
            }

            setupSegmentIntegration(posthog, () => {
                expect(posthog.persistence?.properties().distinct_id).toEqual('custom segment user')
                expect(posthog.persistence?.properties().$device_id).toEqual('anonymous segment user')
                expect(posthog.persistence?.get_property(USER_STATE)).toEqual('identified')
            })
        })

        it('checks userId to set user_state', () => {
            segment.user = function (): SegmentUser {
                return <SegmentUser>{
                    id: function (): string | undefined {
                        return undefined
                    },
                    anonymousId: function (): string | undefined {
                        return 'anonymous segment user'
                    },
                }
            }

            posthog.config.segment = segment
            posthog.persistence = new PostHogPersistence(config)
            posthog.config.segment_config = undefined

            setupSegmentIntegration(posthog, () => {
                expect(posthog.persistence?.properties().distinct_id).toBeUndefined()
                expect(posthog.persistence?.properties().$device_id).toBeUndefined()
            })
        })

        it('picks segment user.id over segment_config.user_id', () => {
            segment.user = function (): SegmentUser {
                return <SegmentUser>{
                    id: function (): string | undefined {
                        return 'segment user id'
                    },
                    anonymousId: function (): string | undefined {
                        return 'anonymous segment user'
                    },
                }
            }

            posthog.config.segment_config = {
                user_id: 'custom segment user',
            }

            setupSegmentIntegration(posthog, () => {
                expect(posthog.persistence?.properties().distinct_id).toEqual('segment user id')
                expect(posthog.persistence?.properties().$device_id).toEqual('anonymous segment user')
                expect(posthog.persistence?.get_property(USER_STATE)).toEqual('identified')
            })
        })
    })
})
