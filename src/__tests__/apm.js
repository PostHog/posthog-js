import { optimisePerformanceData } from '../apm'
import veryLargePerfJson from './vary-large-performance-data.json'
import optimised_vary_large_performance_data from './optimised-vary-large-performance-data.json'

describe('when capturing performance data', () => {
    it('reduces the size of very large payloads', () => {
        const processedPerformanceJson = optimisePerformanceData(veryLargePerfJson)
        expect(processedPerformanceJson).toEqual(optimised_vary_large_performance_data)
    })
})
