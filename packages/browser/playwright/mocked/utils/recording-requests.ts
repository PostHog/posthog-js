import { Page } from '@playwright/test'

export function trackRecordingRequests(page: Page): string[] {
    const requests: string[] = []
    page.on('request', (request) => {
        const url = new URL(request.url())
        if (url.pathname.endsWith('recorder.js') || url.pathname === '/ses/') {
            requests.push(request.url())
        }
    })
    return requests
}
