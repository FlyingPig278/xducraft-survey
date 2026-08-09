import { createServer } from 'node:http'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { setDefaultResultOrder } from 'node:dns'
import { connect as tlsConnect } from 'node:tls'
import { createJsonStateStore } from './lib/jsonStateStore.mjs'
import {
  clientIpFromRequest,
  createWindowRateLimiter,
  httpError,
  isHttpUrl,
  parseIntegerEnv,
  readJsonBody,
  validateSecret
} from './lib/httpUtils.mjs'
import { stateForViewer } from './lib/stateViews.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const loadedEnvKeys = new Set()
const loadEnvFile = (filePath) => {
  if (!existsSync(filePath)) return
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line
    const eqIndex = normalized.indexOf('=')
    if (eqIndex <= 0) continue
    const key = normalized.slice(0, eqIndex).trim()
    let value = normalized.slice(eqIndex + 1).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined || loadedEnvKeys.has(key)) {
      process.env[key] = value
      loadedEnvKeys.add(key)
    }
  }
}

loadEnvFile(path.join(rootDir, '.env'))
loadEnvFile(path.join(rootDir, '.env.local'))

try {
  setDefaultResultOrder(process.env.BLESSING_DNS_RESULT_ORDER || 'ipv4first')
} catch (error) {
  console.warn(`[blessing] DNS result order was not changed: ${error instanceof Error ? error.message : error}`)
}

const distDir = path.join(rootDir, 'dist')
const dataDir = process.env.XDUCRAFT_DATA_DIR
  ? path.resolve(process.env.XDUCRAFT_DATA_DIR)
  : path.join(rootDir, 'data')
const stateFile = path.join(dataDir, 'app-state.json')
const logDir = process.env.XDUCRAFT_LOG_DIR
  ? path.resolve(process.env.XDUCRAFT_LOG_DIR)
  : path.join(dataDir, 'logs')
const authLogFile = process.env.XDUCRAFT_AUTH_LOG_FILE
  ? path.resolve(process.env.XDUCRAFT_AUTH_LOG_FILE)
  : path.join(logDir, 'auth.log')
const authFileLogEnabled = process.env.XDUCRAFT_AUTH_FILE_LOG !== 'false'
const accessLogFile = process.env.XDUCRAFT_ACCESS_LOG_FILE
  ? path.resolve(process.env.XDUCRAFT_ACCESS_LOG_FILE)
  : path.join(logDir, 'access.log')
const accessFileLogEnabled = process.env.XDUCRAFT_ACCESS_FILE_LOG !== 'false'
const isProduction = process.env.NODE_ENV === 'production' || process.env.XDUCRAFT_ENV === 'production'
const port = parseIntegerEnv('PORT', 8787, { min: 1, max: 65535 })
const frontendBaseUrl = (process.env.FRONTEND_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '')
const allowedOrigins = new Set([
  new URL(frontendBaseUrl).origin,
  ...(process.env.XDUCRAFT_ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean)
])
const blessingBaseUrl = (process.env.BLESSING_BASE_URL || '').replace(/\/+$/, '')
const blessingClientId = process.env.BLESSING_CLIENT_ID || ''
const blessingClientSecret = process.env.BLESSING_CLIENT_SECRET || ''
const blessingRedirectUri = process.env.BLESSING_REDIRECT_URI || `http://localhost:${port}/api/auth/blessing/callback`
const blessingOAuthScope = process.env.BLESSING_OAUTH_SCOPE ?? ''
const blessingAdminIds = new Set((process.env.BLESSING_ADMIN_IDS || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean))
const blessingFetchTimeoutMs = parseIntegerEnv('BLESSING_FETCH_TIMEOUT_MS', 8000, { min: 1000, max: 60000 })
const blessingFetchRetries = parseIntegerEnv('BLESSING_FETCH_RETRIES', 2, { min: 0, max: 5 })
const blessingTokenRetries = parseIntegerEnv('BLESSING_TOKEN_RETRIES', 0, { min: 0, max: 3 })
const blessingUserAgent = process.env.BLESSING_USER_AGENT || 'XDUCraft-Survey/0.1'
const blessingIpFamily = parseIntegerEnv('BLESSING_IP_FAMILY', 4, { min: 0, max: 6 })
const blessingFetchPlayers = process.env.BLESSING_FETCH_PLAYERS === 'true'
const blessingProxyUrl = process.env.BLESSING_PROXY_URL || ''
const blessingDebugProfile = process.env.BLESSING_DEBUG_PROFILE === 'true'
const configuredSessionSecret = process.env.SESSION_SECRET || ''
if (configuredSessionSecret) validateSecret('SESSION_SECRET', configuredSessionSecret)
if (isProduction && !configuredSessionSecret) throw new Error('生产环境必须配置 SESSION_SECRET。')
if (!configuredSessionSecret) console.warn('[security] SESSION_SECRET 未配置，本次启动使用临时密钥，重启后现有会话会失效。')
const sessionSecret = configuredSessionSecret || randomBytes(32).toString('hex')
const sessionTtlMs = parseIntegerEnv('SESSION_TTL_SECONDS', 60 * 60 * 24 * 14, { min: 3600, max: 60 * 60 * 24 * 30 }) * 1000
const proxySecret = validateSecret('XDUCRAFT_PROXY_SECRET', process.env.XDUCRAFT_PROXY_SECRET || '')
const maxJsonBodyBytes = parseIntegerEnv('XDUCRAFT_MAX_JSON_BODY_BYTES', 128 * 1024, { min: 4096, max: 1024 * 1024 })
const maxOAuthResponseBytes = parseIntegerEnv('BLESSING_MAX_RESPONSE_BYTES', 1024 * 1024, { min: 16384, max: 8 * 1024 * 1024 })
const maxLogBytes = parseIntegerEnv('XDUCRAFT_LOG_MAX_BYTES', 10 * 1024 * 1024, { min: 1024 * 1024, max: 1024 * 1024 * 1024 })
const oauthStates = new Map()
const authTickets = new Map()
const oauthStateTtlMs = 10 * 60 * 1000
const authTicketTtlMs = 2 * 60 * 1000
const rateLimit = createWindowRateLimiter({ windowMs: 60 * 1000 })

const now = () => new Date().toISOString()
let authLogQueue = Promise.resolve()
let accessLogQueue = Promise.resolve()

const sanitizeLogValue = (value) => {
  if (value instanceof Error) return { name: value.name, message: value.message, status: value.status }
  if (Array.isArray(value)) return value.map(sanitizeLogValue)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/^(secret|clientSecret|accessToken|refreshToken|sessionToken|code|authorization|password)$/i.test(key))
      .map(([key, item]) => [key, sanitizeLogValue(item)]))
  }
  return value
}

const appendLogRecord = async (filePath, record) => {
  await mkdir(path.dirname(filePath), { recursive: true })
  try {
    const fileStat = await stat(filePath)
    if (fileStat.size >= maxLogBytes) {
      await rm(`${filePath}.1`, { force: true })
      await rename(filePath, `${filePath}.1`)
    }
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error
  }
  await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8')
}

const writeAuthLog = (event, fields = {}) => {
  if (!authFileLogEnabled) return
  const record = {
    ts: now(),
    pid: process.pid,
    event,
    ...sanitizeLogValue(fields)
  }
  const appendRecord = async () => {
    try {
      await appendLogRecord(authLogFile, record)
    } catch {
      // Logging must never break auth flow.
    }
  }
  authLogQueue = authLogQueue.then(appendRecord, appendRecord)
}

const writeAccessLog = (event, fields = {}) => {
  if (!accessFileLogEnabled) return
  const record = {
    ts: now(),
    pid: process.pid,
    event,
    ...sanitizeLogValue(fields)
  }
  const appendRecord = async () => {
    try {
      await appendLogRecord(accessLogFile, record)
    } catch {
      // Diagnostics should never break the API.
    }
  }
  accessLogQueue = accessLogQueue.then(appendRecord, appendRecord)
}

const createId = (prefix) =>
  `${prefix}-${Date.now().toString(36)}-${randomBytes(6).toString('base64url')}`

const createToken = (prefix) => `${prefix}-${randomBytes(18).toString('base64url')}`

const createTraceId = () => createToken('trace')

const blessingAuthEnabled = () =>
  Boolean(blessingBaseUrl && blessingClientId && blessingClientSecret && blessingRedirectUri)

const encodeJson = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const decodeJson = (value) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
const signSessionPayload = (payload) =>
  createHmac('sha256', sessionSecret).update(payload).digest('base64url')

