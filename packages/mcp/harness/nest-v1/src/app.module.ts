import { Module } from '@nestjs/common'
import { McpModule, McpTransportType } from 'rekog-mcp-nest-v1'
import { AnalyticsTool } from './analytics.tool'
import { instrumentationMutator, instrumentationMutatorLowLevel } from './posthog'

const LEVEL = process.env.LEVEL === 'low' ? 'low' : 'high'

@Module({
  imports: [
    McpModule.forRoot({
      name: 'nest-v1-acceptance',
      version: '1.0.0',
      transport: McpTransportType.STREAMABLE_HTTP,
      streamableHttp: {
        // The same topology as the v2 harness: a fresh server per HTTP request.
        statelessMode: true,
        // Required for the minted Mcp-Session-Id token to reach the client — on
        // SSE the headers are flushed before the handler runs.
        enableJsonResponse: true,
      },
      logging: false,
      serverMutator: LEVEL === 'low' ? instrumentationMutatorLowLevel : instrumentationMutator,
    }),
  ],
  providers: [AnalyticsTool],
})
export class AppModule {}
