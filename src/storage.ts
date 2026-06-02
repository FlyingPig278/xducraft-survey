import type {
  AppState,
  AuditLog,
  Candidate,
  FieldDefinition,
  MockUser,
  SurveyDefinition,
  VoteRecord
} from './types'

const STATE_KEY = 'xducraft-survey-state-v2'
const USER_KEY = 'xducraft-survey-current-user-v1'

const now = () => new Date().toISOString()

const field = (
  id: string,
  key: string,
  label: string,
  type: FieldDefinition['type'],
  required = true,
  placeholder = '',
  options?: string[]
): FieldDefinition => ({ id, key, label, type, required, placeholder, options })

export const createId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const seedSurvey: SurveyDefinition = {
  id: 'survey-season-1',
  title: 'XDUCraft 下一期服务器方案投票',
  description: '请选择你愿意参与的服务器方案。',
  status: 'open',
  publicResults: true,
  allowVoteEdits: false,
  voteMode: 'multiple',
  maxVotes: 3,
  candidateSubmission: {
    enabled: true,
    requiresReview: true
  },
  candidateFields: [
    field('field-pack-name', 'packName', '整合包名', 'text', true, '例如 All the Mods 10'),
    field('field-modloader', 'modloader', 'ModLoader', 'select', true, '', [
      'Fabric',
      'Forge',
      'NeoForge',
      'Quilt',
      'Vanilla/DataPack'
    ]),
    field('field-game-version', 'gameVersion', '游戏版本', 'text', true, '例如 1.20.1'),
    field('field-category', 'category', '大致分类', 'select', true, '', [
      '科技',
      '魔法',
      '冒险探索',
      '养老建筑',
      '专家包',
      '轻量休闲',
      '大型综合'
    ]),
    field('field-pack-url', 'packUrl', '整合包链接', 'url', true, 'CurseForge / Modrinth / 官网链接'),
    field('field-video-url', 'videoUrl', '宣传视频', 'url', false, 'Bilibili / YouTube 链接'),
    field('field-notes', 'notes', '推荐理由', 'textarea', false, '简单说说它为什么适合服务器')
  ],
  createdAt: now(),
  updatedAt: now()
}

const seedCandidates: Candidate[] = [
  {
    id: 'candidate-atm10',
    surveyId: seedSurvey.id,
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
    createdAt: now(),
    reviewedAt: now(),
    reviewerName: 'Admin'
  },
  {
    id: 'candidate-create',
    surveyId: seedSurvey.id,
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
    createdAt: now(),
    reviewedAt: now(),
    reviewerName: 'Admin'
  },
  {
    id: 'candidate-bcg',
    surveyId: seedSurvey.id,
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
    createdAt: now(),
    reviewedAt: now(),
    reviewerName: 'Admin'
  },
  {
    id: 'candidate-pending-statech',
    surveyId: seedSurvey.id,
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
    createdAt: now()
  }
]

const seedVotes: VoteRecord[] = [
  {
    id: 'vote-steve',
    surveyId: seedSurvey.id,
    userId: 'mock-steve',
    userName: 'Steve',
    gameId: 'Steve',
    candidateIds: ['candidate-atm10', 'candidate-create'],
    createdAt: now(),
    updatedAt: now(),
    history: []
  },
  {
    id: 'vote-alex',
    surveyId: seedSurvey.id,
    userId: 'mock-alex',
    userName: 'Alex',
    gameId: 'Alex',
    candidateIds: ['candidate-create'],
    createdAt: now(),
    updatedAt: now(),
    history: []
  },
  {
    id: 'vote-builder',
    surveyId: seedSurvey.id,
    userId: 'mock-builder',
    userName: 'Builder',
    gameId: 'Builder',
    candidateIds: ['candidate-bcg', 'candidate-atm10'],
    createdAt: now(),
    updatedAt: now(),
    history: []
  }
]

const seedLogs: AuditLog[] = [
  {
    id: 'log-seed',
    action: 'system.seed',
    actor: 'System',
    detail: '创建演示问卷、候选项和投票记录',
    createdAt: now()
  }
]

export const createSeedState = (): AppState => ({
  surveys: [{ ...seedSurvey, candidateFields: seedSurvey.candidateFields.map((item) => ({ ...item })) }],
  candidates: seedCandidates.map((item) => ({ ...item, fields: { ...item.fields } })),
  votes: seedVotes.map((item) => ({ ...item, candidateIds: [...item.candidateIds], history: [] })),
  auditLogs: [...seedLogs]
})

export const loadState = (): AppState => {
  const raw = localStorage.getItem(STATE_KEY)
  if (!raw) {
    const seeded = createSeedState()
    saveState(seeded)
    return seeded
  }

  try {
    return JSON.parse(raw) as AppState
  } catch {
    const seeded = createSeedState()
    saveState(seeded)
    return seeded
  }
}

export const saveState = (state: AppState) => {
  localStorage.setItem(STATE_KEY, JSON.stringify(state))
}

export const loadUser = (): MockUser | null => {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null

  try {
    return JSON.parse(raw) as MockUser
  } catch {
    return null
  }
}

export const saveUser = (user: MockUser | null) => {
  if (!user) {
    localStorage.removeItem(USER_KEY)
    return
  }
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}