const safeEqual = (a, b) => {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  return left.length === right.length && timingSafeEqual(left, right)
}

const createSessionToken = (user) => {
  const payload = encodeJson({
    id: user.id,
    displayName: user.displayName,
    gameId: user.gameId,
    role: user.role,
    authProvider: user.authProvider,
    blessingUserId: user.blessingUserId,
    adminGrantKey: user.adminGrantKey,
    exp: Date.now() + sessionTtlMs
  })
  return `${payload}.${signSessionPayload(payload)}`
}

const verifySessionToken = (token) => {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature || !safeEqual(signSessionPayload(payload), signature)) return null
  try {
    const data = decodeJson(payload)
    if (!data.exp || Date.now() > Number(data.exp)) return null
    return {
      id: String(data.id || ''),
      displayName: String(data.displayName || ''),
      gameId: String(data.gameId || ''),
      role: data.role === 'admin' ? 'admin' : 'player',
      authProvider: 'blessing',
      blessingUserId: data.blessingUserId ? String(data.blessingUserId) : undefined,
      adminGrantKey: data.adminGrantKey ? normalizeUserKey(data.adminGrantKey) : undefined
    }
  } catch {
    return null
  }
}

const userFromRequest = (req) => {
  const header = req.headers.authorization || ''
  const match = String(header).match(/^Bearer\s+(.+)$/i)
  return match ? verifySessionToken(match[1]) : null
}

const deviceIdFromRequest = (req) => {
  const value = Array.isArray(req.headers['x-device-id']) ? req.headers['x-device-id'][0] : req.headers['x-device-id']
  const normalized = String(value || '').trim().slice(0, 128).replace(/[^a-zA-Z0-9_:-]/g, '-')
  return normalized || ''
}

const viewerFromRequest = (req) => {
  const user = userFromRequest(req)
  if (user) {
    const role = user.role === 'admin' && user.adminGrantKey && blessingAdminIds.has(user.adminGrantKey) ? 'admin' : 'player'
    return { user: { ...user, role }, userId: user.id, name: user.displayName, gameId: user.gameId, role }
  }
  const deviceId = deviceIdFromRequest(req)
  if (deviceId) return { user: null, userId: `anon-${deviceId}`, name: '匿名玩家', gameId: '', role: 'player' }
  return { user: null, userId: '', name: '匿名玩家', gameId: '', role: 'player' }
}


const requireAdmin = (req) => {
  const user = userFromRequest(req)
  if (!user) throw httpError(401, '请先登录管理员账号。')
  if (user.role !== 'admin' || !user.adminGrantKey || !blessingAdminIds.has(user.adminGrantKey)) {
    throw httpError(403, '当前账号没有管理员权限，或管理员授权已被撤销。')
  }
  return user
}

const cleanupAuthMaps = () => {
  const ts = Date.now()
  for (const [key, value] of oauthStates.entries()) {
    if (value.expiresAt <= ts) oauthStates.delete(key)
  }
  for (const [key, value] of authTickets.entries()) {
    if (value.expiresAt <= ts) authTickets.delete(key)
  }
}

const safeReturnTo = (value) => {
  if (!value || typeof value !== 'string') return '/'
  if (!value.startsWith('/') || value.startsWith('//')) return '/'
  return value
}

const sendRedirect = (res, location) => {
  res.writeHead(302, { Location: location })
  res.end()
}

const redirectToFrontend = (res, returnTo, params) => {
  const target = new URL(safeReturnTo(returnTo), `${frontendBaseUrl}/`)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') target.searchParams.set(key, String(value))
  })
  sendRedirect(res, target.toString())
}

const blessingUrl = (pathname) => new URL(pathname, `${blessingBaseUrl}/`).toString()

const parseJsonPayload = (statusCode, statusMessage, text) => {
  let body = {}
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = { raw: text }
    }
  }
  if (typeof body === 'object' && body && Number(body.code) === 403) {
    const error = new Error(`XDUCraft 皮肤站请求失败：${body.message || body.error || '权限不足'}`)
    error.status = 403
    throw error
  }
  if (statusCode < 200 || statusCode >= 300) {
    const detail = typeof body === 'object' && body && 'error' in body ? body.error : statusMessage
    const error = new Error(`XDUCraft 皮肤站请求失败：${detail}`)
    error.status = statusCode
    throw error
  }
  return body
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const describeFetchError = (error) => {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause instanceof Error ? `；cause=${error.cause.message}` : ''
  return `${error.name}: ${error.message}${cause}`
}

const isTransientBlessingError = (error) => {
  if (!(error instanceof Error)) return true
  if (error.status && error.status < 500) return false
  return ['AbortError', 'TimeoutError', 'TypeError'].includes(error.name) ||
    error.message.includes('fetch failed') ||
    error.message.includes('terminated') ||
    error.message.includes('aborted') ||
    Number(error.status) >= 500
}

const createTimeoutError = () => {
  const error = new Error(`request timed out after ${blessingFetchTimeoutMs}ms`)
  error.name = 'TimeoutError'
  return error
}

const proxyAuthHeader = (proxy) => {
  if (!proxy.username && !proxy.password) return undefined
  return `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}`
}

const buildBlessingRequest = (pathname, init = {}) => {
  const url = new URL(pathname, `${blessingBaseUrl}/`)
  const body = init.body ?? ''
  const headers = {
    Accept: 'application/json',
    'User-Agent': blessingUserAgent,
    'Accept-Encoding': 'identity',
    Connection: 'close',
    ...init.headers
  }
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    headers['Content-Length'] = Buffer.byteLength(body)
  }
  return { url, body, headers, method: init.method ?? 'GET' }
}

const decodeChunkedBody = (buffer) => {
  const chunks = []
  let offset = 0
  while (offset < buffer.length) {
    const marker = buffer.indexOf('\r\n', offset, 'utf8')
    if (marker < 0) break
    const sizeText = buffer.subarray(offset, marker).toString('utf8').split(';')[0]
    const size = Number.parseInt(sizeText, 16)
    if (!Number.isFinite(size)) break
    offset = marker + 2
    if (size === 0) break
    chunks.push(buffer.subarray(offset, offset + size))
    offset += size + 2
  }
  return Buffer.concat(chunks)
}

const parseRawHttpResponse = (buffer) => {
  const separator = buffer.indexOf('\r\n\r\n', 0, 'utf8')
  if (separator < 0) {
    const error = new Error('XDUCraft 皮肤站响应格式异常')
    error.status = 0
    throw error
  }
  const headerText = buffer.subarray(0, separator).toString('utf8')
  const bodyBuffer = buffer.subarray(separator + 4)
  const headerLines = headerText.split('\r\n')
  const statusLine = headerLines[0] ?? ''
  const match = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)\s*(.*)$/)
  if (!match) {
    const error = new Error('XDUCraft 皮肤站响应状态异常')
    error.status = 0
    throw error
  }
  const responseHeaders = new Map()
  headerLines.slice(1).forEach((line) => {
    const index = line.indexOf(':')
    if (index > 0) responseHeaders.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim())
  })
  const decodedBody = responseHeaders.get('transfer-encoding')?.toLowerCase().includes('chunked')
    ? decodeChunkedBody(bodyBuffer)
    : bodyBuffer
  const bodyText = decodedBody.toString('utf8')
  return parseJsonPayload(Number(match[1]), match[2] || '', bodyText)
}

