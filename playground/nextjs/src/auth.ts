import { parse } from 'cookie'
import { useEffect, useState } from 'react'

export type Team = {
    name: string
    id: string
}

export type User = {
    email: string
    name: string
    team: Team
}

export const TEAMS: Team[] = [
    {
        id: 'team-pineapple',
        name: 'Team Pineapple',
    },
    {
        id: 'team-taste',
        name: 'Team Taste',
    },
    {
        id: 'team-onthefence',
        name: 'Team OnTheFence',
    },
]

export const getUser = () => {
    if (typeof document !== 'undefined') {
        return JSON.parse(parse(document.cookie).session)
    }

    return undefined
}

export const useUser = () => {
    // NOTE: This is hacky but its just meant to be a simple example
    const [user, setUser] = useState<User | null | undefined>(undefined)

    useEffect(() => {
        let lastSessionString = ''

        const updateIfChanged = () => {
            const newSessionString = parse(document.cookie)?.session

            if (newSessionString !== lastSessionString) {
                setUser(newSessionString ? JSON.parse(newSessionString) : null)
                lastSessionString = newSessionString
            }
        }

        const interval = setInterval(updateIfChanged, 1000)
        updateIfChanged()
        return () => clearInterval(interval)
    }, [])

    return user
}
