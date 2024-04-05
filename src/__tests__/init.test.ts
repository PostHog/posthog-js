import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'

describe('init', () => {
    it("should default to 'always' process_person", async () => {
        // arrange
        const token = uuidv7()

        // act
        const posthog = await createPosthogInstance(token, {
            process_person: undefined,
        })

        // assert
        expect(posthog.config.process_person).toEqual('always')
    })
    it('should read process_person from init config', async () => {
        // arrange
        const token = uuidv7()

        // act
        const posthog = await createPosthogInstance(token, {
            process_person: 'never',
        })

        // assert
        expect(posthog.config.process_person).toEqual('never')
    })
})
