export interface CapturedEvent {
    id: number
    timestamp: Date
    event: string
    properties: Record<string, any>
    options: Record<string, any>
}

export interface BotInfo {
    name: string
    pattern: string
    example: string
}

export interface BotCategories {
    [category: string]: BotInfo[]
}

export interface PostHogConfig {
    api_host: string
    ui_host: string
    __preview_capture_bot_pageviews: boolean
    autocapture: boolean
    before_send?: (event: any) => any
    loaded?: (ph: any) => void
}

export interface PostHogInstance {
    init: (token: string, config: PostHogConfig) => void
    capture: (event: string, properties?: Record<string, any>) => void
    debug: () => void
}

declare global {
    interface Window {
        posthog: PostHogInstance
        BOT_CATEGORIES: BotCategories
    }
}
