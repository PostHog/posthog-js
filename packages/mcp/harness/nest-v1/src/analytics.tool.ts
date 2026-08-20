import { Injectable } from '@nestjs/common'
import { Tool } from 'rekog-mcp-nest-v1'
// zod4 is the workspace alias for zod v4: mcp-nest 1.9 expects zod-4 schemas
// (validated by this copy via safeParse; converted to JSON Schema by the v1
// SDK's compat layer). packages/mcp's real-name zod stays v3 for the unit suite.
import { z } from 'zod4'

/**
 * The same three tools as the v2 harness — `echo` / `add` / `fail_always` — so the
 * two runs are directly comparable. Defined the mcp-nest 1.x way: an `@Injectable`
 * provider with `@Tool` methods.
 */
@Injectable()
export class AnalyticsTool {
  @Tool({
    name: 'echo',
    description: 'Echoes the text back. The happy path.',
    parameters: z.object({ text: z.string().describe('Text to echo back') }),
  })
  async echo({ text }: { text: string }) {
    return { content: [{ type: 'text', text: String(text ?? '') }] }
  }

  @Tool({
    name: 'add',
    description: 'Adds two numbers. A second tool — proves session continuity across tools.',
    parameters: z.object({ a: z.number(), b: z.number() }),
  })
  async add({ a, b }: { a: number; b: number }) {
    return { content: [{ type: 'text', text: String(Number(a) + Number(b)) }] }
  }

  @Tool({
    name: 'fail_always',
    description: 'Always throws. Exercises error capture and $exception.',
    parameters: z.object({}),
  })
  async failAlways() {
    throw new Error('intentional failure')
  }
}
