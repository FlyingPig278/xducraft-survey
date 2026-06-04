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
  return new URL(`${upstreamPath}${incoming.pathname}${incoming.search}`, upstream.origin)
}

const buildHeaders = (req) => {
  const headers = new Headers()
  Object.entries(req.headers).forEach(([key, value]) => {
    const normalizedKey = key.toLowerCase()
    if (hopByHopHeaders.has(normalizedKey) || value === undefined) return
    headers.set(key, Array.isArray(value) ? value.join(', ') : String(value))
  })

  headers.set('x-forwarded-host', String(req.headers['x-forwarded-host'] || req.headers.host || ''))
  headers.set('x-forwarded-proto', String(req.headers['x-forwarded-proto'] || 'https'))

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
  const upstream = upstreamBase()
  if (!upstream) {
    sendJson(res, 500, { error: 'Vercel API 代理未配置 XDUCRAFT_UPSTREAM_API。' })
    return
  }

  const timeoutMs = Math.max(1000, Number(process.env.XDUCRAFT_PROXY_TIMEOUT_MS || 15000))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const upstreamResponse = await fetch(buildTargetUrl(req, upstream), {
      method: req.method,
      headers: buildHeaders(req),
      body: await readBody(req),
      redirect: 'manual',
      signal: controller.signal
    })

    clearTimeout(timeout)
    res.statusCode = upstreamResponse.status
    upstreamResponse.headers.forEach((value, key) => {
      if (!hopByHopHeaders.has(key.toLowerCase())) res.setHeader(key, value)
    })
    if (!res.getHeader('cache-control')) res.setHeader('cache-control', 'no-store')
    res.end(Buffer.from(await upstreamResponse.arrayBuffer()))
  } catch (error) {
    clearTimeout(timeout)
    const timedOut = error instanceof Error && error.name === 'AbortError'
    sendJson(res, timedOut ? 504 : 502, {
      error: timedOut ? '后端 API 代理超时。' : '后端 API 代理失败。'
    })
  }
}
