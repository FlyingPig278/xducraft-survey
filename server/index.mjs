import { createServer } from 'node:http'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const dataDir = process.env.XDUCRAFT_DATA_DIR
  ? path.resolve(process.env.XDUCRAFT_DATA_DIR)
  : path.join(rootDir, 'data')
const stateFile = path.join(dataDir, 'app-state.json')
const port = Number(process.env.PORT || 8787)

const now = () => new Date().toISOString()

const createId = (prefix) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

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
    guideText: '请先确认列表中是否已有你想玩的服务器。若没有，请选择列表末尾的自定义项提交候选，审核通过后再投票。',
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
      field('field-notes', 'notes', '推荐理由', 'textarea', false, '简单说说它为什么适合服务器')
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
      role: body.role === 'admin' ? 'admin' : 'player'
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
