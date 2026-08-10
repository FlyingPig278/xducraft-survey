import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import handler from './vercelProxy.mjs'

const servers = []
const originalEnv = {
  upstream: process.env.XDUCRAFT_UPSTREAM_API,
  secret: process.env.XDUCRAFT_PROXY_SECRET
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    const closed = Promise.withResolvers()
    server.close(closed.resolve)
    await closed.promise
  }))
  if (originalEnv.upstream === undefined) delete process.env.XDUCRAFT_UPSTREAM_API
  else process.env.XDUCRAFT_UPSTREAM_API = originalEnv.upstream
  if (originalEnv.secret === undefined) delete process.env.XDUCRAFT_PROXY_SECRET
  else process.env.XDUCRAFT_PROXY_SECRET = originalEnv.secret
})

const listen = async (server) => {
  const ready = Promise.withResolvers()
  server.once('error', ready.reject)
  server.listen(0, '127.0.0.1', ready.resolve)
  await ready.promise
  servers.push(server)
  const address = server.address()
  return typeof address === 'object' && address ? address.port : 0
}

describe('Vercel proxy handler', () => {
  it('rewrites the catch-all path and injects the trusted proxy secret', async () => {
    let receivedPath = ''
    let receivedSecret = ''
    const upstream = createServer((req, res) => {
      receivedPath = req.url ?? ''
      receivedSecret = String(req.headers['x-xducraft-proxy-secret'] ?? '')
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
    })
    const upstreamPort = await listen(upstream)
    process.env.XDUCRAFT_UPSTREAM_API = `http://127.0.0.1:${upstreamPort}`
    process.env.XDUCRAFT_PROXY_SECRET = 'proxy-integration-secret-value-1234567890'

    const proxy = createServer((req, res) => { void handler(req, res) })
    const proxyPort = await listen(proxy)
    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/proxy?path=health`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(receivedPath).toBe('/api/health')
    expect(receivedSecret).toBe(process.env.XDUCRAFT_PROXY_SECRET)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('strips content-encoding and forwards the decompressed body', async () => {
    const payload = JSON.stringify({ ok: true, body: '中文内容'.repeat(20) })
    const compressed = gzipSync(Buffer.from(payload))
    let receivedAcceptEncoding = ''
    const upstream = createServer((req, res) => {
      receivedAcceptEncoding = String(req.headers['accept-encoding'] ?? '')
      res.setHeader('content-type', 'application/json')
      res.setHeader('content-encoding', 'gzip')
      res.setHeader('content-length', compressed.byteLength)
      res.end(compressed)
    })
    const upstreamPort = await listen(upstream)
    process.env.XDUCRAFT_UPSTREAM_API = `http://127.0.0.1:${upstreamPort}`
    process.env.XDUCRAFT_PROXY_SECRET = 'proxy-integration-secret-value-1234567890'

    const proxy = createServer((req, res) => { void handler(req, res) })
    const proxyPort = await listen(proxy)
    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/proxy?path=health`)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(receivedAcceptEncoding).toBe('identity')
    expect(response.headers.get('content-encoding')).toBeNull()
    expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(payload)))
    expect(body).toBe(payload)
  })

  it('rejects traversal segments before contacting the upstream', async () => {
    process.env.XDUCRAFT_UPSTREAM_API = 'http://127.0.0.1:9'
    process.env.XDUCRAFT_PROXY_SECRET = 'proxy-integration-secret-value-1234567890'
    const proxy = createServer((req, res) => { void handler(req, res) })
    const proxyPort = await listen(proxy)

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/proxy?path=../health`)

    expect(response.status).toBe(400)
  })
})
