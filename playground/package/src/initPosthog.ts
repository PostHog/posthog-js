import posthog from 'posthog-js'
import "posthog-js/dist/recorder"

export function initPosthog(): void {
    posthog.init('phc_XDDLk5oQepjxJWWueizUBIv97abYQwaoEUkPYx6sroH', {api_host: 'http://localhost:8000'})
}