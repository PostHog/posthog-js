import { resetContext, getContext } from 'kea'
import { posthogKeaLogger } from 'posthog-js/lib/src/customizations'

// Initialize Kea with PostHog logging plugin
resetContext({
    plugins: [
        posthogKeaLogger({
            // Example: mask sensitive data
            // maskState: (state) => {
            //     // Remove sensitive fields from state logging
            //     const { user, ...maskedState } = state
            //     return { ...maskedState, user: { ...user, email: '[MASKED]' } }
            // },
            // Example: skip logging certain actions
            // maskAction: (action) => {
            //     if (action.type.includes('SENSITIVE')) return null
            //     return action
            // },
        }),
    ],
})

export default getContext()
