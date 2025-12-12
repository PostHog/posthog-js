import { Link } from '@remix-run/react'

export function Header() {
    return (
        <div
            style={{
                position: 'sticky',
                top: 0,
                backgroundColor: 'white',
                borderBottom: '1px solid #ccc',
                marginBottom: '1rem',
                zIndex: 10,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.5rem 1rem' }}>
                <Link to="/" style={{ textDecoration: 'none' }}>
                    <h1 style={{ margin: 0, fontSize: '1.5rem' }}>
                        <b>PostHog</b> remix playground
                    </h1>
                </Link>

                <div style={{ flex: 1 }} />

                <nav style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <Link to="/" style={{ textDecoration: 'none', color: '#333' }}>
                        Home
                    </Link>
                    <Link to="/media" style={{ textDecoration: 'none', color: '#333' }}>
                        Media
                    </Link>
                </nav>
            </div>
        </div>
    )
}
