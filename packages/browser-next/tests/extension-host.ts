import type { IPostHog, IPostHogExtensionHost } from '../src/core/types'

/** The extension view of a client, for tests that send requests through it as an extension would. */
export const extensionHost = (client: IPostHog): IPostHogExtensionHost => client as IPostHogExtensionHost
