import { createServer } from 'node:http'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { setDefaultResultOrder } from 'node:dns'
import { connect as tlsConnect } from 'node:tls'

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
const port = Number(process.env.PORT || 8787)
const frontendBaseUrl = (process.env.FRONTEND_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '')
const blessingBaseUrl = (process.env.BLESSING_BASE_URL || '').replace(/\/+$/, '')
const blessingClientId = process.env.BLESSING_CLIENT_ID || ''
const blessingClientSecret = process.env.BLESSING_CLIENT_SECRET || ''
const blessingRedirectUri = process.env.BLESSING_REDIRECT_URI || `http://localhost:${port}/api/auth/blessing/callback`
const blessingOAuthScope = process.env.BLESSING_OAUTH_SCOPE ?? ''
const blessingAdminIds = new Set((process.env.BLESSING_ADMIN_IDS || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean))
const blessingFetchTimeoutMs = Math.max(1000, Number(process.env.BLESSING_FETCH_TIMEOUT_MS || 8000))
const blessingFetchRetries = Math.max(0, Number(process.env.BLESSING_FETCH_RETRIES || 2))
const blessingTokenRetries = Math.max(0, Number(process.env.BLESSING_TOKEN_RETRIES || 0))
const blessingUserAgent = process.env.BLESSING_USER_AGENT || 'XDUCraft-Survey/0.1'
const blessingIpFamily = Number(process.env.BLESSING_IP_FAMILY || 4)
const blessingFetchPlayers = process.env.BLESSING_FETCH_PLAYERS === 'true'
const blessingProxyUrl = process.env.BLESSING_PROXY_URL || ''
const blessingDebugProfile = process.env.BLESSING_DEBUG_PROFILE === 'true'
const sessionSecret = process.env.SESSION_SECRET || randomBytes(32).toString('hex')
const sessionTtlMs = Math.max(3600, Number(process.env.SESSION_TTL_SECONDS || 60 * 60 * 24 * 14)) * 1000
const proxySecret = process.env.XDUCRAFT_PROXY_SECRET || ''
const oauthStates = new Map()
const authTickets = new Map()
const oauthStateTtlMs = 10 * 60 * 1000
const authTicketTtlMs = 2 * 60 * 1000

const now = () => new Date().toISOString()

const createId = (prefix) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const createToken = (prefix) => `${prefix}-${randomBytes(18).toString('base64url')}`

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
      blessingUserId: data.blessingUserId ? String(data.blessingUserId) : undefined
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
  const normalized = String(value || '').trim().replace(/[^a-zA-Z0-9_:-]/g, '-')
  return normalized || ''
}

const viewerFromRequest = (req) => {
  const user = userFromRequest(req)
  if (user) return { user, userId: user.id, name: user.displayName, gameId: user.gameId, role: user.role }
  const deviceId = deviceIdFromRequest(req)
  if (deviceId) return { user: null, userId: `anon-${deviceId}`, name: '匿名玩家', gameId: '', role: 'player' }
  return { user: null, userId: '', name: '匿名玩家', gameId: '', role: 'player' }
}

const httpError = (status, message) => {
  const error = new Error(message)
  error.status = status
  return error
}

