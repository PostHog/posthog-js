import { posthog } from 'posthog-js'

function throwException() {
    const error = new Error('Exception created')
    posthog.captureException(error)
    throw error
}

export default function ErrorButton() {
    return <button onClick={() => throwException()}>Create exception</button>
}
