import type { AutocaptureConfig as DomAutocaptureConfig, RageclickConfig } from './types'

export interface AutocaptureConfig extends DomAutocaptureConfig {
    enabled: boolean
    rageclick: boolean | RageclickConfig
    maskAllElementAttributes: boolean
    maskAllText: boolean
    disableCaptureUrlHashes: boolean
    getCurrentUrl?: (defaultUrl: string) => string
    remoteRequestsDisabled: boolean
}

export interface AutocaptureConfigSource {
    refresh(config: AutocaptureConfig): void
}
