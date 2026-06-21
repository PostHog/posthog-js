/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_SPACETIMEDB_HOST?: string
    readonly VITE_SPACETIMEDB_DB_NAME?: string
    readonly VITE_POSTHOG_PROJECT_TOKEN?: string
    readonly VITE_POSTHOG_HOST?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
