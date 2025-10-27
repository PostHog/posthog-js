import { Page } from '@playwright/test'

export interface LongTask {
    startTime: number
    duration: number
    blockingTime: number
}

export interface PerformanceMetrics {
    totalBlockingTime: number
    longTaskCount: number
    longestTaskDuration: number
    timeToQuiet: number
    tasks: LongTask[]
    recorderDownloadTime?: number
}

const QUIET_WINDOW_MS = 500

export async function measureMainThreadBlockingTime(
    page: Page,
    startMarker: () => Promise<void>
): Promise<PerformanceMetrics> {
    await page.evaluate(() => {
        ;(window as any).__longTasks = []
        ;(window as any).__performanceStartTime = performance.now()

        if ('PerformanceObserver' in window) {
            try {
                const observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        ;(window as any).__longTasks.push({
                            startTime: entry.startTime,
                            duration: entry.duration,
                            blockingTime: Math.max(0, entry.duration - 50),
                        })
                    }
                })

                observer.observe({ entryTypes: ['longtask'] })
                ;(window as any).__longTaskObserver = observer
            } catch (e) {
                // eslint-disable-next-line no-console
                console.warn('PerformanceObserver for longtask not supported:', e)
            }
        }
    })

    await startMarker()

    const metrics = await waitForMainThreadQuiet(page)

    await page.evaluate(() => {
        const observer = (window as any).__longTaskObserver
        if (observer) {
            observer.disconnect()
        }
    })

    return metrics
}

async function waitForMainThreadQuiet(page: Page, maxWaitMs: number = 10000): Promise<PerformanceMetrics> {
    const startTime = Date.now()

    await page.waitForFunction(
        ({ quietWindow, maxWait, startTs }) => {
            const tasks = (window as any).__longTasks || []
            const now = performance.now()
            const startTime = (window as any).__performanceStartTime || 0

            if (Date.now() - startTs > maxWait) {
                return true
            }

            if (tasks.length === 0) {
                return now - startTime > quietWindow
            }

            const lastTask = tasks[tasks.length - 1]
            const lastTaskEnd = lastTask.startTime + lastTask.duration
            const timeSinceLastTask = now - lastTaskEnd

            return timeSinceLastTask >= quietWindow
        },
        {
            quietWindow: QUIET_WINDOW_MS,
            maxWait: maxWaitMs,
            startTs: startTime,
        },
        { timeout: maxWaitMs + 1000 }
    )

    const tasks: LongTask[] = await page.evaluate(() => {
        return (window as any).__longTasks || []
    })

    const totalBlockingTime = tasks.reduce((sum, task) => sum + task.blockingTime, 0)
    const longestTaskDuration = tasks.length > 0 ? Math.max(...tasks.map((t) => t.duration)) : 0

    const performanceStartTime = await page.evaluate(() => (window as any).__performanceStartTime || 0)
    const lastTaskEndTime =
        tasks.length > 0 ? tasks[tasks.length - 1].startTime + tasks[tasks.length - 1].duration : performanceStartTime

    return {
        totalBlockingTime: Math.round(totalBlockingTime),
        longTaskCount: tasks.length,
        longestTaskDuration: Math.round(longestTaskDuration),
        timeToQuiet: Math.round(lastTaskEndTime - performanceStartTime),
        tasks,
    }
}
