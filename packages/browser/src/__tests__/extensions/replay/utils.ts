import { FlagsResponse } from '../../../types'

export function makeFlagsResponse(partialResponse: Partial<FlagsResponse>) {
    return partialResponse as unknown as FlagsResponse
}
