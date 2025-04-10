import {
    canActivateRepeatedly,
    getFontFamily,
    hasEvents,
    hasWaitPeriodPassed,
} from '../../extensions/surveys/surveys-extension-utils'
import { Survey, SurveySchedule, SurveyType } from '../../posthog-surveys-types'

describe('hasWaitPeriodPassed', () => {
    let originalDate: DateConstructor
    let mockCurrentDate: Date

    beforeEach(() => {
        // Store the original Date constructor
        originalDate = global.Date
        // Mock the current date to be 2025-01-15 12:00:00 UTC
        mockCurrentDate = new Date('2025-01-15T12:00:00Z')

        global.Date = class extends Date {
            constructor(date?: string | number | Date) {
                if (date) {
                    super(date)
                    return new originalDate(date)
                }
                super()
                return mockCurrentDate
            }
        } as DateConstructor
    })

    afterEach(() => {
        // Restore the original Date constructor
        global.Date = originalDate
    })

    it('should return true when no wait period is specified', () => {
        expect(hasWaitPeriodPassed('2025-01-01T12:00:00Z', undefined)).toBe(true)
    })

    it('should return true when no last seen date is provided', () => {
        expect(hasWaitPeriodPassed(null, 7)).toBe(true)
    })

    it('should return false when less than wait period has passed', () => {
        const lastSeenDate = '2025-01-10T12:00:00Z' // 5 days ago
        expect(hasWaitPeriodPassed(lastSeenDate, 7)).toBe(false)
    })

    it('should return false when the wait period has not passed yet', () => {
        const lastSeenDate = '2025-01-08T12:00:00Z' // 7 days ago
        expect(hasWaitPeriodPassed(lastSeenDate, 7)).toBe(false)
    })

    it('should return true one second after the wait period has passed', () => {
        const lastSeenDate = '2025-01-08T11:59:59Z' // 7 days ago
        expect(hasWaitPeriodPassed(lastSeenDate, 1)).toBe(true)
    })

    it('should return true when more than wait period has passed', () => {
        const lastSeenDate = '2025-01-01T12:00:00Z' // 14 days ago
        expect(hasWaitPeriodPassed(lastSeenDate, 7)).toBe(true)
    })

    it('should handle decimal wait periods by rounding up days difference', () => {
        const lastSeenDate = '2025-01-10T00:00:00Z' // 5.5 days ago
        expect(hasWaitPeriodPassed(lastSeenDate, 5)).toBe(true)
    })

    it('should handle invalid date strings by returning false', () => {
        expect(hasWaitPeriodPassed('invalid-date', 7)).toBe(false)
    })

    // test case for when just 5 minutes have passed
    it('should return false when just 5 minutes have passed', () => {
        const lastSeenDate = '2025-01-15T11:55:00Z' // 5 minutes ago
        expect(hasWaitPeriodPassed(lastSeenDate, 1)).toBe(false)
    })
})

describe('hasEvents', () => {
    it('should return false when survey has no conditions', () => {
        const survey = {
            conditions: undefined,
        } as Pick<Survey, 'conditions'>
        expect(hasEvents(survey)).toBe(false)
    })

    it('should return false when survey has no events', () => {
        const survey = {
            conditions: {
                events: undefined,
                actions: { values: [] },
            },
        } as Pick<Survey, 'conditions'>
        expect(hasEvents(survey)).toBe(false)
    })

    it('should return false when survey has empty events values', () => {
        const survey = {
            conditions: {
                events: {
                    values: [],
                },
                actions: { values: [] },
            },
        } as Pick<Survey, 'conditions'>
        expect(hasEvents(survey)).toBe(false)
    })

    it('should return true when survey has events values', () => {
        const survey = {
            conditions: {
                events: {
                    values: [{ name: 'event1' }, { name: 'event2' }],
                },
                actions: { values: [] },
            },
        } as Pick<Survey, 'conditions'>
        expect(hasEvents(survey)).toBe(true)
    })
})

describe('canActivateRepeatedly', () => {
    it('should return true when survey the schedule is Always', () => {
        const survey = {
            schedule: SurveySchedule.Always,
            conditions: undefined,
        } as Pick<Survey, 'type' | 'schedule' | 'conditions'>
        expect(canActivateRepeatedly(survey)).toBe(true)
    })

    it('should return false when survey has no events', () => {
        const survey = {
            type: SurveyType.Popover,
            schedule: SurveySchedule.Once,
            conditions: {
                events: {
                    repeatedActivation: true,
                    values: [],
                },
                actions: { values: [] },
            },
        } as Pick<Survey, 'type' | 'schedule' | 'conditions'>
        expect(canActivateRepeatedly(survey)).toBe(false)
    })

    it('should return true when survey has events and repeatedActivation is true', () => {
        const survey = {
            type: SurveyType.Popover,
            schedule: SurveySchedule.Once,
            conditions: {
                events: {
                    repeatedActivation: true,
                    values: [{ name: 'event1' }],
                },
                actions: { values: [] },
            },
        } as Pick<Survey, 'type' | 'schedule' | 'conditions'>
        expect(canActivateRepeatedly(survey)).toBe(true)
    })

    it('should return false when survey has events but repeatedActivation is false', () => {
        const survey = {
            type: SurveyType.Popover,
            schedule: SurveySchedule.Once,
            conditions: {
                events: {
                    repeatedActivation: false,
                    values: [{ name: 'event1' }],
                },
                actions: { values: [] },
            },
        } as Pick<Survey, 'type' | 'schedule' | 'conditions'>
        expect(canActivateRepeatedly(survey)).toBe(false)
    })
})

describe('getFontFamily', () => {
    it('should return the default font family with fallbacks when no font family is provided', () => {
        expect(getFontFamily()).toBe(
            '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "Roboto", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"'
        )
    })

    it('should return the provided font family with fallbacks when a custom font family is provided', () => {
        expect(getFontFamily('Arial')).toBe(
            'Arial, BlinkMacSystemFont, "Inter", "Segoe UI", "Roboto", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"'
        )
    })

    it('should return only "inherit" when "inherit" is provided as font family', () => {
        expect(getFontFamily('inherit')).toBe('inherit')
    })
})
