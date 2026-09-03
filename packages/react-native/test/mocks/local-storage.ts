const values = new Map<string, string>()

export const localStorage = {
  get length(): number {
    return values.size
  },
  getItem: vi.fn((key: string): string | null => values.get(key) ?? null),
  setItem: vi.fn((key: string, value: string): void => {
    values.set(key, value)
  }),
  removeItem: vi.fn((key: string): void => {
    values.delete(key)
  }),
  clear: vi.fn((): void => {
    values.clear()
  }),
  key: vi.fn((index: number): string | null => [...values.keys()][index] ?? null),
}
