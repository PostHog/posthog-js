export const wait = async (t: number): Promise<void> => {
  await new Promise<void>((r) => setTimeout(r, t))
}

export const waitForExpect = async (timeout: number, fn: () => void): Promise<void> => {
  const start = Date.now()
  while (true) {
    try {
      fn()
      return
    } catch (e) {
      if (Date.now() - start > timeout) {
        throw e
      }
      await wait(10)
    }
  }
}
