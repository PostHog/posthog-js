import { window } from './utils'
import Config from './config'

function isFloat(n) {
    return Number(n) === n && n % 1 !== 0
}

export function optimisePerformanceData(performanceEntries) {
    performanceEntries.forEach((performanceEntry, index) => {
        for (const performanceEntryItemKey in performanceEntry) {
            if (
                isFloat(performanceEntry[performanceEntryItemKey]) &&
                performanceEntry[performanceEntryItemKey].toString().match(/^\d+\.\d{4,}$/)
            ) {
                performanceEntries[index][performanceEntryItemKey] = Number(
                    performanceEntry[performanceEntryItemKey].toFixed(3)
                )
            }

            if (
                ['serverTiming', 'workerTiming'].includes(performanceEntryItemKey) &&
                performanceEntry[performanceEntryItemKey].length === 0
            ) {
                delete performanceEntries[index][performanceEntryItemKey]
            }

            if (performanceEntryItemKey === 'entryType' && performanceEntry[performanceEntryItemKey] === 'resource') {
                delete performanceEntries[index][performanceEntryItemKey]
            }

            if (performanceEntryItemKey === 'nextHopProtocol') {
                delete performanceEntries[index][performanceEntryItemKey]
            }

            if (performanceEntry[performanceEntryItemKey] === 0) {
                delete performanceEntries[index][performanceEntryItemKey]
            }
        }
    })

    return deduplicateKeys(performanceEntries)
}

export function getPerformanceEntriesByType(type) {
    // wide support but not available pre IE 10
    try {
        // stringifying and then parsing made data collection more reliable
        const entriesOfType = JSON.parse(JSON.stringify(window.performance.getEntriesByType(type)))
        return optimisePerformanceData(entriesOfType)
    } catch (ex) {
        if (Config.DEBUG) {
            console.warn('not able to capture performance data (' + type + ') - ' + ex)
        }
        return []
    }
}

/**
 * https://developer.mozilla.org/en-US/docs/Web/API/Performance/getEntriesByType
 *
 *  The arrays in the prformance data are populated by getEntriesByType
 *  They contain PerformanceEntry objects for the given performance type.
 *  This means each object in the array shares a set of keys
 *
 * @param performanceEntries
 * @returns {(string[]|*)[]}
 */
export function deduplicateKeys(performanceEntries) {
    if (performanceEntries.length === 0) {
        return []
    }
    const keys = Object.keys(performanceEntries[0])
    return [keys, performanceEntries.map((obj) => keys.map((key) => obj[key]))]
}

export function pageLoadFrom(performanceData) {
    const keyIndex =
        performanceData.navigation && performanceData.navigation[0] && performanceData.navigation[0].indexOf('duration')
    return performanceData.navigation[1] && performanceData.navigation[1][0][keyIndex]
}

export function getPerformanceData() {
    const performanceEntries = {
        navigation: getPerformanceEntriesByType('navigation'),
        paint: getPerformanceEntriesByType('paint'),
        resource: getPerformanceEntriesByType('resource'),
    }

    const properties = {}

    const pageLoad = pageLoadFrom(performanceEntries)
    if (pageLoad) {
        properties['$performance_page_loaded'] = pageLoad
    }
    properties['$performance_raw'] = JSON.stringify(performanceEntries)

    return properties
}
