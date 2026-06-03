import { createServer } from 'node:http'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { setDefaultResultOrder } from 'node:dns'

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
const blessingAdminIds = new Set((process.env.BLESSING_ADMIN_IDS || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean))
const blessingFetchTimeoutMs = Math.max(1000, Number(process.env.BLESSING_FETCH_TIMEOUT_MS || 8000))
const blessingFetchRetries = Math.max(0, Number(process.env.BLESSING_FETCH_RETRIES || 2))
const blessingTokenRetries = Math.max(0, Number(process.env.BLESSING_TOKEN_RETRIES || 0))
const blessingUserAgent = process.env.BLESSING_USER_AGENT || 'XDUCraft-Survey/0.1'
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

const parseJsonResponse = async (response) => {
  const text = await response.text()
  let body = {}
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = { raw: text }
    }
  }
  if (!response.ok) {
    const detail = typeof body === 'object' && body && 'error' in body ? body.error : response.statusText
    const error = new Error(`Blessing Skin 请求失败：${detail}`)
    error.status = response.status
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

const fetchBlessingJson = async (pathname, init = {}, options = {}) => {
  const retries = Math.max(0, Number(options.retries ?? blessingFetchRetries))
  const attempts = retries + 1
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), blessingFetchTimeoutMs)
    const startedAt = Date.now()
    try {
      const response = await fetch(blessingUrl(pathname), {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': blessingUserAgent,
          Connection: 'close',
          ...init.headers
        }
      })
      const body = await parseJsonResponse(response)
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
    } finally {
      clearTimeout(timeout)
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

const firstText = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return ''
}

const normalizeUserKey = (value) =>
  String(value || '').trim().toLowerCase()

