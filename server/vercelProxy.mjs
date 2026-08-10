import { randomUUID } from 'node:crypto'
import { httpError, parseIntegerEnv, validateSecret } from './lib/httpUtils.mjs'

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
  'content-length',
  // fetch 会自动解压 gzip/br，转发解压后的 body 时必须去掉原压缩标记，
  // 否则客户端按 content-encoding 解压明文会得到空响应。
  'content-encoding'
])

const upstreamBase = () => {
  const value = (process.env.XDUCRAFT_UPSTREAM_API || '').trim()
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
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

const readBody = async (req, maxBytes) => {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined

  if (req.body !== undefined) {
    const body = Buffer.isBuffer(req.body)
      ? req.body
      : typeof req.body === 'string'
        ? Buffer.from(req.body)
        : Buffer.from(JSON.stringify(req.body))
    if (body.length > maxBytes) throw httpError(413, '请求体过大。')
    return body
  }

  const chunks = []
  let totalBytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.length
    if (totalBytes > maxBytes) throw httpError(413, '请求体过大。')
    chunks.push(buffer)
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined
}

const buildTargetUrl = (req, upstream) => {
  const incoming = new URL(req.url || '/', `https://${req.headers.host || 'localhost'}`)
  const upstreamPath = upstream.pathname.replace(/\/+$/, '')
  const rewrittenPath = incoming.searchParams.get('path')
  if (rewrittenPath !== null) {
    incoming.searchParams.delete('path')
    const parts = rewrittenPath.split('/').filter(Boolean)
    if (parts.some((part) => part === '.' || part === '..')) throw httpError(400, '代理路径无效。')
    const suffix = parts
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

  // 显式要求上游返回原始字节，避免自动解压与 content-encoding 头不一致。
  headers.set('accept-encoding', 'identity')
  headers.set('x-forwarded-host', String(req.headers['x-forwarded-host'] || req.headers.host || ''))
  headers.set('x-forwarded-proto', String(req.headers['x-forwarded-proto'] || 'https'))
  headers.set('x-xducraft-proxy-trace', traceId)

  const configuredProxySecret = (process.env.XDUCRAFT_PROXY_SECRET || '').trim()
  const proxySecret = validateSecret('XDUCRAFT_PROXY_SECRET', configuredProxySecret, { required: true })
  headers.set('x-xducraft-proxy-secret', proxySecret)
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
    sendJson(res, 500, { error: 'Vercel API 代理未正确配置 XDUCRAFT_UPSTREAM_API。', traceId })
    return
  }

  let targetUrl = null
  let timeout
  try {
    const timeoutMs = parseIntegerEnv('XDUCRAFT_PROXY_TIMEOUT_MS', 15000, { min: 1000, max: 60000 })
    const maxRequestBytes = parseIntegerEnv('XDUCRAFT_MAX_JSON_BODY_BYTES', 128 * 1024, { min: 4096, max: 1024 * 1024 })
    const maxResponseBytes = parseIntegerEnv('XDUCRAFT_PROXY_MAX_RESPONSE_BYTES', 8 * 1024 * 1024, { min: 64 * 1024, max: 32 * 1024 * 1024 })
    const controller = new AbortController()
    timeout = setTimeout(() => controller.abort(), timeoutMs)
    targetUrl = buildTargetUrl(req, upstream)

    writeProxyLog('info', 'proxy.request.start', {
      traceId,
      method: req.method,
      request: incomingForLog(req),
      target: urlForLog(targetUrl),
      timeoutMs
    })

    const upstreamResponse = await fetch(targetUrl, {
      method: req.method,
      headers: buildHeaders(req, traceId),
      body: await readBody(req, maxRequestBytes),
      redirect: 'manual',
      signal: controller.signal
    })
    const contentLength = Number(upstreamResponse.headers.get('content-length') || 0)
    if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
      throw httpError(502, '后端 API 响应过大。')
    }
    const responseBuffer = Buffer.from(await upstreamResponse.arrayBuffer())
    if (responseBuffer.length > maxResponseBytes) throw httpError(502, '后端 API 响应过大。')

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
    res.end(responseBuffer)
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError'
    const explicitStatus = error instanceof Error ? Number(error.status) : 0
    const status = timedOut ? 504 : explicitStatus >= 400 && explicitStatus < 600 ? explicitStatus : 502
    const elapsedMs = Date.now() - startedAt
    writeProxyLog('error', 'proxy.request.failure', {
      traceId,
      method: req.method,
      target: targetUrl ? urlForLog(targetUrl) : undefined,
      status,
      elapsedMs,
      error: describeProxyError(error)
    })
    res.setHeader('x-xducraft-proxy-elapsed-ms', String(elapsedMs))
    sendJson(res, status, {
      error: timedOut
        ? '后端 API 代理超时。'
        : status === 400 || status === 413
          ? error.message
          : '后端 API 代理失败。',
      traceId
    })
  } finally {
    clearTimeout(timeout)
  }
}
