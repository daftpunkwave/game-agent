import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { brandString } from '@game-agent/brand'
import type { AttachmentId, ImageVariantId } from '@game-agent/attachment/types'
import type { MessagesFileId } from '../src/file-id.ts'
import { messagesFileScope, MessagesUploadIndex } from '../src/upload-index.ts'

const ATTACHMENT = brandString<AttachmentId>(`sha256:${'a'.repeat(64)}`)
const VARIANT = brandString<ImageVariantId>(`sha256:${'b'.repeat(64)}`)

/** Every temp index root created by this file, removed after each test. */
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('MessagesUploadIndex', () => {
  it('normalizes trailing endpoint slashes in the credential scope', () => {
    expect(messagesFileScope('https://api.example.test///', 'key'))
      .toBe(messagesFileScope('https://api.example.test', 'key'))
  })

  it('isolates API-key namespaces and reuses only records above the refresh margin', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'game-agent-upload-index-'))
    roots.push(dir)
    const index = new MessagesUploadIndex(join(dir, 'index.json'))
    const first = messagesFileScope('https://api.example.test', 'first-key')
    const second = messagesFileScope('https://api.example.test', 'second-key')
    const record = {
      scope: first,
      attachmentId: ATTACHMENT,
      variantId: VARIANT,
      fileId: brandString<MessagesFileId>('file-api-one'),
      bytes: 3,
      createdAt: 1_000,
      expiresAt: 10_000,
    }

    await expect(index.commit(record, 1_000, 1_000)).resolves.toMatchObject({ accepted: true })
    await expect(index.get(first, VARIANT, 1_000, 1_000)).resolves.toEqual(record)
    await expect(index.get(second, VARIANT, 1_000, 1_000)).resolves.toBeUndefined()
    await expect(index.get(first, VARIANT, 9_000, 1_000)).resolves.toBeUndefined()
  })

  it('keeps a reusable cross-process winner and removes only an exact generation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'game-agent-upload-index-'))
    roots.push(dir)
    const index = new MessagesUploadIndex(join(dir, 'index.json'))
    const scope = messagesFileScope('https://api.example.test', 'key')
    const first = {
      scope, attachmentId: ATTACHMENT, variantId: VARIANT,
      fileId: brandString<MessagesFileId>('file-api-first'), bytes: 3, createdAt: 1, expiresAt: 10_000,
    }
    const duplicate = { ...first, fileId: brandString<MessagesFileId>('file-api-duplicate') }
    await index.commit(first, 1, 1)

    await expect(index.commit(duplicate, 2, 1)).resolves.toEqual({ record: first, accepted: false })
    await index.remove(scope, [{ variantId: VARIANT, fileId: duplicate.fileId }])
    await expect(index.get(scope, VARIANT, 2, 1)).resolves.toEqual(first)
    await index.remove(scope, [{ variantId: VARIANT, fileId: first.fileId }])
    await expect(index.get(scope, VARIANT, 2, 1)).resolves.toBeUndefined()
  })

  it('removes several exact generations in one update and keeps unlisted mappings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'game-agent-upload-index-'))
    roots.push(dir)
    const index = new MessagesUploadIndex(join(dir, 'index.json'))
    const scope = messagesFileScope('https://api.example.test', 'key')
    const record = (digest: string) => ({
      scope, attachmentId: ATTACHMENT, variantId: brandString<ImageVariantId>(`sha256:${digest.repeat(64)}`),
      fileId: brandString<MessagesFileId>(`file-api-${digest}`), bytes: 3, createdAt: 1, expiresAt: 10_000,
    })
    const first = record('b')
    const second = record('c')
    const third = record('d')
    for (const entry of [first, second, third]) await index.commit(entry, 1, 1)

    await index.remove(scope, [
      { variantId: first.variantId, fileId: first.fileId },
      { variantId: second.variantId, fileId: second.fileId },
      { variantId: third.variantId, fileId: brandString<MessagesFileId>('file-api-superseded') },
    ])
    await expect(index.get(scope, first.variantId, 2, 1)).resolves.toBeUndefined()
    await expect(index.get(scope, second.variantId, 2, 1)).resolves.toBeUndefined()
    await expect(index.get(scope, third.variantId, 2, 1)).resolves.toEqual(third)
  })

  it('treats a corrupt upload cache as empty and repairs it on the next commit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'game-agent-upload-index-'))
    roots.push(dir)
    const path = join(dir, 'index.json')
    await writeFile(path, '{bad', 'utf8')
    const index = new MessagesUploadIndex(path)
    const scope = messagesFileScope('https://api.example.test', 'key')
    const record = {
      scope,
      attachmentId: ATTACHMENT,
      variantId: VARIANT,
      fileId: brandString<MessagesFileId>('file-api-repaired'),
      bytes: 3,
      createdAt: 1,
      expiresAt: 10_000,
    }

    await expect(index.get(scope, VARIANT, 1, 1)).resolves.toBeUndefined()
    await expect(index.commit(record, 1, 1)).resolves.toEqual({ record, accepted: true })
    await expect(index.get(scope, VARIANT, 1, 1)).resolves.toEqual(record)
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ formatVersion: 3 })
  })

  it.each([
    'null',
    '[]',
    '{}',
    '{"formatVersion":1,"records":[]}',
    '{"formatVersion":2,"records":[]}',
    '{"formatVersion":3,"records":null}',
    '{"formatVersion":3,"records":[null]}',
    '{"formatVersion":3,"records":[[]]}',
    '{"formatVersion":3,"records":[{}]}',
    `{"formatVersion":3,"records":[${JSON.stringify({
      scope: 'x'.repeat(64), attachmentId: ATTACHMENT, variantId: VARIANT,
      fileId: 'file-api-one', bytes: 3, createdAt: 1, expiresAt: 10_000,
    })}]}`,
    `{"formatVersion":3,"records":[${JSON.stringify({
      scope: 'a'.repeat(64), attachmentId: 'wrong', variantId: VARIANT,
      fileId: 'file-api-one', bytes: 3, createdAt: 1, expiresAt: 10_000,
    })}]}`,
    `{"formatVersion":3,"records":[${JSON.stringify({
      scope: 'a'.repeat(64), attachmentId: ATTACHMENT, variantId: 'wrong',
      fileId: 'file-api-one', bytes: 3, createdAt: 1, expiresAt: 10_000,
    })}]}`,
    `{"formatVersion":3,"records":[${JSON.stringify({
      scope: 'a'.repeat(64), attachmentId: ATTACHMENT, variantId: VARIANT,
      fileId: '', bytes: 3, createdAt: 1, expiresAt: 10_000,
    })}]}`,
    `{"formatVersion":3,"records":[${JSON.stringify({
      scope: 'a'.repeat(64), attachmentId: ATTACHMENT, variantId: VARIANT,
      fileId: 'file-api-one', bytes: -1, createdAt: 1, expiresAt: 10_000,
    })}]}`,
    `{"formatVersion":3,"records":[${JSON.stringify({
      scope: 'a'.repeat(64), attachmentId: ATTACHMENT, variantId: VARIANT,
      fileId: 'file-api-one', bytes: 1.5, createdAt: 1, expiresAt: 10_000,
    })}]}`,
    `{"formatVersion":3,"records":[${JSON.stringify({
      scope: 'a'.repeat(64), attachmentId: ATTACHMENT, variantId: VARIANT,
      fileId: 'file-api-one', bytes: 3, createdAt: -1, expiresAt: 10_000,
    })}]}`,
    `{"formatVersion":3,"records":[${JSON.stringify({
      scope: 'a'.repeat(64), attachmentId: ATTACHMENT, variantId: VARIANT,
      fileId: 'file-api-one', bytes: 3, createdAt: 1.5, expiresAt: 10_000,
    })}]}`,
    `{"formatVersion":3,"records":[${JSON.stringify({
      scope: 'a'.repeat(64), attachmentId: ATTACHMENT, variantId: VARIANT,
      fileId: 'file-api-one', bytes: 3, createdAt: 1, expiresAt: -1,
    })}]}`,
    `{"formatVersion":3,"records":[${JSON.stringify({
      scope: 'a'.repeat(64), attachmentId: ATTACHMENT, variantId: VARIANT,
      fileId: 'file-api-one', bytes: 3, createdAt: 1, expiresAt: 1.5,
    })}]}`,
  ])('treats an invalid persisted index as empty %#', async (text) => {
    const dir = await mkdtemp(join(tmpdir(), 'game-agent-upload-index-'))
    roots.push(dir)
    const path = join(dir, 'index.json')
    await writeFile(path, text, 'utf8')
    const index = new MessagesUploadIndex(path)
    await expect(index.get(
      messagesFileScope('https://api.example.test', 'key'), VARIANT, 1, 1,
    )).resolves.toBeUndefined()
  })

  it('rejects duplicate persisted mappings as a corrupt cache', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'game-agent-upload-index-'))
    roots.push(dir)
    const path = join(dir, 'index.json')
    const scope = messagesFileScope('https://api.example.test', 'key')
    const record = {
      scope, attachmentId: ATTACHMENT, variantId: VARIANT,
      fileId: brandString<MessagesFileId>('file-api-one'), bytes: 3, createdAt: 1, expiresAt: 10_000,
    }
    await writeFile(path, JSON.stringify({ formatVersion: 3, records: [record, record] }), 'utf8')
    const index = new MessagesUploadIndex(path)
    await expect(index.get(scope, VARIANT, 1, 1)).resolves.toBeUndefined()
  })

  it('drops expired records on commit and clears only the selected namespace', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'game-agent-upload-index-'))
    roots.push(dir)
    const index = new MessagesUploadIndex(join(dir, 'index.json'))
    const first = messagesFileScope('https://api.example.test', 'first')
    const second = messagesFileScope('https://api.example.test', 'second')
    const expired = {
      scope: first, attachmentId: ATTACHMENT, variantId: VARIANT,
      fileId: brandString<MessagesFileId>('file-api-expired'), bytes: 3, createdAt: 1, expiresAt: 2,
    }
    const live = {
      ...expired, scope: second, fileId: brandString<MessagesFileId>('file-api-live'), expiresAt: 10_000,
    }
    await index.commit(expired, 0, 0)
    await index.commit(live, 3, 1)
    await index.clear(first)
    await index.clear(second)
    await expect(index.get(second, VARIANT, 3, 1)).resolves.toBeUndefined()
    await index.clear(second)
  })

  it('propagates non-cache filesystem read failures', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'game-agent-upload-index-'))
    roots.push(dir)
    const path = join(dir, 'directory')
    await mkdir(path)
    const index = new MessagesUploadIndex(path)
    await expect(index.get(
      messagesFileScope('https://api.example.test', 'key'), VARIANT, 1, 1,
    )).rejects.toBeInstanceOf(Error)
  })
})
