import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import type { Request, Response } from 'express'
import { AppModule, mcp } from './app.module'
import { events, warnings, extraShapes, reset } from './posthog'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] })

  // Inspection routes, so verify.mjs can assert out of process.
  const http = app.getHttpAdapter().getInstance()
  http.get('/__events', (_req: Request, res: Response) => res.json({ events, warnings, extraShapes }))
  http.get('/__reset', (_req: Request, res: Response) => {
    reset()
    res.json({ ok: true })
  })

  mcp.setHttpAdapter(app.getHttpAdapter())
  app.connectMicroservice({ strategy: mcp })
  // Order matters: MCP routes mount here, before listen() accepts connections.
  await app.startAllMicroservices()

  // PORT=0 (the default) binds an ephemeral port; the chosen port is announced
  // on stdout for the verifier. Set PORT explicitly for manual runs.
  const server = await app.listen(Number(process.env.PORT ?? 0))
  const port = (server.address() as { port: number }).port
  console.log(`MCP_HARNESS_LISTENING port=${port}`)
  console.error(`server.ready http://localhost:${port}/mcp  LEVEL=${process.env.LEVEL ?? 'high'} (stateless, dual-era)`)
}

void bootstrap()