const requestBlessingDirect = (pathname, init = {}, trace = {}) => new Promise((resolve, reject) => {
  const { url, body, headers, method } = buildBlessingRequest(pathname, init)
  const startedAt = Date.now()
  const baseLog = {
    traceId: trace.traceId,
    step: trace.step,
    attempt: trace.attempt,
    pathname,
    method,
    host: url.host,
    transport: 'direct'
  }
  const requestOptions = { method, headers, timeout: blessingFetchTimeoutMs }
  if (blessingIpFamily === 4 || blessingIpFamily === 6) requestOptions.family = blessingIpFamily

  let settled = false
  let absoluteTimeout
  const settle = (callback, value) => {
    if (settled) return
    settled = true
    clearTimeout(absoluteTimeout)
    callback(value)
  }
  const transport = url.protocol === 'http:' ? httpRequest : httpsRequest
  writeAuthLog('blessing.request.direct.start', { ...baseLog, timeoutMs: blessingFetchTimeoutMs, ipFamily: blessingIpFamily })
  const req = transport(url, requestOptions, (response) => {
    writeAuthLog('blessing.request.direct.response', {
      ...baseLog,
      statusCode: response.statusCode,
      elapsedMs: Date.now() - startedAt
    })
    const chunks = []
    let responseBytes = 0
    response.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      responseBytes += buffer.length
      if (responseBytes > maxOAuthResponseBytes) {
        response.destroy(new Error('XDUCraft 皮肤站响应过大'))
        return
      }
      chunks.push(buffer)
    })
    response.on('end', () => {
      try {
        const responseBuffer = Buffer.concat(chunks)
        writeAuthLog('blessing.request.direct.end', {
          ...baseLog,
          statusCode: response.statusCode,
          bodyBytes: responseBuffer.length,
          elapsedMs: Date.now() - startedAt
        })
        settle(resolve, parseJsonPayload(
          response.statusCode ?? 0,
          response.statusMessage ?? '',
          responseBuffer.toString('utf8')
        ))
      } catch (error) {
        settle(reject, error)
      }
    })
    response.on('aborted', () => settle(reject, new Error('XDUCraft 皮肤站响应被中断')))
    response.on('error', (error) => settle(reject, error))
  })

  absoluteTimeout = setTimeout(() => {
    writeAuthLog('blessing.request.direct.timeout', { ...baseLog, elapsedMs: Date.now() - startedAt })
    req.destroy(createTimeoutError())
  }, blessingFetchTimeoutMs)
  req.on('socket', (socket) => {
    writeAuthLog('blessing.request.direct.socket', { ...baseLog, elapsedMs: Date.now() - startedAt })
    socket.on('lookup', (error, address, family, hostname) => {
      writeAuthLog('blessing.request.direct.lookup', {
        ...baseLog,
        hostname,
        family,
        address,
        error: error ? describeFetchError(error) : '',
        elapsedMs: Date.now() - startedAt
      })
    })
    socket.on('connect', () => {
      writeAuthLog('blessing.request.direct.tcp_connect', { ...baseLog, elapsedMs: Date.now() - startedAt })
    })
    socket.on('secureConnect', () => {
      writeAuthLog('blessing.request.direct.tls_secure', { ...baseLog, elapsedMs: Date.now() - startedAt })
    })
  })
  req.on('timeout', () => {
    writeAuthLog('blessing.request.direct.timeout_event', { ...baseLog, elapsedMs: Date.now() - startedAt })
    req.destroy(createTimeoutError())
  })
  req.on('error', (error) => {
    writeAuthLog('blessing.request.direct.error', { ...baseLog, error: describeFetchError(error), elapsedMs: Date.now() - startedAt })
    settle(reject, error)
  })
  if (body) req.write(body)
  req.end()
})

const requestBlessingViaProxy = (pathname, init = {}, trace = {}) => new Promise((resolve, reject) => {
  const { url, body, headers, method } = buildBlessingRequest(pathname, init)
  const proxy = new URL(blessingProxyUrl)
  const startedAt = Date.now()
  const baseLog = {
    traceId: trace.traceId,
    step: trace.step,
    attempt: trace.attempt,
    pathname,
    method,
    host: url.host,
    proxyHost: proxy.host,
    transport: 'proxy'
  }
  writeAuthLog('blessing.request.proxy.start', { ...baseLog, timeoutMs: blessingFetchTimeoutMs })
  if (url.protocol !== 'https:') {
    reject(new Error('BLESSING_PROXY_URL currently supports HTTPS targets only'))
    return
  }
  const targetPort = url.port || '443'
  const connectHeaders = { Host: `${url.hostname}:${targetPort}` }
  const auth = proxyAuthHeader(proxy)
  if (auth) connectHeaders['Proxy-Authorization'] = auth

  const connectReq = httpRequest({
    hostname: proxy.hostname,
    port: proxy.port || 8080,
    method: 'CONNECT',
    path: `${url.hostname}:${targetPort}`,
    headers: connectHeaders,
    timeout: blessingFetchTimeoutMs
  })

  let tunnelSocket = null
  const absoluteTimeout = setTimeout(() => {
    const error = createTimeoutError()
    writeAuthLog('blessing.request.proxy.timeout', { ...baseLog, elapsedMs: Date.now() - startedAt })
    if (tunnelSocket) tunnelSocket.destroy(error)
    else connectReq.destroy(error)
  }, blessingFetchTimeoutMs)

  connectReq.on('connect', (proxyRes, socket) => {
    writeAuthLog('blessing.request.proxy.connect_response', {
      ...baseLog,
      statusCode: proxyRes.statusCode,
      elapsedMs: Date.now() - startedAt
    })
    if ((proxyRes.statusCode ?? 0) < 200 || (proxyRes.statusCode ?? 0) >= 300) {
      clearTimeout(absoluteTimeout)
      socket.destroy()
      const error = new Error(`代理连接失败：${proxyRes.statusCode} ${proxyRes.statusMessage || ''}`.trim())
      error.status = proxyRes.statusCode
      reject(error)
      return
    }

    tunnelSocket = socket
    const tlsSocket = tlsConnect({ socket, servername: url.hostname }, () => {
      writeAuthLog('blessing.request.proxy.tls_secure', { ...baseLog, elapsedMs: Date.now() - startedAt })
      tunnelSocket = tlsSocket
      const pathWithQuery = `${url.pathname}${url.search}`
      const requestHeaders = {
        ...headers,
        Host: url.host
      }
      tlsSocket.write(`${method} ${pathWithQuery} HTTP/1.1\r\n`)
      Object.entries(requestHeaders).forEach(([key, value]) => {
        tlsSocket.write(`${key}: ${value}\r\n`)
      })
      tlsSocket.write('\r\n')
      if (body) tlsSocket.write(body)
    })

    const chunks = []
    let responseBytes = 0
    let responseEnded = false
    tlsSocket.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      responseBytes += buffer.length
      if (responseBytes > maxOAuthResponseBytes) {
        tlsSocket.destroy(new Error('XDUCraft 皮肤站响应过大'))
        return
      }
      chunks.push(buffer)
    })
    tlsSocket.on('end', () => {
      responseEnded = true
      clearTimeout(absoluteTimeout)
      try {
        writeAuthLog('blessing.request.proxy.end', {
          ...baseLog,
          bodyBytes: Buffer.concat(chunks).length,
          elapsedMs: Date.now() - startedAt
        })
        resolve(parseRawHttpResponse(Buffer.concat(chunks)))
      } catch (error) {
        reject(error)
      }
    })
    tlsSocket.on('error', (error) => {
      clearTimeout(absoluteTimeout)
      writeAuthLog('blessing.request.proxy.error', { ...baseLog, error: describeFetchError(error), elapsedMs: Date.now() - startedAt })
      reject(error)
    })
    tlsSocket.on('close', (hadError) => {
      if (!responseEnded && !hadError) {
        clearTimeout(absoluteTimeout)
        reject(new Error('XDUCraft 皮肤站代理连接提前关闭'))
      }
    })
  })

  connectReq.on('timeout', () => {
    writeAuthLog('blessing.request.proxy.timeout_event', { ...baseLog, elapsedMs: Date.now() - startedAt })
    connectReq.destroy(createTimeoutError())
  })
  connectReq.on('error', (error) => {
    clearTimeout(absoluteTimeout)
    writeAuthLog('blessing.request.proxy.error', { ...baseLog, error: describeFetchError(error), elapsedMs: Date.now() - startedAt })
    reject(error)
  })
  connectReq.end()
})

const requestBlessingOnce = (pathname, init = {}, trace = {}) =>
  blessingProxyUrl ? requestBlessingViaProxy(pathname, init, trace) : requestBlessingDirect(pathname, init, trace)

const fetchBlessingJson = async (pathname, init = {}, options = {}) => {
  const retries = Math.max(0, Number(options.retries ?? blessingFetchRetries))
  const attempts = retries + 1
  let lastError = null
  const traceId = options.traceId
  const step = options.step ?? pathname
  const method = init.method ?? 'GET'
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const startedAt = Date.now()
    writeAuthLog('blessing.fetch.attempt.start', {
      traceId,
      step,
      pathname,
      method,
      attempt,
      attempts,
      retries,
      timeoutMs: blessingFetchTimeoutMs
    })
    try {
      const body = await requestBlessingOnce(pathname, init, { traceId, step, attempt })
      writeAuthLog('blessing.fetch.attempt.success', {
        traceId,
        step,
        pathname,
        method,
        attempt,
        attempts,
        elapsedMs: Date.now() - startedAt
      })
      if (attempt > 1) {
        console.log(`[blessing] ${pathname} succeeded on attempt ${attempt} in ${Date.now() - startedAt}ms`)
      }
      return body
    } catch (error) {
      lastError = error
      const canRetry = attempt < attempts && isTransientBlessingError(error)
      writeAuthLog('blessing.fetch.attempt.failure', {
        traceId,
        step,
        pathname,
        method,
        attempt,
        attempts,
        canRetry,
        error: describeFetchError(error),
        elapsedMs: Date.now() - startedAt
      })
      console.warn(`[blessing] ${pathname} attempt ${attempt}/${attempts} failed in ${Date.now() - startedAt}ms: ${describeFetchError(error)}`)
      if (!canRetry) break
      await sleep(250 * attempt)
    }
  }
  throw lastError
}

