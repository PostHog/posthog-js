export const Compression = {
    GZipJS: 'gzip-js',
    Base64: 'base64',
} as const

export type Compression = (typeof Compression)[keyof typeof Compression]
