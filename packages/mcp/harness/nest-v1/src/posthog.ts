// A posthog-node stand-in that records events in memory. No API key, no network —
// verify.mjs reads the recorded array back over /__events.
//
// The logger matters as much as the events. `instrument()` reports every internal
// failure through it and otherwise returns a healthy-looking handle, which is the
// exact silent-degradation this harness exists to catch.

import { instrument } from '@posthog/mcp';

export interface RecordedEvent {
  event: string;
  distinctId?: string;
  properties?: Record<string, unknown>;
}

export const events: RecordedEvent[] = [];
export const warnings: string[] = [];

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function summarise(e: RecordedEvent): string {
  const p = e.properties ?? {};
  return [
    e.event,
    p.$mcp_tool_name ? `tool=${p.$mcp_tool_name}` : null,
    p.$session_id ? `session=${String(p.$session_id).slice(0, 12)}…` : null,
    p.$mcp_client_name ? `client=${p.$mcp_client_name}` : null,
    p.$mcp_protocol_version ? `proto=${p.$mcp_protocol_version}` : null,
    p.$mcp_intent ? `intent=${JSON.stringify(p.$mcp_intent)}` : null,
    p.$mcp_is_error ? 'ERROR' : null,
  ]
    .filter(Boolean)
    .join(' ');
}

function record(event: RecordedEvent): void {
  events.push(event);
  console.log(`${DIM}[posthog]${RESET} ${summarise(event)}`);
}

const client = {
  capture: (event: RecordedEvent) => record(event),
  identify: (event: RecordedEvent) => record({ ...event, event: '$identify' }),
  captureException: (error: unknown, distinctId?: string, properties?: Record<string, unknown>) =>
    record({ event: '$exception', distinctId, properties: { ...properties, message: String(error) } }),
  flush: async () => {},
  shutdown: async () => {},
};

const logger = (...args: unknown[]): void => {
  const line = args.join(' ');
  // Match the SDK's own prefixes only, so routine notices are not counted as
  // failures. A substring match on /fail/ would flag "Tool fail_always callback
  // already wrapped".
  if (/^(Warning|Error):|compatibility error|Failed to /.test(line)) warnings.push(line);
  console.log(`${DIM}[posthog:sdk]${RESET} ${line}`);
};

export function reset(): void {
  events.length = 0;
  warnings.length = 0;
}

/**
 * `identify` deliberately reads a header, and reads it the **v1 way**.
 *
 * Same callback as the v2 harness, so the two are directly comparable. Here it is
 * reading the shape the SDK actually provides, so it must resolve a user — that
 * is the point of running it on v1.
 */
function identifyFromHeader(_request: unknown, extra: any) {
  const auth =
    extra?.requestInfo?.headers?.['authorization'] ??
    extra?.requestInfo?.headers?.['Authorization'];
  if (typeof auth !== 'string') return null;
  const token = auth.replace(/^Bearer\s+/i, '');
  return { distinctId: `user_${token}`, properties: { token } };
}

/**
 * The integration under test. mcp-nest 1.x calls this with the high-level SDK v1
 * `McpServer`, then binds its handlers afterwards with Zod request schemas.
 *
 * This is the v1 no-regression guard for the NestJS adapter: these numbers must
 * not move when v2 support lands.
 */
export const instrumentationMutator = (server: any) => {
  instrument(server, client as any, {
    logger,
    context: true,
    enableConversationId: true,
    identify: identifyFromHeader as any,
  });
  return server;
};

/** Same, but through the `instrument(server.server)` workaround users adopted. */
export const instrumentationMutatorLowLevel = (server: any) => {
  instrument(server.server, client as any, {
    logger,
    context: true,
    enableConversationId: true,
    identify: identifyFromHeader as any,
  });
  return server;
};