const exchangeBlessingCode = async (code, traceId) => {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: blessingClientId,
    client_secret: blessingClientSecret,
    redirect_uri: blessingRedirectUri,
    code
  })
  return fetchBlessingJson('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  }, { retries: blessingTokenRetries, traceId, step: 'oauth.token' })
}

const fetchBlessingUser = async (accessToken, traceId) => {
  return fetchBlessingJson('/api/user', {
    headers: { Authorization: `Bearer ${accessToken}` }
  }, { traceId, step: 'api.user' })
}

const fetchBlessingPlayers = async (accessToken, traceId) => {
  return fetchBlessingJson('/api/players', {
    headers: { Authorization: `Bearer ${accessToken}` }
  }, { retries: 0, traceId, step: 'api.players' })
}

const firstText = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return ''
}

const normalizeUserKey = (value) =>
  String(value || '').trim().toLowerCase()

const asObject = (value) =>
  typeof value === 'object' && value !== null ? value : {}

const unwrapBlessingProfile = (rawProfile) => {
  const root = asObject(rawProfile)
  const data = asObject(root.data)
  const user = asObject(root.user)
  const account = asObject(root.account)
  if (Object.keys(data).length > 0) return { ...data, players: data.players ?? root.players }
  if (Object.keys(user).length > 0) return { ...user, players: user.players ?? root.players }
  if (Object.keys(account).length > 0) return { ...account, players: account.players ?? root.players }
  return root
}

const logBlessingProfileShape = (rawProfile, profile, adminKeys, traceId) => {
  if (!blessingDebugProfile) return
  const root = asObject(rawProfile)
  console.log('[blessing] profile root keys:', Object.keys(root).join(', ') || '(none)')
  console.log('[blessing] profile user keys:', Object.keys(profile).join(', ') || '(none)')
  console.log('[blessing] admin match keys:', adminKeys.filter(Boolean).join(', ') || '(none)')
  writeAuthLog('blessing.profile.shape', {
    traceId,
    rootKeys: Object.keys(root),
    profileKeys: Object.keys(profile),
    adminMatchKeys: adminKeys.filter(Boolean)
  })
}

const mapBlessingUser = (rawProfile, traceId) => {
  const profile = unwrapBlessingProfile(rawProfile)
  const blessingUserId = firstText(profile.uid, profile.id, profile.user_id, profile.email, profile.nickname, profile.username)
  if (!blessingUserId) throw new Error('XDUCraft 皮肤站未返回可用于识别账号的稳定字段')
  const email = firstText(profile.email)
  const displayName = firstText(profile.nickname, profile.username, profile.name, email.split('@')[0], `用户 ${blessingUserId}`)
  const players = Array.isArray(profile.players) ? profile.players : []
  const playerNames = players
    .map((player) => firstText(player?.name, player?.player_name, player?.username))
    .filter(Boolean)
  const playerIds = players
    .map((player) => firstText(player?.pid, player?.id, player?.uuid))
    .filter(Boolean)
  const gameId = firstText(profile.player_name, profile.gameId, profile.game_id, ...playerNames, profile.username, profile.nickname, displayName)
  const adminKeys = [
    blessingUserId,
    profile.uid,
    profile.id,
    profile.user_id,
    profile.email,
    profile.nickname,
    profile.username,
    profile.name,
    ...playerIds,
    ...playerNames,
    displayName,
    gameId
  ].map(normalizeUserKey).filter(Boolean)
  logBlessingProfileShape(rawProfile, profile, adminKeys, traceId)
  const adminGrantKey = adminKeys.find((key) => blessingAdminIds.has(key))
  const normalizedId = blessingUserId.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9_:-]/g, '-') || createId('user')
  return {
    id: `blessing-${normalizedId}`,
    displayName,
    gameId,
    role: adminGrantKey ? 'admin' : 'player',
    authProvider: 'blessing',
    blessingUserId,
    adminGrantKey
  }
}

const createSeedState = () => {
  return { surveys: [], candidates: [], votes: [], auditLogs: [] }
}

const normalizeSurvey = (survey) => {
  const { publicResults, resultVisibility, ...rest } = survey
  return {
    ...rest,
    startsAt: survey.startsAt ?? null,
    endsAt: survey.endsAt ?? null,
    resultVisibility: resultVisibility ?? (publicResults ? 'always' : 'hidden'),
    maxVotes: Math.max(1, Number(survey.maxVotes) || 1),
    candidateSubmission: survey.candidateSubmission ?? { enabled: true, requiresReview: true },
    candidateFields: (survey.candidateFields ?? []).map((item) => ({
      ...item,
      options: item.options ? [...item.options] : undefined
    }))
  }
}

const normalizeCandidates = (candidates = []) => {
  const surveyCounters = new Map()
  return candidates.map((candidate) => {
    const surveyId = candidate.surveyId || ''
    const fallbackOrder = surveyCounters.get(surveyId) ?? 0
    surveyCounters.set(surveyId, fallbackOrder + 1000)
    const sortOrder = Number(candidate.sortOrder)
    return {
      ...candidate,
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : fallbackOrder
    }
  })
}

const normalizeState = (state) => ({
  surveys: (state.surveys ?? []).map(normalizeSurvey),
  candidates: normalizeCandidates(state.candidates),
  votes: state.votes ?? [],
  auditLogs: state.auditLogs ?? []
})

const nextCandidateSortOrder = (state, surveyId) => {
  const orders = state.candidates
    .filter((candidate) => candidate.surveyId === surveyId)
    .map((candidate) => Number(candidate.sortOrder))
    .filter(Number.isFinite)
  return orders.length > 0 ? Math.max(...orders) + 1000 : 0
}

const timeValue = (value) => {
  if (!value) return null
  const ts = Date.parse(value)
  return Number.isFinite(ts) ? ts : null
}

const normalizeDateInput = (value) => {
  if (value === null || value === undefined || value === '') return null
  const ts = timeValue(value)
  if (ts === null) throw httpError(400, '日期时间格式不正确。')
  return new Date(ts).toISOString()
}

const validateSurveyTimeWindow = (startsAt, endsAt) => {
  const start = timeValue(startsAt)
  const end = timeValue(endsAt)
  if (start !== null && end !== null && end <= start) throw httpError(400, '结束时间需要晚于开始时间。')
}

const isSurveyAcceptingSubmissions = (survey, ts = Date.now()) => {
  if (!survey || survey.status !== 'open') return false
  const startsAt = timeValue(survey.startsAt)
  if (startsAt && ts < startsAt) return false
  const endsAt = timeValue(survey.endsAt)
  if (endsAt && ts >= endsAt) return false
  return true
}

const stateForRequest = (state, req) => stateForViewer(state, viewerFromRequest(req))

const stateStore = createJsonStateStore({
  filePath: stateFile,
  createSeed: createSeedState,
  normalize: normalizeState
})

const loadState = () => stateStore.load()
const updateState = (mutator) => stateStore.update(mutator)
const validateUrl = isHttpUrl

const boundedText = (value, label, maxLength, { required = false } = {}) => {
  const text = String(value ?? '').trim()
  if (required && !text) throw httpError(400, `请填写${label}。`)
  if (text.length > maxLength) throw httpError(400, `${label}不能超过 ${maxLength} 个字符。`)
  return text
}


const normalizeVoteLimit = (value) => {
  const limit = Number(value)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw httpError(400, '最大可选项数必须是 1 到 100 之间的整数。')
  }
  return limit
}
const normalizeTitle = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
const asRecord = (value, label = '字段') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, `${label}格式不正确。`)
  return value
}
const cleanFieldValues = (survey, rawValues) => {
  const values = asRecord(rawValues, '候选项字段')
  return Object.fromEntries((survey.candidateFields ?? []).map((field) => [
    field.key,
    boundedText(values[field.key], `「${field.label}」`, field.type === 'textarea' ? 5000 : 1000)
  ]))
}

const titleFromValues = (survey, values, fallback = '未命名候选项') =>
  values.packName?.trim() || values.name?.trim() || values.title?.trim() ||
  (survey.candidateFields ?? []).map((field) => values[field.key]).find(Boolean)?.trim() ||
  fallback

