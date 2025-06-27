import { cleanup, init } from 'detox'

const config = require('../.detoxrc.json')

jest.setTimeout(120000)

beforeAll(async () => {
  await init(config)
})

afterAll(async () => {
  await cleanup()
})