const requireAdmin = (req) => {
  const user = userFromRequest(req)
  if (!user) throw httpError(401, '请先登录管理员账号。')
  if (user.role !== 'admin') throw httpError(403, '当前账号没有管理员权限。')
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

const requestBlessingDirect = (pathname, init = {}) => new Promise((resolve, reject) => {
  const { url, body, headers, method } = buildBlessingRequest(pathname, init)
  const requestOptions = {
    method,
    headers,
    timeout: blessingFetchTimeoutMs
  }
  if (blessingIpFamily === 4 || blessingIpFamily === 6) {
    requestOptions.family = blessingIpFamily
  }

  const transport = url.protocol === 'http:' ? httpRequest : httpsRequest
  const req = transport(url, requestOptions, (response) => {
    const chunks = []
    response.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    response.on('end', () => {
      try {
        resolve(parseJsonPayload(
          response.statusCode ?? 0,
          response.statusMessage ?? '',
          Buffer.concat(chunks).toString('utf8')
        ))
      } catch (error) {
        reject(error)
      }
    })
  })

  const absoluteTimeout = setTimeout(() => {
    req.destroy(createTimeoutError())
  }, blessingFetchTimeoutMs)
  req.on('timeout', () => {
    req.destroy(createTimeoutError())
  })
  req.on('error', (error) => {
    clearTimeout(absoluteTimeout)
    reject(error)
  })
  req.on('close', () => {
    clearTimeout(absoluteTimeout)
  })
  if (body) req.write(body)
  req.end()
})

const requestBlessingViaProxy = (pathname, init = {}) => new Promise((resolve, reject) => {
  const { url, body, headers, method } = buildBlessingRequest(pathname, init)
  const proxy = new URL(blessingProxyUrl)
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
    if (tunnelSocket) tunnelSocket.destroy(error)
    else connectReq.destroy(error)
  }, blessingFetchTimeoutMs)

  connectReq.on('connect', (proxyRes, socket) => {
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
    tlsSocket.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    tlsSocket.on('end', () => {
      clearTimeout(absoluteTimeout)
      try {
        resolve(parseRawHttpResponse(Buffer.concat(chunks)))
      } catch (error) {
        reject(error)
      }
    })
    tlsSocket.on('error', (error) => {
      clearTimeout(absoluteTimeout)
      reject(error)
    })
  })

  connectReq.on('timeout', () => {
    connectReq.destroy(createTimeoutError())
  })
  connectReq.on('error', (error) => {
    clearTimeout(absoluteTimeout)
    reject(error)
  })
  connectReq.end()
})

const requestBlessingOnce = (pathname, init = {}) =>
  blessingProxyUrl ? requestBlessingViaProxy(pathname, init) : requestBlessingDirect(pathname, init)

const fetchBlessingJson = async (pathname, init = {}, options = {}) => {
  const retries = Math.max(0, Number(options.retries ?? blessingFetchRetries))
  const attempts = retries + 1
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const startedAt = Date.now()
    try {
      const body = await requestBlessingOnce(pathname, init)
      if (attempt > 1) {
        console.log(`[blessing] ${pathname} succeeded on attempt ${attempt} in ${Date.now() - startedAt}ms`)
      }
      return body
    } catch (error) {
      lastError = error
      const canRetry = attempt < attempts && isTransientBlessingError(error)
      console.warn(`[blessing] ${pathname} attempt ${attempt}/${attempts} failed in ${Date.now() - startedAt}ms: ${describeFetchError(error)}`)
      if (!canRetry) break
      await sleep(250 * attempt)
    }
  }
  throw lastError
}

const exchangeBlessingCode = async (code) => {
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
  }, { retries: blessingTokenRetries })
}

