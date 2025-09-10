import { Provider } from 'react-redux'
import { store } from '../src/store'
import type { AppProps } from 'next/app'
import '../styles/globals.css'
import { useRouter } from 'next/router'

export default function App({ Component, pageProps }: AppProps) {
    const router = useRouter()

    // For Kea pages, don't use Redux Provider
    if (router.pathname === '/kea') {
        return <Component {...pageProps} />
    }

    return (
        <Provider store={store}>
            <Component {...pageProps} />
        </Provider>
    )
}