const mapBlessingUser = (profile, requestedRole = 'player') => {
  profile = typeof profile === 'object' && profile ? profile : {}
  const blessingUserId = firstText(profile.uid, profile.id, profile.user_id, profile.email, profile.nickname, profile.username, createId('blessing-user'))
  const email = firstText(profile.email)
  const displayName = firstText(profile.nickname, profile.username, profile.name, email.split('@')[0], `用户 ${blessingUserId}`)
  const playerNames = Array.isArray(profile.players)
    ? profile.players.map((player) => firstText(player?.name, player?.player_name, player?.username)).filter(Boolean)
    : []
  const gameId = firstText(profile.player_name, profile.gameId, profile.game_id, ...playerNames, profile.username, profile.nickname, displayName)
  const adminKeys = [
    blessingUserId,
    profile.uid,
    profile.id,
    profile.user_id,
    profile.email,
    profile.nickname,
    profile.username,
    displayName,
    gameId
  ].map(normalizeUserKey)
  const canUseAdmin = requestedRole === 'admin' && adminKeys.some((key) => blessingAdminIds.has(key))
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

const field = (id, key, label, type, required = true, placeholder = '', options) => ({
  id,
  key,
  label,
  type,
  required,
  placeholder,
  options
})

const createSeedState = () => {
  const ts = now()
  const survey = {
    id: 'survey-season-1',
    title: 'XDUCraft 下一期服务器方案投票',
    description: '请选择你愿意参与的服务器方案。',
    guideText: '请先确认列表中是否已有你想玩的服务器。若没有，请选择列表末尾的自定义项提交候选。',
    status: 'open',
    resultVisibility: 'always',
    allowVoteEdits: false,
    requireLogin: true,
    voteMode: 'multiple',
    maxVotes: 3,
    candidateSubmission: {
      enabled: true,
      requiresReview: true
    },
    candidateFields: [
      field('field-pack-name', 'packName', '整合包名', 'text', true, '例如 All the Mods 10'),
      field('field-modloader', 'modloader', 'ModLoader', 'select', true, '', ['Fabric', 'Forge', 'NeoForge', 'Quilt', 'Vanilla/DataPack']),
      field('field-game-version', 'gameVersion', '游戏版本', 'text', true, '例如 1.20.1'),
      field('field-category', 'category', '大致分类', 'select', true, '', ['科技', '魔法', '冒险探索', '养老建筑', '专家包', '轻量休闲', '大型综合']),
      field('field-pack-url', 'packUrl', '整合包链接', 'url', true, 'CurseForge / Modrinth / 官网链接'),
      field('field-video-url', 'videoUrl', '宣传视频', 'url', false, 'Bilibili / YouTube 链接'),
      field('field-notes', 'notes', '介绍 / 推荐理由', 'textarea', false, '简要介绍玩法、亮点或推荐理由')
    ],
    createdAt: ts,
    updatedAt: ts
  }

  return {
    surveys: [survey],
    candidates: [
      {
        id: 'candidate-atm10',
        surveyId: survey.id,
        title: 'All the Mods 10',
        status: 'approved',
        fields: {
          packName: 'All the Mods 10',
          modloader: 'NeoForge',
          gameVersion: '1.21.1',
          category: '大型综合',
          packUrl: 'https://www.curseforge.com/minecraft/modpacks/all-the-mods-10',
          videoUrl: 'https://www.bilibili.com/',
          notes: '内容覆盖面广，适合长期推进。'
        },
        submitterUserId: 'mock-steve',
        submitterName: 'Steve',
        createdAt: ts,
        reviewedAt: ts,
        reviewerName: 'Admin'
      },
      {
        id: 'candidate-create',
        surveyId: survey.id,
        title: 'Create: Arcane Engineering',
        status: 'approved',
        fields: {
          packName: 'Create: Arcane Engineering',
          modloader: 'Forge',
          gameVersion: '1.19.2',
          category: '科技',
          packUrl: 'https://www.curseforge.com/minecraft/modpacks/create-arcane-engineering',
          videoUrl: '',
          notes: '机械动力主线清晰，适合多人分工。'
        },
        submitterUserId: 'mock-alex',
        submitterName: 'Alex',
        createdAt: ts,
        reviewedAt: ts,
        reviewerName: 'Admin'
      },
      {
        id: 'candidate-bcg',
        surveyId: survey.id,
        title: 'Better Minecraft',
        status: 'approved',
        fields: {
          packName: 'Better Minecraft',
          modloader: 'Fabric',
          gameVersion: '1.20.1',
          category: '冒险探索',
          packUrl: 'https://www.curseforge.com/minecraft/modpacks/better-mc-fabric',
          videoUrl: '',
          notes: '比较接近原版体验，入门门槛低。'
        },
        submitterUserId: 'mock-herobrine',
        submitterName: 'Herobrine',
        createdAt: ts,
        reviewedAt: ts,
        reviewerName: 'Admin'
      },
      {
        id: 'candidate-pending-statech',
        surveyId: survey.id,
        title: 'StaTech Industry',
        status: 'pending',
        fields: {
          packName: 'StaTech Industry',
          modloader: 'Fabric',
          gameVersion: '1.19.2',
          category: '科技',
          packUrl: 'https://www.curseforge.com/minecraft/modpacks/statech-industry',
          videoUrl: '',
          notes: '科技线紧凑，想试试现代工业路线。'
        },
        submitterUserId: 'mock-guest',
        submitterName: 'Guest',
        createdAt: ts
      }
    ],
    votes: [
      {
        id: 'vote-steve',
        surveyId: survey.id,
        userId: 'mock-steve',
        userName: 'Steve',
        gameId: 'Steve',
        candidateIds: ['candidate-atm10', 'candidate-create'],
        createdAt: ts,
        updatedAt: ts,
        history: []
      },
      {
        id: 'vote-alex',
        surveyId: survey.id,
        userId: 'mock-alex',
        userName: 'Alex',
        gameId: 'Alex',
        candidateIds: ['candidate-create'],
        createdAt: ts,
        updatedAt: ts,
        history: []
      },
      {
        id: 'vote-builder',
        surveyId: survey.id,
        userId: 'mock-builder',
        userName: 'Builder',
        gameId: 'Builder',
        candidateIds: ['candidate-bcg', 'candidate-atm10'],
        createdAt: ts,
        updatedAt: ts,
        history: []
      }
    ],
    auditLogs: [
      {
        id: 'log-seed',
        action: 'system.seed',
        actor: 'System',
        detail: '创建演示问卷、候选项和投票记录',
        surveyId: survey.id,
        createdAt: ts
      }
    ]
  }
}

const normalizeSurvey = (survey) => {
  const { publicResults, resultVisibility, ...rest } = survey
  return {
    ...rest,
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

const ensureDataDir = () => mkdir(dataDir, { recursive: true })

const loadState = async () => {
  await ensureDataDir()
  try {
    const raw = await readFile(stateFile, 'utf8')
    const state = normalizeState(JSON.parse(raw))
    await saveState(state)
    return state
  } catch {
    const seed = createSeedState()
    await saveState(seed)
    return seed
  }
}

const saveState = async (state) => {
  await ensureDataDir()
  const normalized = normalizeState(state)
  await writeFile(stateFile, JSON.stringify(normalized, null, 2), 'utf8')
  return normalized
}

const readJsonBody = async (req) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const sendJson = (res, statusCode, body) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  })
  res.end(JSON.stringify(body))
}

