// The three tools, defined once and registered by both servers through their own SDK.
// Each exists to exercise exactly one capture path.
//
// zod4 is the workspace alias for zod v4: the v2 SDK requires zod-4 schemas, and the
// v1 SDK (>=1.30) accepts them through its compat layer — one schema form serves both.
// packages/mcp's real-name zod stays v3 for the unit suite.
import { z } from 'zod4'

export const TOOLS = [
    {
        name: 'echo',
        description: 'Echoes the text back. The happy path.',
        // Raw Zod shape — both SDK majors accept this form for registerTool().
        inputShape: { text: z.string().describe('Text to echo back') },
        jsonSchema: {
            type: 'object',
            properties: { text: { type: 'string', description: 'Text to echo back' } },
            required: ['text'],
        },
        handler: async (args) => ({ content: [{ type: 'text', text: String(args?.text ?? '') }] }),
    },
    {
        name: 'add',
        description: 'Adds two numbers. A second, different tool — proves session continuity across tools.',
        inputShape: { a: z.number(), b: z.number() },
        jsonSchema: {
            type: 'object',
            properties: { a: { type: 'number' }, b: { type: 'number' } },
            required: ['a', 'b'],
        },
        handler: async (args) => ({ content: [{ type: 'text', text: String(Number(args?.a) + Number(args?.b)) }] }),
    },
    {
        name: 'fail_always',
        description: 'Always throws. Exercises error capture and $exception.',
        inputShape: {},
        jsonSchema: { type: 'object', properties: {} },
        handler: async () => {
            throw new Error('intentional failure')
        },
    },
]

export const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]))