const fetchBlessingUser = async (accessToken) => {
  return fetchBlessingJson('/api/user', {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
}

const fetchBlessingPlayers = async (accessToken) => {
  return fetchBlessingJson('/api/players', {
    headers: { Authorization: `Bearer ${accessToken}` }
  }, { retries: 0 })
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

const logBlessingProfileShape = (rawProfile, profile, adminKeys) => {
  if (!blessingDebugProfile) return
  const root = asObject(rawProfile)
  console.log('[blessing] profile root keys:', Object.keys(root).join(', ') || '(none)')
  console.log('[blessing] profile user keys:', Object.keys(profile).join(', ') || '(none)')
  console.log('[blessing] admin match keys:', adminKeys.filter(Boolean).join(', ') || '(none)')
}

const mapBlessingUser = (rawProfile) => {
  const profile = unwrapBlessingProfile(rawProfile)
  const blessingUserId = firstText(profile.uid, profile.id, profile.user_id, profile.email, profile.nickname, profile.username, createId('blessing-user'))
  const email = firstText(profile.email)
  const displayName = firstText(profile.nickname, profile.username, profile.name, email.split('@')[0], `用户 ${blessingUserId}`)
  const players = Array.isArray(profile.players) ? profile.players : []
  const playerNames = players
    .map((player) => firstText(player?.name, player?.player_name, player?.username))
    .filter(Boolean)
  const playerIds = players
    .map((player) => firstText(player?.pid, player?.id, player?.uuid))
    .filter(Boolean)
  const permissions = Array.isArray(profile.permissions) ? profile.permissions : []
  const roles = Array.isArray(profile.roles) ? profile.roles : []
  const groups = Array.isArray(profile.groups) ? profile.groups : []
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
    profile.permission,
    ...permissions,
    ...roles,
    ...groups,
    ...playerIds,
    ...playerNames,
    displayName,
    gameId
  ].map(normalizeUserKey)
  logBlessingProfileShape(rawProfile, profile, adminKeys)
  const canUseAdmin = adminKeys.some((key) => blessingAdminIds.has(key))
  const normalizedId = blessingUserId.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9_:-]/g, '-') || createId('user')
  return {
    id: `blessing-${normalizedId}`,
    displayName,
    gameId,
    role: canUseAdmin ? 'admin' : 'player',
    authProvider: 'blessing',
    blessingUserId
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

const normalizeState = (state) => ({
  surveys: (state.surveys ?? []).map(normalizeSurvey),
  candidates: state.candidates ?? [],
  votes: state.votes ?? [],
  auditLogs: state.auditLogs ?? []
})

const timeValue = (value) => {
  if (!value) return null
  const ts = Date.parse(value)
  return Number.isFinite(ts) ? ts : null
}

const normalizeDateInput = (value) => {
  const ts = timeValue(value)
  return ts ? new Date(ts).toISOString() : null
}

const validateSurveyTimeWindow = (startsAt, endsAt) => {
  const start = timeValue(startsAt)
  const end = timeValue(endsAt)
  if (start && end && end <= start) throw httpError(400, '结束时间需要晚于开始时间。')
}

const isSurveyAcceptingSubmissions = (survey, ts = Date.now()) => {
  if (!survey || survey.status !== 'open') return false
  const startsAt = timeValue(survey.startsAt)
  if (startsAt && ts < startsAt) return false
  const endsAt = timeValue(survey.endsAt)
  if (endsAt && ts >= endsAt) return false
  return true
}

const publicVotesFor = (state, viewer) => {
  const visible = []
  for (const vote of state.votes) {
    const survey = state.surveys.find((item) => item.id === vote.surveyId)
    const isOwnVote = viewer.userId && vote.userId === viewer.userId
    const canExposeAggregate = survey?.resultVisibility === 'always' ||
      (survey?.resultVisibility === 'after_vote' && state.votes.some((item) => item.surveyId === vote.surveyId && item.userId === viewer.userId))
    if (!isOwnVote && !canExposeAggregate) continue
    visible.push({
      id: isOwnVote ? vote.id : `public-${vote.id}`,
      surveyId: vote.surveyId,
      userId: isOwnVote ? vote.userId : `public-${vote.id}`,
      userName: isOwnVote ? vote.userName : '匿名玩家',
      gameId: isOwnVote ? vote.gameId : '',
      candidateIds: Array.isArray(vote.candidateIds) ? [...vote.candidateIds] : [],
      createdAt: vote.createdAt,
      updatedAt: vote.updatedAt,
      history: isOwnVote ? (vote.history ?? []) : []
    })
  }
  return visible
}

const publicStateFor = (state, viewer) => ({
  surveys: state.surveys,
  candidates: state.candidates
    .filter((candidate) => candidate.status === 'approved')
    .map((candidate) => ({
      ...candidate,
      submitterUserId: '',
      submitterName: '',
      reviewedAt: undefined,
      reviewerName: undefined,
      reviewNote: undefined
    })),
  votes: publicVotesFor(state, viewer),
  auditLogs: []
})

const stateForRequest = (state, req) => {
  const viewer = viewerFromRequest(req)
  return viewer.user?.role === 'admin' ? state : publicStateFor(state, viewer)
}

const ensureDataDir = () => mkdir(dataDir, { recursive: true })
let stateWriteQueue = Promise.resolve()

const readStateFile = async () => {
  await ensureDataDir()
  try {
    const raw = await readFile(stateFile, 'utf8')
    return normalizeState(JSON.parse(raw))
  } catch {
    return createSeedState()
  }
}

const writeStateFile = async (state) => {
  await ensureDataDir()
  const normalized = normalizeState(state)
  const tempFile = `${stateFile}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempFile, JSON.stringify(normalized, null, 2), 'utf8')
  await rename(tempFile, stateFile)
  return normalized
}

const loadState = async () => {
  const state = await readStateFile()
  await saveState(state)
  return state
}

const saveState = async (state) => {
  const normalized = normalizeState(state)
  stateWriteQueue = stateWriteQueue.then(() => writeStateFile(normalized), () => writeStateFile(normalized))
  return stateWriteQueue
}

const updateState = async (mutator) => {
  let output
  stateWriteQueue = stateWriteQueue.then(async () => {
    const state = await readStateFile()
    output = await mutator(state)
    await writeStateFile(state)
    return output
  }, async () => {
    const state = await readStateFile()
    output = await mutator(state)
    await writeStateFile(state)
    return output
  })
  await stateWriteQueue
  return output
}

const readJsonBody = async (req) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const validateUrl = (value) => {
  if (!String(value || '').trim()) return true
  try {
    new URL(String(value))
    return true
  } catch {
    return false
  }
}

const normalizeTitle = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
const cleanFieldValues = (values = {}) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value ?? '').trim()]))

const titleFromValues = (survey, values, fallback = '未命名候选项') =>
  values.packName?.trim() || values.name?.trim() || values.title?.trim() ||
  (survey.candidateFields ?? []).map((field) => values[field.key]).find(Boolean)?.trim() ||
  fallback

const validateCandidateValues = (survey, values) => {
  for (const field of survey.candidateFields ?? []) {
    const value = values[field.key] ?? ''
    if (field.required && !value) throw httpError(400, `请填写「${field.label}」。`)
    if (field.type === 'url' && !validateUrl(value)) throw httpError(400, `「${field.label}」需要是完整链接。`)
  }
}

const normalizeCandidateFields = (fields = []) => fields.map((field, index) => ({
  id: field.id || createId('field'),
  key: String(field.key || `custom_field_${index + 1}`).trim().replace(/[^a-zA-Z0-9_]/g, '_'),
  label: String(field.label || '').trim(),
  type: ['text', 'textarea', 'url', 'select', 'number'].includes(field.type) ? field.type : 'text',
  required: Boolean(field.required),
  placeholder: String(field.placeholder || '').trim(),
  options: Array.isArray(field.options) ? field.options.map((item) => String(item).trim()).filter(Boolean) : undefined
}))

const validateCandidateFields = (fields) => {
  if (fields.some((field) => !field.key || !field.label)) throw httpError(400, '字段名称和 Key 不能为空。')
  const keys = new Set()
  for (const field of fields) {
    if (keys.has(field.key)) throw httpError(400, `字段 key「${field.key}」重复。`)
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
  const gameId = String(body.guestGameId || '').trim()
  if (!gameId) throw httpError(400, '请填写游戏昵称。')
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
  const candidateIds = [...new Set(Array.isArray(body.candidateIds) ? body.candidateIds.map(String) : [])]
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
  const values = cleanFieldValues(body.fields)
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
    const title = String(body.title || '').trim()
    if (!title) throw httpError(400, '请填写问卷标题。')
    const fields = normalizeCandidateFields(body.candidateFields)
    validateCandidateFields(fields)
    const ts = now()
    const survey = {
      id: createId('survey'),
      title,
      description: String(body.description || '').trim() || '请选择你愿意参与的服务器方案。',
      guideText: String(body.guideText || '').trim(),
      status: 'draft',
      startsAt: normalizeDateInput(body.startsAt),
      endsAt: normalizeDateInput(body.endsAt),
      resultVisibility: ['always', 'after_vote', 'hidden'].includes(body.resultVisibility) ? body.resultVisibility : 'always',
      allowVoteEdits: Boolean(body.allowVoteEdits),
      requireLogin: body.requireLogin !== false,
      voteMode: body.voteMode === 'single' ? 'single' : 'multiple',
      maxVotes: Math.max(1, Number(body.maxVotes) || 1),
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
    return { state: normalizeState(state), surveyId: survey.id }
  })
}

const updateSurveyMutation = async (req, surveyId, body) => {
  const admin = requireAdmin(req)
  return updateState((state) => {
    const survey = state.surveys.find((item) => item.id === surveyId)
    if (!survey) throw httpError(404, '问卷不存在。')
    if ('title' in body) {
      const title = String(body.title || '').trim()
      if (!title) throw httpError(400, '请填写问卷标题。')
      survey.title = title
    }
    if ('description' in body) survey.description = String(body.description || '').trim() || '请选择你愿意参与的服务器方案。'
    if ('guideText' in body) survey.guideText = String(body.guideText || '').trim()
    if ('status' in body && ['draft', 'open', 'closed'].includes(body.status)) survey.status = body.status
    if ('startsAt' in body) survey.startsAt = normalizeDateInput(body.startsAt)
    if ('endsAt' in body) survey.endsAt = normalizeDateInput(body.endsAt)
    validateSurveyTimeWindow(survey.startsAt, survey.endsAt)
    if ('voteMode' in body) survey.voteMode = body.voteMode === 'single' ? 'single' : 'multiple'
    if ('maxVotes' in body) survey.maxVotes = Math.max(1, Number(body.maxVotes) || 1)
    if ('resultVisibility' in body && ['always', 'after_vote', 'hidden'].includes(body.resultVisibility)) survey.resultVisibility = body.resultVisibility
    if ('allowVoteEdits' in body) survey.allowVoteEdits = Boolean(body.allowVoteEdits)
    if ('requireLogin' in body) survey.requireLogin = Boolean(body.requireLogin)
    if ('candidateSubmission' in body) {
      survey.candidateSubmission = {
        enabled: body.candidateSubmission?.enabled !== false,
        requiresReview: body.candidateSubmission?.requiresReview !== false
      }
    }
    survey.updatedAt = now()
    state.auditLogs.unshift({ id: createId('log'), action: 'survey.settings_saved', actor: admin.displayName, detail: `${admin.displayName} 保存了问卷「${survey.title}」的设置`, surveyId: survey.id, createdAt: survey.updatedAt })
    return normalizeState(state)
  })
}

const updateSurveyFieldsMutation = async (req, surveyId, body) => {
  const admin = requireAdmin(req)
  return updateState((state) => {
    const survey = state.surveys.find((item) => item.id === surveyId)
    if (!survey) throw httpError(404, '问卷不存在。')
    const fields = normalizeCandidateFields(body.candidateFields)
    validateCandidateFields(fields)
    survey.candidateFields = fields
    survey.updatedAt = now()
    state.auditLogs.unshift({ id: createId('log'), action: 'survey.fields_saved', actor: admin.displayName, detail: `${admin.displayName} 保存了问卷「${survey.title}」的投稿字段`, surveyId: survey.id, createdAt: survey.updatedAt })
    return normalizeState(state)
  })
}

const deleteSurveyMutation = async (req, surveyId) => {
  const admin = requireAdmin(req)
  return updateState((state) => {
    const survey = state.surveys.find((item) => item.id === surveyId)
    if (!survey) throw httpError(404, '问卷不存在。')
    if (state.surveys.length <= 1) throw httpError(400, '至少需要保留一个问卷。')
    state.surveys = state.surveys.filter((item) => item.id !== surveyId)
    state.candidates = state.candidates.filter((item) => item.surveyId !== surveyId)
    state.votes = state.votes.filter((item) => item.surveyId !== surveyId)
    state.auditLogs = state.auditLogs.filter((item) => item.surveyId !== surveyId)
    state.auditLogs.unshift({ id: createId('log'), action: 'survey.deleted', actor: admin.displayName, detail: `${admin.displayName} 删除了问卷「${survey.title}」及其关联数据`, createdAt: now() })
    return normalizeState(state)
  })
}

const createAdminCandidateMutation = async (req, body) => {
  const admin = requireAdmin(req)
  return updateState((state) => {
    const survey = state.surveys.find((item) => item.id === body.surveyId)
    if (!survey) throw httpError(404, '问卷不存在。')
    const values = cleanFieldValues(body.fields)
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
      fields: values,
      submitterUserId: admin.id,
      submitterName: admin.displayName,
      createdAt: ts,
      reviewedAt: ts,
      reviewerName: admin.displayName
    })
    state.auditLogs.unshift({ id: createId('log'), action: 'candidate.admin_created', actor: admin.displayName, detail: `${admin.displayName} 添加了「${title}」作为「${survey.title}」的候选项`, surveyId: survey.id, createdAt: ts })
    return normalizeState(state)
  })
}

const updateAdminCandidateMutation = async (req, candidateId, body) => {
  const admin = requireAdmin(req)
  return updateState((state) => {
    const candidate = state.candidates.find((item) => item.id === candidateId)
    if (!candidate) throw httpError(404, '候选项不存在。')
    const survey = state.surveys.find((item) => item.id === candidate.surveyId)
    if (!survey) throw httpError(404, '候选项所属问卷不存在。')
    if (body.fields) {
      const values = cleanFieldValues(body.fields)
      validateCandidateValues(survey, values)
      const title = titleFromValues(survey, values, candidate.title)
      if (state.candidates.find((item) => item.id !== candidate.id && item.surveyId === candidate.surveyId && item.status !== 'rejected' && normalizeTitle(item.title) === normalizeTitle(title))) {
        throw httpError(400, '当前问卷已经存在同名候选项。')
      }
      candidate.title = title
      candidate.fields = { ...candidate.fields, ...values }
      state.auditLogs.unshift({ id: createId('log'), action: 'candidate.edited', actor: admin.displayName, detail: `${admin.displayName} 修改了候选项「${title}」`, surveyId: candidate.surveyId, createdAt: now() })
    }
    if (body.status && ['pending', 'approved', 'rejected'].includes(body.status)) {
      candidate.status = body.status
      candidate.reviewNote = String(body.reviewNote ?? candidate.reviewNote ?? '')
      state.auditLogs.unshift({ id: createId('log'), action: `candidate.${body.status}`, actor: admin.displayName, detail: `${admin.displayName} 将「${candidate.title}」标记为 ${body.status}`, surveyId: candidate.surveyId, createdAt: now() })
    }
    candidate.reviewedAt = now()
    candidate.reviewerName = admin.displayName
    return normalizeState(state)
  })
}

const sendJson = (res, statusCode, body) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Device-Id'
  })
  res.end(JSON.stringify(body))
}

const sendText = (res, statusCode, body) => {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Device-Id'
  })
  res.end(body)
}

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
  const requestedPath = pathname === '/' ? '/index.html' : pathname
  const filePath = path.normalize(path.join(distDir, requestedPath))

  if (!filePath.startsWith(distDir)) {
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

const handleApi = async (req, res, pathname) => {
  if (req.method === 'OPTIONS') {
    sendText(res, 204, '')
    return
  }

  if (pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true })
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
    cleanupAuthMaps()
    const url = new URL(req.url ?? '/', 'http://localhost')
    const state = createToken('oauth-state')
    oauthStates.set(state, {
      returnTo: safeReturnTo(url.searchParams.get('returnTo') || '/'),
      role: url.searchParams.get('role') === 'admin' ? 'admin' : 'player',
      expiresAt: Date.now() + oauthStateTtlMs
    })
    const authorizeUrl = new URL(blessingUrl('/oauth/authorize'))
    authorizeUrl.searchParams.set('client_id', blessingClientId)
    authorizeUrl.searchParams.set('redirect_uri', blessingRedirectUri)
    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('scope', blessingOAuthScope)
    authorizeUrl.searchParams.set('state', state)
    sendRedirect(res, authorizeUrl.toString())
    return
  }

  if (pathname === '/api/auth/blessing/callback' && req.method === 'GET') {
    cleanupAuthMaps()
    const url = new URL(req.url ?? '/', 'http://localhost')
    const state = url.searchParams.get('state') || ''
    const stateEntry = oauthStates.get(state)
    if (!stateEntry) {
      redirectToFrontend(res, '/', { auth_error: '登录状态已过期，请重新登录。' })
      return
    }
    oauthStates.delete(state)
    const error = url.searchParams.get('error')
    if (error) {
      redirectToFrontend(res, stateEntry.returnTo, { auth_error: `授权失败：${error}` })
      return
    }
    const code = url.searchParams.get('code')
    if (!code) {
      redirectToFrontend(res, stateEntry.returnTo, { auth_error: '授权回调缺少 code。' })
      return
    }
    try {
      const token = await exchangeBlessingCode(code)
      const accessToken = token.access_token
      if (!accessToken) throw new Error('XDUCraft 皮肤站未返回 access_token')
      const profile = await fetchBlessingUser(accessToken)
      if (blessingFetchPlayers && !Array.isArray(profile.players)) {
        try {
          const players = await fetchBlessingPlayers(accessToken)
          if (Array.isArray(players)) profile.players = players
          else if (Array.isArray(players?.data)) profile.players = players.data
        } catch (error) {
          console.warn(`[blessing] /api/players skipped: ${describeFetchError(error)}`)
        }
      }
      const user = mapBlessingUser(profile)
      const ticket = createToken('auth-ticket')
      authTickets.set(ticket, { user, sessionToken: createSessionToken(user), expiresAt: Date.now() + authTicketTtlMs })
      redirectToFrontend(res, stateEntry.returnTo, { auth_ticket: ticket })
    } catch (error) {
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

  if (pathname === '/api/state' && req.method === 'GET') {
    sendJson(res, 200, stateForRequest(await loadState(), req))
    return
  }

  if (pathname === '/api/votes' && req.method === 'POST') {
    sendJson(res, 200, await submitVoteMutation(req, await readJsonBody(req)))
    return
  }

  if (pathname === '/api/candidates' && req.method === 'POST') {
    sendJson(res, 200, await submitCandidateMutation(req, await readJsonBody(req)))
    return
  }

  if (pathname === '/api/admin/surveys' && req.method === 'POST') {
    sendJson(res, 200, await createSurveyMutation(req, await readJsonBody(req)))
    return
  }

  const surveyFieldsMatch = pathname.match(/^\/api\/admin\/surveys\/([^/]+)\/fields$/)
  if (surveyFieldsMatch && req.method === 'PUT') {
    sendJson(res, 200, await updateSurveyFieldsMutation(req, decodeURIComponent(surveyFieldsMatch[1]), await readJsonBody(req)))
    return
  }

  const surveyMatch = pathname.match(/^\/api\/admin\/surveys\/([^/]+)$/)
  if (surveyMatch && req.method === 'PATCH') {
    sendJson(res, 200, await updateSurveyMutation(req, decodeURIComponent(surveyMatch[1]), await readJsonBody(req)))
    return
  }

  if (surveyMatch && req.method === 'DELETE') {
    sendJson(res, 200, await deleteSurveyMutation(req, decodeURIComponent(surveyMatch[1])))
    return
  }

  if (pathname === '/api/admin/candidates' && req.method === 'POST') {
    sendJson(res, 200, await createAdminCandidateMutation(req, await readJsonBody(req)))
    return
  }

  const candidateMatch = pathname.match(/^\/api\/admin\/candidates\/([^/]+)$/)
  if (candidateMatch && req.method === 'PATCH') {
    sendJson(res, 200, await updateAdminCandidateMutation(req, decodeURIComponent(candidateMatch[1]), await readJsonBody(req)))
    return
  }

  sendJson(res, 404, { error: 'API route not found' })
}

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname)
      return
    }
    await serveStatic(req, res)
  } catch (error) {
    const status = error instanceof Error && Number(error.status) ? Number(error.status) : 500
    sendJson(res, status, { error: error instanceof Error ? error.message : 'Internal server error' })
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`XDUCraft Survey API listening on http://localhost:${port}`)
  console.log(`Data file: ${stateFile}`)
})
