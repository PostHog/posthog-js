import { Link } from 'react-router-dom'

export function Navigation() {
    return (
        <nav className="bg-gray-800 text-white p-4">
            <div className="container mx-auto flex justify-between items-center">
                <div className="text-xl font-bold">PostHog Demo</div>
                <div className="flex space-x-4">
                    <Link to="/" className="hover:text-gray-300">
                        Home
                    </Link>
                    <Link to="/surveys" className="hover:text-gray-300">
                        Surveys
                    </Link>
                </div>
            </div>
        </nav>
    )
}
