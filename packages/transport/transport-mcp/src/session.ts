/**
 * Responsibilities: Open an MCP client session (Streamable HTTP or stdio) and expose it through a narrow, SDK-free interface.
 * Contracts: `McpSession` lists tools and calls them with cancellation and a timeout; results are mapped to plain objects.
 * Constraints: This file is the only place that imports the MCP SDK, so SDK types never leak into the adapter or the runtime.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import type { JsonObject, JsonObjectSchema } from '@game-agent/contracts'

/** How to reach the MCP server exposed by a game or a game server bridge. */
export type McpConnection =
  | { readonly kind: 'streamable-http'; readonly url: string; readonly headers?: Readonly<Record<string, string>> }
  | { readonly kind: 'stdio'; readonly command: string; readonly args?: readonly string[]; readonly cwd?: string }

/** Tool as listed by the server. */
export interface McpToolInfo {
  readonly name: string
  readonly description: string
  readonly inputSchema: JsonObjectSchema
}

/** Plain result of one tool call. */
export interface McpToolResult {
  readonly isError: boolean
  readonly text: string
  readonly structured?: unknown
}

/** Narrow session interface used by the transport adapter. */
export interface McpSession {
  listTools(signal?: AbortSignal): Promise<readonly McpToolInfo[]>
  callTool(name: string, args: JsonObject, timeoutMs: number, signal?: AbortSignal): Promise<McpToolResult>
  close(): Promise<void>
}

/** Factory signature, injectable for tests. */
export type McpSessionFactory = (connection: McpConnection, signal?: AbortSignal) => Promise<McpSession>

/** Connect with the official MCP TypeScript SDK. */
export const connectMcpSession: McpSessionFactory = async (connection, signal) => {
  const client = new Client({ name: 'game-agent', version: '0.0.0' }, { capabilities: {} })
  const transport =
    connection.kind === 'streamable-http'
      ? new StreamableHTTPClientTransport(new URL(connection.url), { requestInit: { headers: { ...connection.headers } } })
      : new StdioClientTransport({
          command: connection.command,
          args: [...(connection.args ?? [])],
          ...(connection.cwd === undefined ? {} : { cwd: connection.cwd }),
        })
  await client.connect(transport, signal === undefined ? {} : { signal })
  return {
    async listTools(listSignal) {
      const result = await client.listTools(undefined, listSignal === undefined ? {} : { signal: listSignal })
      return result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema as unknown as JsonObjectSchema,
      }))
    },
    async callTool(name, args, timeoutMs, callSignal) {
      const result = await client.callTool({ name, arguments: args }, { timeout: timeoutMs, ...(callSignal === undefined ? {} : { signal: callSignal }) })
      const content = Array.isArray(result.content) ? result.content : []
      const text = content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text' && typeof (part as { text?: unknown }).text === 'string')
        .map((part) => part.text)
        .join('\n')
      return { isError: result.isError === true, text, ...(result.structuredContent === undefined ? {} : { structured: result.structuredContent }) }
    },
    close: () => client.close(),
  }
}
