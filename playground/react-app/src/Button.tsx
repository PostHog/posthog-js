import { usePostHog } from './posthog'

export default function Button() {
    const posthog = usePostHog()
    const clicked = () => {
        console.log('clicked')
        console.log(posthog?.capture)
        posthog?.capture('button clicked')
    }
    return (
        <>
            <div>Hi!</div>
            <button onClick={clicked}>Click me</button>
        </>
    )
}