const validateCandidateValues = (survey, values) => {
  for (const field of survey.candidateFields ?? []) {
    const value = values[field.key] ?? ''
    if (field.required && !value) throw httpError(400, `请填写「${field.label}」。`)
    if (field.type === 'url' && !validateUrl(value)) throw httpError(400, `「${field.label}」只接受 http 或 https 完整链接。`)
    if (field.type === 'select' && value && !(field.options ?? []).includes(value)) {
      throw httpError(400, `「${field.label}」包含无效选项。`)
    }
    if (field.type === 'number' && value && !Number.isFinite(Number(value))) {
      throw httpError(400, `「${field.label}」需要是有效数字。`)
    }
  }
}

const normalizeCandidateFields = (rawFields = []) => {
  if (!Array.isArray(rawFields)) throw httpError(400, '候选项字段必须是数组。')
  if (rawFields.length > 30) throw httpError(400, '候选项字段不能超过 30 个。')
  return rawFields.map((rawField, index) => {
    const field = asRecord(rawField, '候选项字段')
    return {
      id: boundedText(field.id || createId('field'), '字段 ID', 128, { required: true }),
      key: String(field.key || `custom_field_${index + 1}`).trim().replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64),
      label: boundedText(field.label, '字段名称', 80, { required: true }),
      type: ['text', 'textarea', 'url', 'select', 'number'].includes(field.type) ? field.type : 'text',
      required: Boolean(field.required),
      placeholder: boundedText(field.placeholder, '字段提示', 200),
      options: Array.isArray(field.options)
        ? [...new Set(field.options.map((item) => boundedText(item, '选项', 100)).filter(Boolean))].slice(0, 100)
        : undefined
    }
  })
}

const validateCandidateFields = (fields) => {
  const keys = new Set()
  for (const field of fields) {
    if (!field.key || !field.label) throw httpError(400, '字段名称和 Key 不能为空。')
    if (keys.has(field.key)) throw httpError(400, `字段 key「${field.key}」重复。`)
    if (field.type === 'select' && (!field.options || field.options.length === 0)) {
      throw httpError(400, `选择字段「${field.label}」至少需要一个选项。`)
    }
    keys.add(field.key)
  }
}

const actorForSurvey = (req, survey, body = {}) => {
  const viewer = viewerFromRequest(req)
  if (survey.requireLogin) {
    if (!viewer.user) throw httpError(401, '请先登录后再提交。')
    return viewer
  }
  if (viewer.user) return viewer
  const gameId = boundedText(body.guestGameId, '游戏昵称', 32, { required: true })
  if (!viewer.userId) throw httpError(400, '缺少设备标识，请刷新页面后重试。')
  return { ...viewer, name: gameId, gameId }
}

const ensureSurveyWritable = (survey) => {
  if (!isSurveyAcceptingSubmissions(survey)) throw httpError(400, '当前问卷不在开放提交时间内。')
}

const submitVoteMutation = async (req, body) => updateState((state) => {
  const survey = state.surveys.find((item) => item.id === body.surveyId)
  if (!survey) throw httpError(404, '问卷不存在。')
  ensureSurveyWritable(survey)
  const actor = actorForSurvey(req, survey, body)
  const voteLimit = survey.voteMode === 'single' ? 1 : Math.max(1, Number(survey.maxVotes) || 1)
  if (!Array.isArray(body.candidateIds)) throw httpError(400, '候选项列表格式不正确。')
  if (body.candidateIds.length > 100) throw httpError(400, '候选项数量过多。')
  const candidateIds = [...new Set(body.candidateIds.map((id) => boundedText(id, '候选项 ID', 128, { required: true })))]
  if (candidateIds.length === 0) throw httpError(400, '请至少选择一个候选项。')
  if (candidateIds.length > voteLimit) throw httpError(400, `最多选择 ${voteLimit} 项。`)
  const approvedIds = new Set(state.candidates.filter((item) => item.surveyId === survey.id && item.status === 'approved').map((item) => item.id))
  if (candidateIds.some((id) => !approvedIds.has(id))) throw httpError(400, '选择中包含不可投票的候选项。')
  const existing = state.votes.find((item) => item.surveyId === survey.id && item.userId === actor.userId)
  const ts = now()
  if (existing) {
    if (!survey.allowVoteEdits) throw httpError(400, '你已经提交过本问卷，当前不允许修改。')
    existing.history = existing.history ?? []
    existing.history.push({ candidateIds: [...existing.candidateIds], changedAt: existing.updatedAt })
    existing.candidateIds = candidateIds
    existing.updatedAt = ts
    state.auditLogs.unshift({ id: createId('log'), action: 'vote.updated', actor: actor.name, detail: `${actor.name} 修改了「${survey.title}」的投票`, surveyId: survey.id, createdAt: ts })
  } else {
    state.votes.push({
      id: createId('vote'),
      surveyId: survey.id,
      userId: actor.userId,
      userName: actor.name,
      gameId: actor.gameId,
      candidateIds,
      createdAt: ts,
      updatedAt: ts,
      history: []
    })
    state.auditLogs.unshift({ id: createId('log'), action: 'vote.created', actor: actor.name, detail: `${actor.name} 提交了「${survey.title}」的投票`, surveyId: survey.id, createdAt: ts })
  }
  return stateForRequest(normalizeState(state), req)
})

const submitCandidateMutation = async (req, body) => updateState((state) => {
  const survey = state.surveys.find((item) => item.id === body.surveyId)
  if (!survey) throw httpError(404, '问卷不存在。')
  ensureSurveyWritable(survey)
  if (!survey.candidateSubmission?.enabled) throw httpError(400, '当前问卷没有开放候选项投稿。')
  const actor = actorForSurvey(req, survey, body)
  const values = cleanFieldValues(survey, body.fields)
  validateCandidateValues(survey, values)
  const title = titleFromValues(survey, values)
  if (state.candidates.find((item) => item.surveyId === survey.id && item.status !== 'rejected' && normalizeTitle(item.title) === normalizeTitle(title))) {
    throw httpError(400, '已经存在同名候选项。')
  }
  const ts = now()
  const status = survey.candidateSubmission.requiresReview ? 'pending' : 'approved'
  state.candidates.unshift({
    id: createId('candidate'),
    surveyId: survey.id,
    title,
    status,
    sortOrder: nextCandidateSortOrder(state, survey.id),
    fields: values,
    submitterUserId: actor.userId,
    submitterName: actor.name,
    createdAt: ts,
    reviewedAt: status === 'approved' ? ts : undefined,
    reviewerName: status === 'approved' ? 'Auto Review' : undefined
  })
  state.auditLogs.unshift({ id: createId('log'), action: 'candidate.submitted', actor: actor.name, detail: `${actor.name} 投稿了「${title}」`, surveyId: survey.id, createdAt: ts })
  return { state: stateForRequest(normalizeState(state), req), candidateStatus: status }
})

const createSurveyMutation = async (req, body) => {
  const admin = requireAdmin(req)
  return updateState((state) => {
    const title = boundedText(body.title, '问卷标题', 120, { required: true })
    const fields = normalizeCandidateFields(body.candidateFields)
    validateCandidateFields(fields)
    const ts = now()
    const survey = {
      id: createId('survey'),
      title,
      description: boundedText(body.description, '问卷描述', 2000) || '请选择你愿意参与的服务器方案。',
      guideText: boundedText(body.guideText, '问卷说明', 10000),
      status: 'draft',
      startsAt: normalizeDateInput(body.startsAt),
      endsAt: normalizeDateInput(body.endsAt),
      resultVisibility: ['always', 'after_vote', 'hidden'].includes(body.resultVisibility) ? body.resultVisibility : 'always',
      allowVoteEdits: Boolean(body.allowVoteEdits),
      requireLogin: body.requireLogin !== false,
      voteMode: body.voteMode === 'single' ? 'single' : 'multiple',
      maxVotes: normalizeVoteLimit(body.maxVotes ?? 1),
      candidateSubmission: {
        enabled: body.candidateSubmission?.enabled !== false,
        requiresReview: body.candidateSubmission?.requiresReview !== false
      },
      candidateFields: fields,
      createdAt: ts,
      updatedAt: ts
    }
    validateSurveyTimeWindow(survey.startsAt, survey.endsAt)
    state.surveys.unshift(survey)
    state.auditLogs.unshift({ id: createId('log'), action: 'survey.created', actor: admin.displayName, detail: `${admin.displayName} 创建了问卷「${survey.title}」`, surveyId: survey.id, createdAt: ts })
    return { state: stateForRequest(normalizeState(state), req), surveyId: survey.id }
  })
}

