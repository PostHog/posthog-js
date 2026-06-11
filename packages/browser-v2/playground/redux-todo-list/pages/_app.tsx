import { Provider } from 'react-redux'
import { store } from '../src/store'
import type { AppProps } from 'next/app'
import '../styles/globals.css'
import { useRouter } from 'next/router'

export default function App({ Component, pageProps }: AppProps) {
    const router = useRouter()

    // Only use Redux Provider for Redux pages
    if (router.pathname === '/redux') {
        return (
            <Provider store={store}>
                <Component {...pageProps} />
            </Provider>
        )
    }

    // For home page, Kea page, and other pages, don't use Redux Provider
    return <Component {...pageProps} />
}
