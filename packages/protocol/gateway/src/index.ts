/**
 * Responsibilities: Public entry of the gateway package: the single ingress and single egress of an agent.
 * Contracts: Re-exports gateways, visibility cropping, player-text tagging, and quota enforcement.
 * Constraints: Nothing outside this package may talk to a transport adapter or bypass these stages.
 */
export * from './egress.ts'
export * from './ingress.ts'
export * from './quota.ts'
export * from './untrusted-text.ts'
export * from './visibility.ts'
