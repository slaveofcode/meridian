import { vi } from 'vitest'

/**
 * Builds a vi.fn() that matches fetch calls by substring of URL.
 * responses: { '<url-substring>': { ok, status, data } }
 * Falls through to { ok: false, status: 404 } if no key matches.
 */
export function makeFetchMock(responses = {}) {
  return vi.fn(async (url) => {
    const key = Object.keys(responses).find((k) => String(url).includes(k))
    const res = key ? responses[key] : { ok: false, status: 404, data: {} }
    return {
      ok:   res.ok  ?? true,
      status: res.status ?? 200,
      json: async () => res.data ?? res,
      text: async () => JSON.stringify(res.data ?? res),
    }
  })
}
