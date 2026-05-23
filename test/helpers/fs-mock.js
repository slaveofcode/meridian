import { vi } from 'vitest'

/**
 * Creates an in-memory fs state. Pass initialFiles as { 'path': data } where
 * data can be an object (auto-stringified) or a raw string.
 *
 * Returns { fsMock, getJson } — fsMock is passed to vi.mock factory,
 * getJson reads back written content as parsed JSON.
 */
export function makeFsState(initialFiles = {}) {
  const store = new Map()

  for (const [filePath, data] of Object.entries(initialFiles)) {
    store.set(filePath, typeof data === 'string' ? data : JSON.stringify(data, null, 2))
  }

  const fsMock = {
    existsSync: vi.fn((p) => store.has(p)),
    readFileSync: vi.fn((p) => {
      if (!store.has(p)) {
        const err = new Error(`ENOENT: no such file or directory '${p}'`)
        err.code = 'ENOENT'
        throw err
      }
      return store.get(p)
    }),
    writeFileSync: vi.fn((p, content) => {
      store.set(p, typeof content === 'string' ? content : JSON.stringify(content))
    }),
  }

  const getJson = (p) => {
    const raw = store.get(p)
    return raw ? JSON.parse(raw) : null
  }

  return { fsMock, getJson, store }
}