const updateSurveyMutation = async (req, surveyId, body) => {
  const admin = requireAdmin(req)
  return updateState((state) => {
    const survey = state.surveys.find((item) => item.id === surveyId)
    if (!survey) throw httpError(404, '问卷不存在。')
    if ('title' in body) survey.title = boundedText(body.title, '问卷标题', 120, { required: true })
    if ('description' in body) survey.description = boundedText(body.description, '问卷描述', 2000) || '请选择你愿意参与的服务器方案。'
    if ('guideText' in body) survey.guideText = boundedText(body.guideText, '问卷说明', 10000)
    if ('status' in body) {
      if (!['draft', 'open', 'closed'].includes(body.status)) throw httpError(400, '问卷状态无效。')
      survey.status = body.status
    }
    if ('startsAt' in body) survey.startsAt = normalizeDateInput(body.startsAt)
    if ('endsAt' in body) survey.endsAt = normalizeDateInput(body.endsAt)
    validateSurveyTimeWindow(survey.startsAt, survey.endsAt)
    if ('voteMode' in body) {
      if (!['single', 'multiple'].includes(body.voteMode)) throw httpError(400, '投票模式无效。')
      survey.voteMode = body.voteMode
    }
    if ('maxVotes' in body) survey.maxVotes = normalizeVoteLimit(body.maxVotes)
    if ('resultVisibility' in body) {
      if (!['always', 'after_vote', 'hidden'].includes(body.resultVisibility)) throw httpError(400, '结果可见性无效。')
      survey.resultVisibility = body.resultVisibility
    }
    if ('allowVoteEdits' in body) survey.allowVoteEdits = Boolean(body.allowVoteEdits)
    if ('requireLogin' in body) survey.requireLogin = Boolean(body.requireLogin)
    if ('candidateSubmission' in body) {
      asRecord(body.candidateSubmission, '候选项投稿配置')
      survey.candidateSubmission = {
        enabled: body.candidateSubmission.enabled !== false,
        requiresReview: body.candidateSubmission.requiresReview !== false
      }
    }
    survey.updatedAt = now()
    state.auditLogs.unshift({ id: createId('log'), action: 'survey.settings_saved', actor: admin.displayName, detail: `${admin.displayName} 保存了问卷「${survey.title}」的设置`, surveyId: survey.id, createdAt: survey.updatedAt })
    return stateForRequest(normalizeState(state), req)
  })
}

const updateSurveyFieldsMutation = async (req, surveyId, body) => {
  const admin = requireAdmin(req)
  return updateState((state) => {
    const survey = state.surveys.find((item) => item.id === surveyId)
    if (!survey) throw httpError(404, '问卷不存在。')
    const fields = normalizeCandidateFields(body.candidateFields)
    validateCandidateFields(fields)
    const previousFieldsById = new Map((survey.candidateFields ?? []).map((field) => [field.id, field]))
    for (const candidate of state.candidates.filter((item) => item.surveyId === survey.id)) {
      for (const field of fields) {
        const previousKey = previousFieldsById.get(field.id)?.key
        if (previousKey && previousKey !== field.key && candidate.fields[field.key] === undefined) {
          candidate.fields[field.key] = candidate.fields[previousKey] ?? ''
        }
      }
    }
    survey.candidateFields = fields
    survey.updatedAt = now()
    state.auditLogs.unshift({ id: createId('log'), action: 'survey.fields_saved', actor: admin.displayName, detail: `${admin.displayName} 保存了问卷「${survey.title}」的投稿字段`, surveyId: survey.id, createdAt: survey.updatedAt })
    return stateForRequest(normalizeState(state), req)
  })
}

const deleteSurveyMutation = async (req, surveyId) => {
  const admin = requireAdmin(req)
  return updateState((state) => {
    const survey = state.surveys.find((item) => item.id === surveyId)
    if (!survey) throw httpError(404, '问卷不存在。')
    if (state.votes.some((vote) => vote.surveyId === surveyId)) {
      throw httpError(409, '该问卷已有投票记录。为保留追责数据，请将问卷关闭，不能永久删除。')
    }
    if (state.surveys.length <= 1) throw httpError(400, '至少需要保留一个问卷。')
    state.surveys = state.surveys.filter((item) => item.id !== surveyId)
    state.candidates = state.candidates.filter((item) => item.surveyId !== surveyId)
    state.votes = state.votes.filter((item) => item.surveyId !== surveyId)
    state.auditLogs = state.auditLogs.filter((item) => item.surveyId !== surveyId)
    state.auditLogs.unshift({ id: createId('log'), action: 'survey.deleted', actor: admin.displayName, detail: `${admin.displayName} 删除了问卷「${survey.title}」及其关联数据`, createdAt: now() })
    return stateForRequest(normalizeState(state), req)
  })
}

const createAdminCandidateMutation = async (req, body) => {
  const admin = requireAdmin(req)
  return updateState((state) => {
    const survey = state.surveys.find((item) => item.id === body.surveyId)
    if (!survey) throw httpError(404, '问卷不存在。')
    const values = cleanFieldValues(survey, body.fields)
    validateCandidateValues(survey, values)
    const title = titleFromValues(survey, values)
    if (state.candidates.find((item) => item.surveyId === survey.id && item.status !== 'rejected' && normalizeTitle(item.title) === normalizeTitle(title))) {
      throw httpError(400, '当前问卷已经存在同名候选项。')
    }
    const ts = now()
    state.candidates.unshift({
      id: createId('candidate'),
      surveyId: survey.id,
      title,
      status: 'approved',
      sortOrder: nextCandidateSortOrder(state, survey.id),
      fields: values,
      submitterUserId: admin.id,
      submitterName: admin.displayName,
      createdAt: ts,
      reviewedAt: ts,
      reviewerName: admin.displayName
    })
    state.auditLogs.unshift({ id: createId('log'), action: 'candidate.admin_created', actor: admin.displayName, detail: `${admin.displayName} 添加了「${title}」作为「${survey.title}」的候选项`, surveyId: survey.id, createdAt: ts })
    return stateForRequest(normalizeState(state), req)
  })
}

const updateAdminCandidateMutation = async (req, candidateId, body) => {
  const admin = requireAdmin(req)
  return updateState((state) => {
    const candidate = state.candidates.find((item) => item.id === candidateId)
    if (!candidate) throw httpError(404, '候选项不存在。')
    const survey = state.surveys.find((item) => item.id === candidate.surveyId)
    if (!survey) throw httpError(404, '候选项所属问卷不存在。')
    let changed = false
    if ('fields' in body) {
      const values = cleanFieldValues(survey, body.fields)
      validateCandidateValues(survey, values)
      const title = titleFromValues(survey, values, candidate.title)
      if (state.candidates.find((item) => item.id !== candidate.id && item.surveyId === candidate.surveyId && item.status !== 'rejected' && normalizeTitle(item.title) === normalizeTitle(title))) {
        throw httpError(400, '当前问卷已经存在同名候选项。')
      }
      candidate.title = title
      candidate.fields = values
      state.auditLogs.unshift({ id: createId('log'), action: 'candidate.edited', actor: admin.displayName, detail: `${admin.displayName} 修改了候选项「${title}」`, surveyId: candidate.surveyId, createdAt: now() })
      changed = true
    }
    if ('status' in body) {
      if (!['pending', 'approved', 'rejected'].includes(body.status)) throw httpError(400, '候选项状态无效。')
      candidate.status = body.status
      candidate.reviewNote = boundedText(body.reviewNote ?? candidate.reviewNote, '审核备注', 1000)
      candidate.reviewedAt = now()
      candidate.reviewerName = admin.displayName
      state.auditLogs.unshift({ id: createId('log'), action: `candidate.${body.status}`, actor: admin.displayName, detail: `${admin.displayName} 将「${candidate.title}」标记为 ${body.status}`, surveyId: candidate.surveyId, createdAt: now() })
      changed = true
    }
    if (!changed) throw httpError(400, '没有可保存的候选项变更。')
    return stateForRequest(normalizeState(state), req)
  })
}

