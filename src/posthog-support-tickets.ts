import { PostHog } from './posthog-core'
import { SUPPORT_TICKETS } from './constants'
import {
    Compression,
    SupportTicketCloseCallback,
    SupportTicketCreateCallback,
    SupportTicketListCallback,
    SupportTicketReplyCallback,
} from './types'

export class PostHogSupportTickets {
    instance: PostHog

    constructor(instance: PostHog) {
        this.instance = instance
    }

    getTicketsForUser(
        { user, userHash, forceReload = false }: { user: string; userHash: string; forceReload: boolean },
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
                    `/api/support_tickets/?token=${this.instance.config.token}&user=${user}&user_hash=${userHash}`
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

    replyToTicket(
        { user, userHash, message, ticketId }: { user: string; userHash: string; message: string; ticketId: string },
        callback: SupportTicketReplyCallback
    ) {
        // TODO: I'm not sure what this API should return
        // or what the shape of the response is

        const json_data = {
            ticket_id: ticketId,
            comment: {
                body: message,
            },
            email: user,
        }

        this.instance._send_request({
            url: this.instance.requestRouter.endpointFor(
                'api',
                `/api/support_tickets/reply?token=${this.instance.config.token}&user=${user}&user_hash=${userHash}`
            ),
            method: 'POST',
            data: json_data,
            transport: 'XHR',
            compression: this.instance.config.disable_compression ? undefined : Compression.Base64,
            callback: (response) => {
                if (response.statusCode !== 200 || !response.json) {
                    return callback(undefined)
                }
                return callback(response.json)
            },
        })
    }

    // TODO: Lots of inconsistencies between user and email -> reconcile into one.
    closeTicket(
        { user, userHash, ticketId }: { user: string; userHash: string; ticketId: string },
        callback: SupportTicketCloseCallback
    ) {
        const json_data = {
            ticket_id: ticketId,
            email: user,
        }

        this.instance._send_request({
            url: this.instance.requestRouter.endpointFor(
                'api',
                `/api/support_tickets/close?token=${this.instance.config.token}&user=${user}&user_hash=${userHash}`
            ),
            method: 'POST',
            data: json_data,
            transport: 'XHR',
            compression: this.instance.config.disable_compression ? undefined : Compression.Base64,
            callback: (response) => {
                if (response.statusCode !== 200 || !response.json) {
                    return callback(false, response.text)
                }
                // Not sure what this endpoint returns?
                return callback(true, undefined)
            },
        })
    }

    createTicket(
        { user, userHash, message }: { user: string; userHash: string; message: string },
        callback: SupportTicketCreateCallback
    ) {
        // Janky for now, but we should always call getTickets after createTicket to update the cache.

        const json_data = {
            comment: {
                body: message,
            },
            email: user,
        }

        this.instance._send_request({
            url: this.instance.requestRouter.endpointFor(
                'api',
                `/api/support_tickets/create?token=${this.instance.config.token}&user=${user}&user_hash=${userHash}`
            ),
            method: 'POST',
            data: json_data,
            transport: 'XHR',
            compression: this.instance.config.disable_compression ? undefined : Compression.Base64,
            callback: (response) => {
                if (response.statusCode !== 200 || !response.json) {
                    return callback(undefined)
                }
                return callback(response.json)
            },
        })
    }
}
