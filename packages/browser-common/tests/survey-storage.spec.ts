// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { surveyStorage } from '../src/utils/survey-storage'
import { logger } from '../src/utils/logger'

afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
})

describe('survey localStorage', () => {
    it('reads and writes standalone strings without JSON encoding', () => {
        localStorage.setItem('lastSeenSurveyDate', '2026-01-01T00:00:00.000Z')
        expect(surveyStorage.getItem('lastSeenSurveyDate')).toBe('2026-01-01T00:00:00.000Z')
        surveyStorage.setItem('survey_seen/test', 'true')
        expect(localStorage.getItem('survey_seen/test')).toBe('true')
        surveyStorage.removeItem('survey_seen/test')
        expect(surveyStorage.getItem('survey_seen/test')).toBeNull()
    })

    it('logs unavailable reads and returns null', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('unavailable')
        })
        const log = vi.spyOn(logger, 'error').mockImplementation(() => {})
        expect(surveyStorage.getItem('test')).toBeNull()
        expect(log).toHaveBeenCalledWith('localStorage error: Error: unavailable')
    })

    it('lets callers handle write and removal failures', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('unavailable')
        })
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new Error('unavailable')
        })
        expect(() => surveyStorage.setItem('test', 'true')).toThrow('unavailable')
        expect(() => surveyStorage.removeItem('test')).toThrow('unavailable')
    })
})