const deleteAdminCandidateMutation = async (req, candidateId) => {
  const admin = requireAdmin(req)
  return updateState((state) => {
    const candidate = state.candidates.find((item) => item.id === candidateId)
    if (!candidate) throw httpError(404, '候选项不存在。')
    const survey = state.surveys.find((item) => item.id === candidate.surveyId)
    if (!survey) throw httpError(404, '候选项所属问卷不存在。')
    const isReferenced = state.votes.some((vote) =>
      vote.surveyId === candidate.surveyId && (
        (vote.candidateIds ?? []).includes(candidateId) ||
        (vote.history ?? []).some((snapshot) => (snapshot.candidateIds ?? []).includes(candidateId))
      )
    )
    if (isReferenced) throw httpError(409, '该候选项已有投票记录。为保留追责数据，请将其标记为“已拒绝”，不能永久删除。')
    state.candidates = state.candidates.filter((item) => item.id !== candidateId)
    state.auditLogs.unshift({
      id: createId('log'),
      action: 'candidate.deleted',
      actor: admin.displayName,
      detail: `${admin.displayName} 删除了问卷「${survey.title}」的候选项「${candidate.title}」`,
      surveyId: candidate.surveyId,
      createdAt: now()
    })
    return stateForRequest(normalizeState(state), req)
  })
}

const reorderAdminCandidatesMutation = async (req, body) => {
  const admin = requireAdmin(req)
  return updateState((state) => {
    const survey = state.surveys.find((item) => item.id === body.surveyId)
    if (!survey) throw httpError(404, '问卷不存在。')
    if (!Array.isArray(body.candidateIds)) throw httpError(400, '候选项排序格式不正确。')
    const ids = body.candidateIds.map((id) => boundedText(id, '候选项 ID', 128, { required: true }))
    const surveyCandidates = state.candidates.filter((item) => item.surveyId === survey.id)
    const surveyCandidateIds = new Set(surveyCandidates.map((item) => item.id))
    if (ids.length !== surveyCandidateIds.size || new Set(ids).size !== ids.length) {
      throw httpError(400, '排序必须完整包含当前问卷的全部候选项，且不能重复。')
    }
    if (ids.some((id) => !surveyCandidateIds.has(id))) throw httpError(400, '排序中包含不属于当前问卷的候选项。')
    ids.forEach((id, index) => {
      const candidate = state.candidates.find((item) => item.id === id)
      if (candidate) candidate.sortOrder = index * 1000
    })
    const ts = now()
    state.auditLogs.unshift({ id: createId('log'), action: 'candidate.reordered', actor: admin.displayName, detail: `${admin.displayName} 调整了问卷「${survey.title}」的候选项顺序`, surveyId: survey.id, createdAt: ts })
    return stateForRequest(normalizeState(state), req)
  })
}

const applyCors = (req, res) => {
  const origin = headerValue(req, 'origin')
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Device-Id,X-XDUCraft-Proxy-Trace')
  res.setHeader('Access-Control-Expose-Headers', 'X-XDUCraft-Api-Trace,X-XDUCraft-Proxy-Trace')
}

const sendJson = (res, statusCode, body) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  res.end(JSON.stringify(body))
}

const sendText = (res, statusCode, body) => {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  })
  res.end(body)
}

const headerValue = (req, name) => {
  const value = req.headers[name.toLowerCase()]
  return Array.isArray(value) ? value.join(', ') : String(value || '')
}

const requestQueryKeysForLog = (req) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  return [...new Set([...url.searchParams.keys()])]
}

const requestFieldsForLog = (req, pathname) => ({
  method: req.method,
  pathname,
  queryKeys: requestQueryKeysForLog(req),
  host: headerValue(req, 'host'),
  forwardedHost: headerValue(req, 'x-forwarded-host'),
  forwardedFor: headerValue(req, 'x-forwarded-for'),
  forwardedProto: headerValue(req, 'x-forwarded-proto'),
  remoteAddress: req.socket.remoteAddress,
  remotePort: req.socket.remotePort,
  userAgent: headerValue(req, 'user-agent')
})

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon']
])

const serveStatic = async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  const requestedPath = pathname === '/' ? 'index.html' : pathname.replace(/^[/\\]+/, '')
  const filePath = path.resolve(distDir, requestedPath)
  const relativePath = path.relative(distDir, filePath)

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    sendText(res, 403, 'Forbidden')
    return
  }

  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) throw new Error('Not a file')
    res.writeHead(200, {
      'Content-Type': contentTypes.get(path.extname(filePath)) ?? 'application/octet-stream'
    })
    createReadStream(filePath).pipe(res)
  } catch {
    const indexPath = path.join(distDir, 'index.html')
    try {
      await stat(indexPath)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      createReadStream(indexPath).pipe(res)
    } catch {
      sendText(res, 404, 'Build output not found. Run npm run build first, or use npm run dev for Vite.')
    }
  }
}

const enforceRateLimit = (req, res, scope, limit) => {
  const result = rateLimit(`${scope}:${clientIpFromRequest(req)}`, limit)
  if (result.allowed) return true
  res.setHeader('Retry-After', String(result.retryAfterSeconds))
  sendJson(res, 429, { error: '请求过于频繁，请稍后重试。' })
  return false
}

