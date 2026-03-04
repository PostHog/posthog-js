/* eslint-disable no-console */

import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { PostHog } from 'posthog-node'
import { PostHogInterceptor } from 'posthog-node/nestjs'
import { AppModule } from './app.module'

const { POSTHOG_PROJECT_API_KEY, POSTHOG_HOST } = process.env

export const posthog = new PostHog(POSTHOG_PROJECT_API_KEY!, {
    host: POSTHOG_HOST,
    flushAt: 1,
})

posthog.debug()

async function bootstrap() {
    const app = await NestFactory.create(AppModule)

    app.useGlobalInterceptors(new PostHogInterceptor(posthog))

    await app.listen(8030)
    console.log('⚡: NestJS server is running at http://localhost:8030')
}

bootstrap()

async function handleExit(signal: string) {
    console.log(`Received ${signal}. Flushing...`)
    await posthog.shutdown()
    console.log('Flush complete')
    process.exit(0)
}
process.on('SIGINT', handleExit)
process.on('SIGQUIT', handleExit)
process.on('SIGTERM', handleExit)
