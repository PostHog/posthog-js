import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Identity } from 'spacetimedb'
import { SpacetimeDBProvider } from 'spacetimedb/react'
import { PostHogProvider } from '@posthog/react'
import App from './App.tsx'
import { DbConnection, type ErrorContext } from './module_bindings'

const HOST = import.meta.env.VITE_SPACETIMEDB_HOST ?? 'ws://localhost:3000'
const DB_NAME = import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? 'posthog-spacetimedb'
const TOKEN_KEY = `${HOST}/${DB_NAME}/auth_token`

const connectionBuilder = DbConnection.builder()
    .withUri(HOST)
    .withDatabaseName(DB_NAME)
    .withToken(localStorage.getItem(TOKEN_KEY) || undefined)
    .onConnect((_conn, identity: Identity, token: string) => {
        localStorage.setItem(TOKEN_KEY, token)
        console.log('Connected to SpacetimeDB as', identity.toHexString())
    })
    .onDisconnect(() => console.log('Disconnected from SpacetimeDB'))
    .onConnectError((_ctx: ErrorContext, err: Error) => console.error('Connect error:', err))

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <PostHogProvider
            apiKey={import.meta.env.VITE_POSTHOG_PROJECT_TOKEN ?? ''}
            options={{ api_host: import.meta.env.VITE_POSTHOG_HOST ?? 'https://us.i.posthog.com' }}
        >
            <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
                <App />
            </SpacetimeDBProvider>
        </PostHogProvider>
    </StrictMode>
)
