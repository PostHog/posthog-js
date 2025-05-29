**How to Add New Products**

Below is an example of how to add a new product, based on the In-app Messenger feature.

1. Add a new file with the name of the product (e.g., `chat.ts`) to the `src/entrypoints/` directory.
2. In this file, add your product to `assignableWindow.__PosthogExtensions__`:
```typescript
assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.loadChat = assignableWindow.__PosthogExtensions__.loadChat || loadChat
```
3. Add a new file named `posthog-%productName%.ts` (e.g., `posthog-chat.ts`) to the `src/` folder.
   Code in this file is not lazy-loaded, so keep it minimal to avoid increasing the bundle size.
   Inside, define your class (e.g., `export class PostHogChat`) and include the following methods:
    - `startIfEnabled()`: This method will be called if the feature is enabled.
    - `onRemoteConfig()`: This method will be called when the remote configuration is received.
    - `reset()`: This method will be called when a user logs out.

4. In `src/posthog-core.ts`:
    - Import your class, e.g., `import { PostHogChat } from './posthog-chat'`.
    - Add your class as a property to the `PostHog` class definition, e.g., `chat: PostHogChat`.
    - Instantiate your class in the `PostHog` constructor, e.g., `this.chat = new PostHogChat(this)`.
    - In the `_init` function, call `startIfEnabled()`, e.g., `this.chat.startIfEnabled()`.
    - In the `_onRemoteConfig` function, call `onRemoteConfig()`, e.g., `this.chat.onRemoteConfig(config)`.
    - In the `reset` function, call `reset()`, e.g., `this.chat.reset()`.
    - In the `set_config` function, call `startIfEnabled()`, e.g., `this.chat?.startIfEnabled()`.