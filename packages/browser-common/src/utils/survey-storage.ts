import { window } from './globals'
import { logger } from './logger'

export interface SurveyStorage {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

/** Survey interaction state is stored in localStorage independently of SDK persistence. */
export const surveyStorage: SurveyStorage = {
    getItem(key) {
        try {
            return window?.localStorage.getItem(key) ?? null
        } catch (error) {
            logger.error('localStorage error: ' + error)
            return null
        }
    },
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: (key) => localStorage.removeItem(key),
}
