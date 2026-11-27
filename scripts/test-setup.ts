/**
 * Responsibilities: Reset process state that would make test results depend on the developer's machine.
 * Contracts: Registered as a Vitest setup file; removes ambient outbound proxy variables and the Node.js flag that
 * enables them before any test module loads.
 * Constraints: Touches only the test process environment; suites that exercise proxy handling set the variables
 * they need themselves.
 */
import { PROXY_ENV_NAMES } from '../packages/util/http-proxy/src/policy.ts'

/** Node.js switch that makes the built-in fetch honor proxy variables. */
const NODE_PROXY_FLAG = 'NODE_USE_ENV_PROXY'

for (const name of [...PROXY_ENV_NAMES, NODE_PROXY_FLAG]) Reflect.deleteProperty(process.env, name)
