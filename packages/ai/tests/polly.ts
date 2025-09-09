import path from 'path'

import { setupPolly } from 'setup-polly-jest'
import NodeHttpAdapter from '@pollyjs/adapter-node-http'
import FetchAdapter from '@pollyjs/adapter-fetch'
import FSPersister from '@pollyjs/persister-fs'

const recordingsDir = path.resolve(__dirname, '../test/recordings')

export function setupHttpRecording() {
  return setupPolly({
    adapters: [NodeHttpAdapter, FetchAdapter],
    persister: FSPersister,
    persisterOptions: { fs: { recordingsDir } },
    logLevel: 'error',
    recordFailedRequests: true,
    recordIfMissing: process.env.RECORD_NEW_REQUESTS === 'true',
    matchRequestsBy: {
      headers: (headers) => {
        delete headers['authorization']
        delete headers['user-agent']
        for (const header in headers) {
          if (header.startsWith('x-stainless-')) {
            delete headers[header]
          }
        }
        return headers
      },
    },
  })
}
