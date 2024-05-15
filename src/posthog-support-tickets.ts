import { PostHog } from './posthog-core'
import { SUPPORT_TICKETS } from './constants'
import { SupportTicketListCallback } from './types'

export class PostHogSupportTickets {
    instance: PostHog

    constructor(instance: PostHog) {
        this.instance = instance
    }

    getTicketsForUser(
        { user, validationToken, forceReload = false }: { user: string; validationToken: string; forceReload: boolean },
        callback: SupportTicketListCallback
    ) {
        if (this.instance.config.disable_support_tickets) {
            return []
        }

        // Since this endpoint can be called for multiple users, we cache the tickets for each user.
        // In persistence we store the tickets as an object with the user as the key and the tickets as the value.
        const allTickets = this.instance.get_property(SUPPORT_TICKETS)
        const existingTicketsForUser = allTickets?.[user]
        // If existingTicketsForUser is undefined, or forceReload is true, we should fetch the tickets from the server
        // but otherwise return cached values because we don't want to make unnecessary requests.
        if (!existingTicketsForUser || forceReload) {
            this.instance._send_request({
                url: this.instance.requestRouter.endpointFor(
                    'api',
                    `/api/support_tickets/?token=${this.instance.config.token}&user=${user}&validation_token=${validationToken}`
                ),
                method: 'GET',
                transport: 'XHR',
                callback: (response) => {
                    if (response.statusCode !== 200 || !response.json) {
                        return callback([])
                    }
                    const ticketsForUser = response.json.supportTickets || []
                    this.instance.persistence?.register({
                        [SUPPORT_TICKETS]: { ...allTickets, [user]: ticketsForUser },
                    })
                    return callback(ticketsForUser)
                },
            })
        } else {
            return callback(existingTicketsForUser)
        }
    }
}