const handleApi = async (req, res, pathname) => {
  if (req.method === 'OPTIONS') {
    sendText(res, 204, '')
    return
  }

  if (pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      time: now()
    })
    return
  }

  if (proxySecret) {
    const value = Array.isArray(req.headers['x-xducraft-proxy-secret'])
      ? req.headers['x-xducraft-proxy-secret'][0]
      : req.headers['x-xducraft-proxy-secret']
    if (!value || !safeEqual(value, proxySecret)) {
      sendJson(res, 403, { error: '后端 API 只接受受信任代理访问。' })
      return
    }
  }

  if (pathname === '/api/auth/blessing/status' && req.method === 'GET') {
    sendJson(res, 200, {
      enabled: blessingAuthEnabled(),
      callbackUrl: blessingRedirectUri,
      adminConfigured: blessingAdminIds.size > 0
    })
    return
  }

  if (pathname === '/api/auth/blessing/login' && req.method === 'GET') {
    if (!blessingAuthEnabled()) {
      sendJson(res, 503, { error: 'XDUCraft 皮肤站登录未配置' })
      return
    }
    if (!enforceRateLimit(req, res, 'oauth-login', 10)) return
    cleanupAuthMaps()
    if (oauthStates.size >= 1000) {
      sendJson(res, 503, { error: '登录请求暂时过多，请稍后重试。' })
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const state = createToken('oauth-state')
    const traceId = createTraceId()
    const returnTo = safeReturnTo(url.searchParams.get('returnTo') || '/')
    const role = url.searchParams.get('role') === 'admin' ? 'admin' : 'player'
    oauthStates.set(state, {
      returnTo,
      role,
      traceId,
      createdAt: Date.now(),
      expiresAt: Date.now() + oauthStateTtlMs
    })
    const authorizeUrl = new URL(blessingUrl('/oauth/authorize'))
    authorizeUrl.searchParams.set('client_id', blessingClientId)
    authorizeUrl.searchParams.set('redirect_uri', blessingRedirectUri)
    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('scope', blessingOAuthScope)
    authorizeUrl.searchParams.set('state', state)
    writeAuthLog('oauth.login.redirect', {
      traceId,
      role,
      returnTo,
      authorizeHost: authorizeUrl.host,
      redirectUri: blessingRedirectUri,
      scope: blessingOAuthScope
    })
    sendRedirect(res, authorizeUrl.toString())
    return
  }

  if (pathname === '/api/auth/blessing/callback' && req.method === 'GET') {
    cleanupAuthMaps()
    const url = new URL(req.url ?? '/', 'http://localhost')
    const state = url.searchParams.get('state') || ''
    const stateEntry = oauthStates.get(state)
    if (!stateEntry) {
      writeAuthLog('oauth.callback.invalid_state', { hasState: Boolean(state) })
      redirectToFrontend(res, '/', { auth_error: '登录状态已过期，请重新登录。' })
      return
    }
    const traceId = stateEntry.traceId || createTraceId()
    const callbackStartedAt = Date.now()
    writeAuthLog('oauth.callback.start', {
      traceId,
      role: stateEntry.role,
      returnTo: stateEntry.returnTo,
      stateAgeMs: stateEntry.createdAt ? Date.now() - stateEntry.createdAt : undefined,
      hasCode: Boolean(url.searchParams.get('code')),
      hasError: Boolean(url.searchParams.get('error'))
    })
    oauthStates.delete(state)
    const error = url.searchParams.get('error')
    if (error) {
      writeAuthLog('oauth.callback.authorization_error', { traceId, error })
      redirectToFrontend(res, stateEntry.returnTo, { auth_error: `授权失败：${error}` })
      return
    }
    const code = url.searchParams.get('code')
    if (!code) {
      writeAuthLog('oauth.callback.missing_code', { traceId })
      redirectToFrontend(res, stateEntry.returnTo, { auth_error: '授权回调缺少 code。' })
      return
    }
    try {
      writeAuthLog('oauth.callback.exchange_code.start', { traceId })
      const token = await exchangeBlessingCode(code, traceId)
      writeAuthLog('oauth.callback.exchange_code.end', { traceId, elapsedMs: Date.now() - callbackStartedAt })
      const accessToken = token.access_token
      if (!accessToken) throw new Error('XDUCraft 皮肤站未返回 access_token')
      const userFetchStartedAt = Date.now()
      writeAuthLog('oauth.callback.fetch_user.start', { traceId })
      const profile = await fetchBlessingUser(accessToken, traceId)
      writeAuthLog('oauth.callback.fetch_user.end', { traceId, elapsedMs: Date.now() - userFetchStartedAt })
      if (blessingFetchPlayers && !Array.isArray(profile.players)) {
        try {
          const playersFetchStartedAt = Date.now()
          writeAuthLog('oauth.callback.fetch_players.start', { traceId })
          const players = await fetchBlessingPlayers(accessToken, traceId)
          if (Array.isArray(players)) profile.players = players
          else if (Array.isArray(players?.data)) profile.players = players.data
          writeAuthLog('oauth.callback.fetch_players.end', {
            traceId,
            elapsedMs: Date.now() - playersFetchStartedAt,
            playersCount: Array.isArray(profile.players) ? profile.players.length : 0
          })
        } catch (error) {
          writeAuthLog('oauth.callback.fetch_players.skipped', { traceId, error: describeFetchError(error) })
          console.warn(`[blessing] /api/players skipped: ${describeFetchError(error)}`)
        }
      }
      const user = mapBlessingUser(profile, traceId)
      const ticket = createToken('auth-ticket')
      const { adminGrantKey: _adminGrantKey, ...clientUser } = user
      if (authTickets.size >= 1000) cleanupAuthMaps()
      if (authTickets.size >= 1000) throw new Error('待领取登录会话过多，请稍后重试')
      authTickets.set(ticket, { user: clientUser, sessionToken: createSessionToken(user), expiresAt: Date.now() + authTicketTtlMs })
      writeAuthLog('oauth.callback.success', {
        traceId,
        role: user.role,
        userId: user.id,
        displayName: user.displayName,
        totalElapsedMs: Date.now() - callbackStartedAt
      })
      redirectToFrontend(res, stateEntry.returnTo, { auth_ticket: ticket })
    } catch (error) {
      writeAuthLog('oauth.callback.failure', {
        traceId,
        error: describeFetchError(error),
        totalElapsedMs: Date.now() - callbackStartedAt
      })
      redirectToFrontend(res, stateEntry.returnTo, {
        auth_error: error instanceof Error ? error.message : 'XDUCraft 皮肤站登录失败'
      })
    }
    return
  }

  if (pathname === '/api/auth/blessing/session' && req.method === 'GET') {
    cleanupAuthMaps()
    const url = new URL(req.url ?? '/', 'http://localhost')
    const ticket = url.searchParams.get('ticket') || ''
    const entry = authTickets.get(ticket)
    if (!entry) {
      sendJson(res, 404, { error: '登录票据无效或已过期' })
      return
    }
    authTickets.delete(ticket)
    sendJson(res, 200, { user: entry.user, sessionToken: entry.sessionToken })
    return
  }

  if (!enforceRateLimit(req, res, 'api', 120)) return
  if (pathname === '/api/state' && req.method === 'GET') {
    sendJson(res, 200, stateForRequest(await loadState(), req))
    return
  }

  if (pathname === '/api/votes' && req.method === 'POST') {
    if (!enforceRateLimit(req, res, 'vote', 30)) return
    sendJson(res, 200, await submitVoteMutation(req, await readJsonBody(req, maxJsonBodyBytes)))
    return
  }

  if (pathname === '/api/candidates' && req.method === 'POST') {
    if (!enforceRateLimit(req, res, 'candidate-submit', 10)) return
    sendJson(res, 200, await submitCandidateMutation(req, await readJsonBody(req, maxJsonBodyBytes)))
    return
  }

  if (pathname === '/api/admin/surveys' && req.method === 'POST') {
    sendJson(res, 200, await createSurveyMutation(req, await readJsonBody(req, maxJsonBodyBytes)))
    return
  }

  const surveyFieldsMatch = pathname.match(/^\/api\/admin\/surveys\/([^/]+)\/fields$/)
  if (surveyFieldsMatch && req.method === 'PUT') {
    sendJson(res, 200, await updateSurveyFieldsMutation(req, decodeURIComponent(surveyFieldsMatch[1]), await readJsonBody(req, maxJsonBodyBytes)))
    return
  }

  const surveyMatch = pathname.match(/^\/api\/admin\/surveys\/([^/]+)$/)
  if (surveyMatch && req.method === 'PATCH') {
    sendJson(res, 200, await updateSurveyMutation(req, decodeURIComponent(surveyMatch[1]), await readJsonBody(req, maxJsonBodyBytes)))
    return
  }

  if (surveyMatch && req.method === 'DELETE') {
    sendJson(res, 200, await deleteSurveyMutation(req, decodeURIComponent(surveyMatch[1])))
    return
  }

  if (pathname === '/api/admin/candidates' && req.method === 'POST') {
    sendJson(res, 200, await createAdminCandidateMutation(req, await readJsonBody(req, maxJsonBodyBytes)))
    return
  }

  if (pathname === '/api/admin/candidates/reorder' && req.method === 'POST') {
    sendJson(res, 200, await reorderAdminCandidatesMutation(req, await readJsonBody(req, maxJsonBodyBytes)))
    return
  }

  const candidateMatch = pathname.match(/^\/api\/admin\/candidates\/([^/]+)$/)
  if (candidateMatch && req.method === 'PATCH') {
    sendJson(res, 200, await updateAdminCandidateMutation(req, decodeURIComponent(candidateMatch[1]), await readJsonBody(req, maxJsonBodyBytes)))
    return
  }

  if (candidateMatch && req.method === 'DELETE') {
    sendJson(res, 200, await deleteAdminCandidateMutation(req, decodeURIComponent(candidateMatch[1])))
    return
  }

  sendJson(res, 404, { error: 'API route not found' })
}

const server = createServer(async (req, res) => {
  const startedAt = Date.now()
  let pathname = '/'
  let isApiRequest = false
  let statusForLog = 200
  let caughtError = null
  const proxyTrace = headerValue(req, 'x-xducraft-proxy-trace')
  const traceId = proxyTrace || createTraceId()
  res.setHeader('x-xducraft-api-trace', traceId)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'same-origin')
  if ((req.url ?? '').startsWith('/api/')) applyCors(req, res)
  const originalWriteHead = res.writeHead
  res.writeHead = function patchedWriteHead(statusCode, ...args) {
    statusForLog = Number(statusCode) || statusForLog
    return originalWriteHead.call(this, statusCode, ...args)
  }

  try {
    const parsedUrl = new URL(req.url ?? '/', 'http://localhost')
    pathname = parsedUrl.pathname
    isApiRequest = pathname.startsWith('/api/')
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname)
      return
    }
    await serveStatic(req, res)
  } catch (error) {
    caughtError = error
    const status = error instanceof Error && Number(error.status) ? Number(error.status) : 500
    statusForLog = status
    if (res.headersSent) {
      res.destroy(error instanceof Error ? error : undefined)
    } else {
      const publicMessage = status >= 500 ? '服务器内部错误，请使用 traceId 联系管理员。' : error instanceof Error ? error.message : '请求失败'
      sendJson(res, status, { error: publicMessage, traceId })
    }
  } finally {
    if (isApiRequest) {
      writeAccessLog('api.request', {
        traceId,
        proxyTrace: proxyTrace || undefined,
        ...requestFieldsForLog(req, pathname),
        status: Number(res.statusCode) || statusForLog,
        elapsedMs: Date.now() - startedAt,
        error: caughtError ? describeFetchError(caughtError) : undefined
      })
    }
  }
})
server.requestTimeout = 30000
server.headersTimeout = 15000
server.keepAliveTimeout = 5000
server.maxRequestsPerSocket = 1000
server.on('error', (error) => {
  console.error(`[server] ${error instanceof Error ? error.message : error}`)
})


server.listen(port, '0.0.0.0', () => {
  console.log(`XDUCraft Survey API listening on http://localhost:${port}`)
  console.log(`Data file: ${stateFile}`)
  console.log(`Access log: ${accessFileLogEnabled ? accessLogFile : 'disabled'}`)
  console.log(`Auth log: ${authFileLogEnabled ? authLogFile : 'disabled'}`)
})
