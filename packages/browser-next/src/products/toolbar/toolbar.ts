import { createToolbar, readLocationHashState } from './toolbar-extension'
import type { ToolbarExtension, ToolbarOptions } from './toolbar-options'

export type { ToolbarExtension, ToolbarOptions, ToolbarParams } from './toolbar-options'

/**
 * Creates the toolbar extension. It loads the toolbar when the URL carries a toolbar authorization for this project
 * or a previous toolbar session saved its parameters. The URL hash is read now, before a router can replace it.
 */
export const toolbar = (options: ToolbarOptions = {}): ToolbarExtension =>
    createToolbar({ ...options }, readLocationHashState())