const sendText = (res, statusCode, body) => {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
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

  if (pathname === '/api/auth/blessing/status' && req.method === 'GET') {
    sendJson(res, 200, {
      enabled: blessingAuthEnabled(),
      callbackUrl: blessingRedirectUri
    })
    return
  }

  if (pathname === '/api/auth/blessing/login' && req.method === 'GET') {
    if (!blessingAuthEnabled()) {
      sendJson(res, 503, { error: 'Blessing Skin OAuth 未配置' })
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
    authorizeUrl.searchParams.set('scope', '')
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
      if (!accessToken) throw new Error('Blessing Skin 未返回 access_token')
      const profile = await fetchBlessingUser(accessToken)
      const user = mapBlessingUser(profile, stateEntry.role)
      const ticket = createToken('auth-ticket')
      authTickets.set(ticket, { user, expiresAt: Date.now() + authTicketTtlMs })
      redirectToFrontend(res, stateEntry.returnTo, { auth_ticket: ticket })
    } catch (error) {
      redirectToFrontend(res, stateEntry.returnTo, {
        auth_error: error instanceof Error ? error.message : 'Blessing Skin 登录失败'
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
    sendJson(res, 200, entry.user)
    return
  }

  if (pathname === '/api/state' && req.method === 'GET') {
    sendJson(res, 200, await loadState())
    return
  }

  if (pathname === '/api/state' && req.method === 'PUT') {
    sendJson(res, 200, await saveState(await readJsonBody(req)))
    return
  }

  if (pathname === '/api/reset' && req.method === 'POST') {
    sendJson(res, 200, await saveState(createSeedState()))
    return
  }

  if (pathname === '/api/auth/mock-login' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const displayName = String(body.displayName || body.gameId || 'Player').trim()
    const gameId = String(body.gameId || displayName).trim()
    const normalizedId = gameId.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9_:-]/g, '-') || createId('user')
    sendJson(res, 200, {
      id: body.role === 'admin' ? 'mock-admin' : `mock-${normalizedId}`,
      displayName: body.role === 'admin' ? `${displayName} 管理员` : displayName,
      gameId,
      role: body.role === 'admin' ? 'admin' : 'player',
      authProvider: 'mock'
    })
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
    sendJson(res, 500, { error: error instanceof Error ? error.message : 'Internal server error' })
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`XDUCraft Survey API listening on http://localhost:${port}`)
  console.log(`Data file: ${stateFile}`)
})
