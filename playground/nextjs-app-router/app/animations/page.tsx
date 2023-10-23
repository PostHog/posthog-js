import Content from './content'

export const metadata = {
    title: 'PostHog',
}

export default function Page() {
    return (
        <>
            <main>
                <h1>Animations</h1>
                <p>Useful testing for Replay handling heavy animations</p>
                <Content />
            </main>
        </>
    )
}
