/** A context with the request authentication service over stand-in credential planes. */
import { Context } from '@game-agent/kernel'
import MessagesAuth, { type MessagesAuthCandidate, type MessagesAuthRequest, type MessagesAuthUnresolved } from '@game-agent/messages-auth'
import { GAME_AGENT_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot } from '@game-agent/launch-environment'

/** Credential planes of one test context. */
export interface Planes {
  /** Launch-environment variables. */
  environment?: Record<string, string>
  /** Values of the mounted credentials service by reference; omitted mounts no service. */
  stored?: Record<string, string>
}

/** Deployment `MODEL_BASE_URL` names in contexts that set it. */
export const DEPLOYMENT = 'https://api.example.test/anthropic'

const mounted: Context[] = []

/** Dispose every context {@link mount} created. */
export async function disposeMounted(): Promise<void> {
  await Promise.all(mounted.splice(0).map(ctx => ctx.fiber.dispose()))
}

/**
 * Mount the service.
 * @param planes - the credential planes it reads.
 * @returns the context.
 */
export async function mount(planes: Planes = {}): Promise<Context> {
  const ctx = new Context()
  mounted.push(ctx)
  ctx.provide(GAME_AGENT_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([{ source: 'process', values: planes.environment ?? {} }]))
  const { stored } = planes
  if (stored !== undefined) {
    ctx.provide('credentials', {
      resolve: (ref: string) => Promise.resolve(stored[ref] === undefined ? undefined : { value: stored[ref] }),
      describe: (ref: string) => Promise.resolve({ configured: (stored[ref]?.length ?? 0) > 0 }),
    } as never)
  }
  await ctx.plugin(MessagesAuth)
  return ctx
}

/** A request to the model listing accepting the API key, with overrides. */
export function request(overrides: Partial<MessagesAuthRequest> = {}): MessagesAuthRequest {
  return { consumer: 'web-test', accepts: ['api-key'], destination: { path: '/v1/models' }, ...overrides }
}

/** Each entry as `kind endpoint`, or `kind !unresolved` for an unresolved kind. */
export function summary(entries: readonly (MessagesAuthCandidate | MessagesAuthUnresolved)[]): string[] {
  return entries.map(entry => 'unresolved' in entry ? `${entry.kind} !${entry.unresolved}` : `${entry.kind} ${entry.endpoint}`)
}

/** Narrow an entry to a candidate, failing the test for an unresolved kind. */
export function candidate(entry: MessagesAuthCandidate | MessagesAuthUnresolved | undefined): MessagesAuthCandidate {
  if (entry === undefined || 'unresolved' in entry) throw new Error('expected a candidate')
  return entry
}
