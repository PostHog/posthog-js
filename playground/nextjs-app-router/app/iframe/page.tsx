import Content from './content'

export const metadata = {
    title: 'PostHog',
}

export default function Page() {
    return (
        <>
            <main>
                <h1>Iframes</h1>

                <h2>Cross origin iframe</h2>
                <p>
                    This loads the same page but from <b>other-localhost</b> which you need to add to your hosts file.
                </p>

                <Content />
            </main>
        </>
    )
}
