import { uuidv7 } from '../vendor/uuidv7'

export class PromiseQueue {
  private promiseByIds: Record<string, Promise<any>> = {}

  public add(promise: Promise<any>): Promise<any> {
    const promiseUUID = uuidv7()
    this.promiseByIds[promiseUUID] = promise
    promise
      .catch(() => {})
      .finally(() => {
        delete this.promiseByIds[promiseUUID]
      })
    return promise
  }

  public async join(): Promise<void> {
    let promises = Object.values(this.promiseByIds)
    let length = promises.length
    while (length > 0) {
      await Promise.all(promises)
      promises = Object.values(this.promiseByIds)
      length = promises.length
    }
  }

  public async joinAllSettled(ignoredPromises: Promise<any>[] = []): Promise<void> {
    const ignoredPromiseSet = new Set(ignoredPromises)
    let promises = Object.values(this.promiseByIds).filter((promise) => !ignoredPromiseSet.has(promise))
    let length = promises.length
    while (length > 0) {
      await Promise.all(promises.map((promise) => promise.catch(() => {})))
      promises = Object.values(this.promiseByIds).filter((promise) => !ignoredPromiseSet.has(promise))
      length = promises.length
    }
  }

  public get length(): number {
    return Object.keys(this.promiseByIds).length
  }
}
