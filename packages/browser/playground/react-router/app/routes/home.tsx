import { Welcome } from '../welcome/welcome'
import type { Route } from './+types/home'

// eslint-disable-next-line no-empty-pattern
export function meta({}: Route.MetaArgs) {
    return [{ title: 'PostHog React Router Demo' }]
}

export default function Home() {
    return (
        <div className="container mx-auto p-8">
            <Welcome />
        </div>
    )
}
