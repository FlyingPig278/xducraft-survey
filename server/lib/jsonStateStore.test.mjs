import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { createJsonStateStore } from './jsonStateStore.mjs'

const tempDirs = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const createStore = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'xducraft-state-'))
  tempDirs.push(dir)
  const filePath = path.join(dir, 'app-state.json')
  return {
    filePath,
    store: createJsonStateStore({
      filePath,
      createSeed: () => ({ count: 0, items: [] }),
      normalize: (state) => ({ count: Number(state.count) || 0, items: state.items ?? [] })
    })
  }
}

describe('createJsonStateStore', () => {
  it('refuses to overwrite a malformed state file', async () => {
    const { filePath, store } = await createStore()
    await writeFile(filePath, '{ malformed', 'utf8')

    await expect(store.load()).rejects.toMatchObject({ code: 'INVALID_STATE_FILE' })
    await expect(store.update((state) => { state.count += 1 })).rejects.toMatchObject({ code: 'INVALID_STATE_FILE' })
    await expect(readFile(filePath, 'utf8')).resolves.toBe('{ malformed')
  })

  it('serializes updates across independent store instances', async () => {
    const { filePath, store } = await createStore()
    const secondStore = createJsonStateStore({
      filePath,
      createSeed: () => ({ count: 0, items: [] }),
      normalize: (state) => ({ count: Number(state.count) || 0, items: state.items ?? [] })
    })
    await Promise.all([
      store.update(async (state) => { await delay(30); state.count += 1 }),
      secondStore.update((state) => { state.count += 1 })
    ])

    await expect(store.load()).resolves.toMatchObject({ count: 2 })
  })

  it('keeps the previous valid snapshot as a backup', async () => {
    const { filePath, store } = await createStore()
    await store.update((state) => { state.count = 1 })
    await store.update((state) => { state.count = 2 })

    await expect(JSON.parse(await readFile(`${filePath}.bak`, 'utf8'))).toMatchObject({ count: 1 })
    await expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({ count: 2 })
  })
})
