import { NetworkPage } from '../fixtures/network'
import { PosthogPage } from '../fixtures/posthog'

export async function initSurveys(surveys: any[], posthog: PosthogPage, network: NetworkPage) {
    await network.mockSurveys(surveys)
    await posthog.init()
    await network.waitForSurveys()
}
