import { PosthogExperiments } from './posthog-experiments'
import { beforeEach } from '@jest/globals'
import { PostHog } from './posthog-core'
import { DecideResponse, PostHogConfig } from './types'
import { PostHogPersistence } from './posthog-persistence'

describe('Web Experimentation', () => {
    describe('afterDecideResponse', () => {
        let webExperiment: PosthogExperiments
        let posthog: PostHog
        let persistence: PostHogPersistence

        beforeEach(() => {
            persistence = { props: {}, register: jest.fn() } as unknown as PostHogPersistence
            posthog = makePostHog({
                config: {
                    api_host: 'https://test.com',
                    token: 'testtoken',
                    autocapture: true,
                } as PostHogConfig,
                persistence: persistence,
            })

            webExperiment = new PosthogExperiments(posthog)
        })

        it('can set text of Span Element', () => {
            // eslint-disable-next-line no-restricted-globals
            const elTarget = document.createElement('img')
            elTarget.id = 'primary_button'
            // eslint-disable-next-line no-restricted-globals
            const elParent = document.createElement('span')
            elParent.innerText = 'Control'
            elParent.appendChild(elTarget)
            // eslint-disable-next-line no-restricted-globals
            document.querySelectorAll = function () {
                return [elParent] as unknown as NodeListOf<Element>
            }

            // console.log(`I ran`)
            webExperiment.afterDecideResponse({
                featureFlagPayloads: {
                    'signup-button-test': { data: [{ selector: '#set-user-properties', text: 'Sign up' }] },
                },
                featureFlags: {
                    'signup-button-test': 'signup-variant-1',
                },
            } as unknown as DecideResponse)

            expect(elParent.innerText).toEqual('Sign up')
            // console.log(`elParent is `, elParent.innerText)
        })
    })

    function makePostHog(ph: Partial<PostHog>): PostHog {
        return {
            get_distinct_id() {
                return 'distinctid'
            },
            ...ph,
        } as unknown as PostHog
    }
})
