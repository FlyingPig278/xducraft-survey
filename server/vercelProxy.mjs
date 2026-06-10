import { randomUUID } from 'node:crypto'

const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length'
])

const upstreamBase = () => {
  const value = (process.env.XDUCRAFT_UPSTREAM_API || '').trim()
  if (!value) return null
  try {
    return new URL(value)
  } catch {
    return null
  }
}

const now = () => new Date().toISOString()

const createTraceId = () => `proxy-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`

const queryKeysForLog = (url) => [...new Set([...url.searchParams.keys()])]

const urlForLog = (url) => ({
  origin: url.origin,
  pathname: url.pathname,
  queryKeys: queryKeysForLog(url)
})

const incomingForLog = (req) => {
  const incoming = new URL(req.url || '/', `https://${req.headers.host || 'localhost'}`)
  return {
    host: req.headers.host || '',
    pathname: incoming.pathname,
    queryKeys: queryKeysForLog(incoming)
  }
}

const describeProxyError = (error) => {
  if (!(error instanceof Error)) return { message: String(error) }
  const cause = error.cause instanceof Error
    ? {
        name: error.cause.name,
        message: error.cause.message,
        code: error.cause.code,
        errno: error.cause.errno,
        address: error.cause.address,
        port: error.cause.port
      }
    : undefined
  return {
    name: error.name,
    message: error.message,
    code: error.code,
    cause
  }
}

const writeProxyLog = (level, event, fields = {}) => {
  const record = {
    ts: now(),
    pid: process.pid,
    event,
    ...fields
  }
  const line = JSON.stringify(record)
  if (level === 'error') console.error(line)
  else console.log(line)
}

const readBody = async (req) => {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined

  if (req.body !== undefined) {
    if (Buffer.isBuffer(req.body)) return req.body
    if (typeof req.body === 'string') return req.body
    return JSON.stringify(req.body)
  }

  const chunks = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined
}

const buildTargetUrl = (req, upstream) => {
  const incoming = new URL(req.url || '/', `https://${req.headers.host || 'localhost'}`)
  const upstreamPath = upstream.pathname.replace(/\/+$/, '')
  const rewrittenPath = incoming.searchParams.get('path')
  if (rewrittenPath !== null) {
    incoming.searchParams.delete('path')
    const suffix = rewrittenPath
      .split('/')
      .map((part) => encodeURIComponent(decodeURIComponent(part)))
      .join('/')
    return new URL(`${upstreamPath}/api/${suffix}${incoming.search}`, upstream.origin)
  }
  return new URL(`${upstreamPath}${incoming.pathname}${incoming.search}`, upstream.origin)
}

const buildHeaders = (req, traceId) => {
  const headers = new Headers()
  Object.entries(req.headers).forEach(([key, value]) => {
    const normalizedKey = key.toLowerCase()
    if (hopByHopHeaders.has(normalizedKey) || value === undefined) return
    headers.set(key, Array.isArray(value) ? value.join(', ') : String(value))
  })

  headers.set('x-forwarded-host', String(req.headers['x-forwarded-host'] || req.headers.host || ''))
  headers.set('x-forwarded-proto', String(req.headers['x-forwarded-proto'] || 'https'))
  headers.set('x-xducraft-proxy-trace', traceId)

  const proxySecret = (process.env.XDUCRAFT_PROXY_SECRET || '').trim()
  if (proxySecret) headers.set('x-xducraft-proxy-secret', proxySecret)

  return headers
}

const sendJson = (res, statusCode, body) => {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

export default async function handler(req, res) {
  const traceId = createTraceId()
  const startedAt = Date.now()
  res.setHeader('x-xducraft-proxy-trace', traceId)
  res.setHeader('x-xducraft-proxy-started-at', now())

  const upstream = upstreamBase()
  if (!upstream) {
    writeProxyLog('error', 'proxy.config.missing_upstream', {
      traceId,
      request: incomingForLog(req)
    })
    sendJson(res, 500, { error: 'Vercel API 代理未配置 XDUCRAFT_UPSTREAM_API。', traceId })
    return
  }

  const timeoutMs = Math.max(1000, Number(process.env.XDUCRAFT_PROXY_TIMEOUT_MS || 15000))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const targetUrl = buildTargetUrl(req, upstream)

  writeProxyLog('info', 'proxy.request.start', {
    traceId,
    method: req.method,
    request: incomingForLog(req),
    target: urlForLog(targetUrl),
    timeoutMs
  })

  try {
    const upstreamResponse = await fetch(targetUrl, {
      method: req.method,
      headers: buildHeaders(req, traceId),
      body: await readBody(req),
      redirect: 'manual',
      signal: controller.signal
    })

    clearTimeout(timeout)
    const elapsedMs = Date.now() - startedAt
    res.statusCode = upstreamResponse.status
    upstreamResponse.headers.forEach((value, key) => {
      if (!hopByHopHeaders.has(key.toLowerCase())) res.setHeader(key, value)
    })
    res.setHeader('x-xducraft-proxy-elapsed-ms', String(elapsedMs))
    if (!res.getHeader('cache-control')) res.setHeader('cache-control', 'no-store')
    writeProxyLog(upstreamResponse.status >= 500 ? 'error' : 'info', 'proxy.request.finish', {
      traceId,
      method: req.method,
      target: urlForLog(targetUrl),
      status: upstreamResponse.status,
      elapsedMs
    })
    res.end(Buffer.from(await upstreamResponse.arrayBuffer()))
  } catch (error) {
    clearTimeout(timeout)
    const timedOut = error instanceof Error && error.name === 'AbortError'
    const elapsedMs = Date.now() - startedAt
    writeProxyLog('error', 'proxy.request.failure', {
      traceId,
      method: req.method,
      target: urlForLog(targetUrl),
      status: timedOut ? 504 : 502,
      elapsedMs,
      error: describeProxyError(error)
    })
    res.setHeader('x-xducraft-proxy-elapsed-ms', String(elapsedMs))
    sendJson(res, timedOut ? 504 : 502, {
      error: timedOut ? '后端 API 代理超时。' : '后端 API 代理失败。',
      traceId
    })
  }
}
