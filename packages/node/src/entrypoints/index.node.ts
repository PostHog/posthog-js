export * from '../exports'

import { createModulerModifier } from '../extensions/error-tracking/modifiers/module.node'
import { addSourceContext } from '../extensions/error-tracking/modifiers/context-lines.node'
import { createRelativePathModifier } from '../extensions/error-tracking/modifiers/relative-path.node'

import type { PostHogFetchBodyBytes } from '@posthog/core'
import { PostHogBackendClient } from '../client'
import { ErrorTracking as CoreErrorTracking } from '@posthog/core'
import type { SpanContextManager } from '@posthog/core'
import { PostHogContext } from '../extensions/context/context'
import { AsyncLocalStorageSpanContextManager } from '../extensions/context/span-context.node'
import { gzipCompress } from '../gzip.node'
import { hostOsResourceAttributes } from '../host-os.node'
import { nodeTemplateFiles } from '../email-template-file.node'
import type { NodeEmails } from '../emails'

export class PostHog extends PostHogBackendClient {
  private _nodeEmails?: NodeEmails

  getLibraryId(): string {
    return 'posthog-node'
  }

  /**
   * The `posthog.emails` API: send transactional email from an HTML template file in your repository, or from a
   * template uploaded to PostHog, by its key. Needs the `secretKey` client option.
   *
   * @example
   * ```ts
   * const welcome = client.emails.templateFile(new URL('./emails/welcome.html', import.meta.url))
   * const { data, error } = await client.emails.send({ template: welcome, to: 'jane@example.com' })
   * ```
   *
   * {@label Emails}
   */
  override get emails(): NodeEmails {
    this._nodeEmails ??= this.createEmails(nodeTemplateFiles)
    return this._nodeEmails
  }

  protected override compressPayload(payload: string): Promise<PostHogFetchBodyBytes | null> {
    return gzipCompress(payload, this.isDebug)
  }

  protected initializeContext(): PostHogContext {
    return new PostHogContext()
  }

  protected override initializeSpanContextManager(): SpanContextManager {
    return new AsyncLocalStorageSpanContextManager()
  }

  protected override hostResourceAttributes(): Record<string, string> {
    return hostOsResourceAttributes()
  }

  protected override createErrorPropertiesBuilder(): CoreErrorTracking.ErrorPropertiesBuilder {
    return new CoreErrorTracking.ErrorPropertiesBuilder(
      [
        new CoreErrorTracking.EventCoercer(),
        new CoreErrorTracking.ErrorCoercer(),
        new CoreErrorTracking.ObjectCoercer(),
        new CoreErrorTracking.StringCoercer(),
        new CoreErrorTracking.PrimitiveCoercer(),
      ],
      CoreErrorTracking.createStackParser('node:javascript', CoreErrorTracking.nodeStackLineParser),
      [
        createModulerModifier(),
        (frames) => addSourceContext(frames, undefined, this._logger),
        createRelativePathModifier(),
      ]
    )
  }
}
