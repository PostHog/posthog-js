import { window } from './utils'

function isFloat(n) {
    return Number(n) === n && n % 1 !== 0
}

export function optimisePerformanceData(performanceData) {
    // performance data is an object of arrays of PerformanceEntry objects
    for (const key in performanceData) {
        performanceData[key].forEach((performanceEntry, index) => {
            for (const performanceEntryItemKey in performanceEntry) {
                if (
                    isFloat(performanceEntry[performanceEntryItemKey]) &&
                    performanceEntry[performanceEntryItemKey].toString().match(/^\d+\.\d{4,}$/)
                ) {
                    performanceData[key][index][performanceEntryItemKey] = Number(
                        performanceEntry[performanceEntryItemKey].toFixed(3)
                    )
                }

                if (
                    ['serverTiming', 'workerTiming'].includes(performanceEntryItemKey) &&
                    performanceEntry[performanceEntryItemKey].length === 0
                ) {
                    delete performanceData[key][index][performanceEntryItemKey]
                }

                if (
                    performanceEntryItemKey === 'entryType' &&
                    performanceEntry[performanceEntryItemKey] === 'resource'
                ) {
                    delete performanceData[key][index][performanceEntryItemKey]
                }

                if (performanceEntryItemKey === 'nextHopProtocol') {
                    delete performanceData[key][index][performanceEntryItemKey]
                }

                if (performanceEntry[performanceEntryItemKey] === 0) {
                    delete performanceData[key][index][performanceEntryItemKey]
                }
            }
        })
    }

    return performanceData
}

export function getPerformanceEntriesByType(type) {
    // wide support but not available pre IE 10
    try {
        return JSON.parse(JSON.stringify(window.performance.getEntriesByType(type)))
    } catch (ex) {
        console.warn('not able to capture performance data (' + type + ') - ' + ex)
        return []
    }
}
