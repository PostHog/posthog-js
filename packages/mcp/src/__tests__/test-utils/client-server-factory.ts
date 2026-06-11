import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

interface Todo {
  completed: boolean
  id: string
  text: string
}

let todos: Todo[] = []
let nextId = 1

export function resetTodos() {
  todos = []
  nextId = 1
}

export async function setupTestServerAndClient() {
  // Create server instance
  const server = new McpServer({
    name: 'test server',
    version: '1.0',
  })

  // Register tools with the server
  server.tool(
    'add_todo',
    'Add a new todo item',
    {
      text: z.string().describe('The text of the todo item'),
    },
    async (args) => {
      const todo: Todo = {
        id: String(nextId++),
        text: args.text,
        completed: false,
      }
      todos.push(todo)
      return {
        content: [
          {
            type: 'text',
            text: `Added todo: "${args.text}" with ID ${todo.id}`,
          },
        ],
      }
    }
  )

  server.tool('list_todos', 'List all todo items', {}, async () => {
    const todoList = todos.map((todo) => `${todo.id}: ${todo.text} ${todo.completed ? '✓' : '○'}`).join('\n')
    return {
      content: [
        {
          type: 'text',
          text: todoList || 'No todos found',
        },
      ],
    }
  })

  server.registerTool(
    'complete_todo',
    {
      description: 'Mark a todo item as completed',
      inputSchema: {
        id: z.string().describe('The ID of the todo to complete'),
      },
    },
    async (args) => {
      const todo = todos.find((t) => t.id === args.id)
      if (!todo) {
        throw new Error(`Todo with ID ${args.id} not found`)
      }
      todo.completed = true
      return {
        content: [
          {
            type: 'text',
            text: `Completed todo: "${todo.text}"`,
          },
        ],
      }
    }
  )

  // Create client instance
  const client = new Client(
    {
      name: 'test client',
      version: '1.0',
    },
    {
      capabilities: {
        sampling: {},
      },
    }
  )

  // Set up default request handler for sampling/createMessage
  client.setRequestHandler(CreateMessageRequestSchema, async () => ({
    model: 'test-model',
    role: 'assistant',
    content: {
      type: 'text',
      text: 'This is a test response',
    },
  }))

  // Create transport pair and connect
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  await Promise.all([client.connect(clientTransport), server.server.connect(serverTransport)])

  // Return everything you need
  return {
    server,
    client,
    clientTransport,
    serverTransport,
    // Cleanup function
    async cleanup() {
      if (clientTransport) {
        await clientTransport.close?.()
      }
      if (serverTransport) {
        await serverTransport.close?.()
      }
    },
  }
}
