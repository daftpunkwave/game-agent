/**
 * Responsibilities: Public entry of the MCP transport package.
 * Contracts: Re-exports the adapter, its configuration, and the SDK-free session interface.
 * Constraints: Consumers depend on the `TransportAdapter` port, not on MCP details.
 */
export * from './adapter.ts'
export * from './session.ts'
