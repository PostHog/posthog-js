import { Link } from 'react-router'
import type { Route } from './+types/home'

// eslint-disable-next-line no-empty-pattern
export function meta({}: Route.MetaArgs) {
    return [{ title: 'Surveys' }, { name: 'description', content: 'Surveys' }]
}

export default function Surveys() {
    return (
        <main className="flex items-center justify-center pt-16 pb-4">
            <div className="flex-1 flex flex-col items-center gap-16 min-h-0">
                <Link to="/">Home</Link>
                <button id="feedback-button" className="bg-blue-500 text-white p-2 rounded-md">
                    Trigger surveys
                </button>
            </div>
        </main>
    )
}
