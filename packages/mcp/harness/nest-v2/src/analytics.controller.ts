import { McpController, Tool } from 'rekog-mcp-nest-v2';
import { Payload } from '@nestjs/microservices';

/**
 * Three tools, mirroring the dual-era testbed's `echo` / `add` / `fail_always`
 * so results are comparable across harnesses. Defined the mcp-nest 2.0 way — an
 * `@McpController` with `@Tool` methods, discovered and bound by the strategy.
 *
 * Parameters are raw JSON Schema objects — one of mcp-nest 2.0's supported
 * schema forms, and the one that keeps this fixture independent of which zod
 * major mcp-nest's own zod import resolves to (its zod-typed path calls
 * `z.toJSONSchema`, a zod-4-only API).
 *
 * Note what this does *not* do: it never calls `registerTool()`. mcp-nest binds
 * `tools/list` and `tools/call` directly on the low-level server, so
 * `_registeredTools` stays empty on the high-level `McpServer` we are handed.
 */
@McpController()
export class AnalyticsController {
  @Tool({
    name: 'echo',
    description: 'Echoes the text back. The happy path.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to echo back' } },
      required: ['text'],
    },
  })
  async echo(@Payload() { text }: { text: string }) {
    return { content: [{ type: 'text', text: String(text ?? '') }] };
  }

  @Tool({
    name: 'add',
    description: 'Adds two numbers. A second tool — proves session continuity across tools.',
    parameters: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
  })
  async add(@Payload() { a, b }: { a: number; b: number }) {
    return { content: [{ type: 'text', text: String(Number(a) + Number(b)) }] };
  }

  @Tool({
    name: 'fail_always',
    description: 'Always throws. Exercises error capture and $exception.',
    parameters: { type: 'object', properties: {} },
  })
  async failAlways() {
    throw new Error('intentional failure');
  }
}
