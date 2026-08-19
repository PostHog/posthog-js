import { Module } from '@nestjs/common';
import { McpStrategy, MCP_STRATEGY, StreamableHttpTransport } from 'rekog-mcp-nest-v2';
import { AnalyticsController } from './analytics.controller';
import { instrumentationMutator, instrumentationMutatorLowLevel } from './posthog';

/**
 * `LEVEL=low` uses the `instrument(server.server)` workaround users adopted to get
 * past the compatibility gate. Both are kept so we can measure whether the
 * workaround actually costs them anything on this adapter.
 */
const LEVEL = process.env.LEVEL === 'low' ? 'low' : 'high';

/**
 * `dual` serves both protocol eras off one endpoint, which is what a real v2
 * deployment looks like — clients migrate slower than servers. `statefulMode:
 * false` is the reported topology: a fresh `McpServer` per HTTP request.
 */
export const mcp = new McpStrategy({
  name: 'nest-v2-acceptance',
  version: '1.0.0',
  transports: [
    new StreamableHttpTransport({
      endpoint: '/mcp',
      statefulMode: false,
      enableJsonResponse: true,
      protocol: process.env.PROTOCOL === 'legacy-only' ? 'legacy-only' : 'dual',
    }),
  ],
  serverMutator: LEVEL === 'low' ? instrumentationMutatorLowLevel : instrumentationMutator,
});

@Module({
  controllers: [AnalyticsController],
  providers: [{ provide: MCP_STRATEGY, useValue: mcp }],
})
export class AppModule {}
