import { afterEach, describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import os from 'node:os'
import path from 'node:path'

const children = []
const tempDirs = []

afterEach(async () => {
  await Promise.all(children.splice(0).map(async (child) => {
    if (child.exitCode !== null) return
    child.kill('SIGTERM')
    await once(child, 'exit')
  }))
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const reservePort = async () => {
  const server = createNetServer()
  const { promise, resolve, reject } = Promise.withResolvers()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
  await promise
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const close = Promise.withResolvers()
  server.once('close', close.resolve)
  server.close()
  await close.promise
  return port
}

const sessionToken = (secret) => {
  const payload = Buffer.from(JSON.stringify({
    id: 'admin-user',
    displayName: 'Admin',
    gameId: 'Admin',
    role: 'admin',
    authProvider: 'blessing',
    blessingUserId: 'admin',
    adminGrantKey: 'admin',
    exp: Date.now() + 60000
  })).toString('base64url')
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

const startApi = async (dataDir) => {
  const port = await reservePort()
  const secret = 'integration-session-secret-value-1234567890'
  let stderr = ''
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      FRONTEND_BASE_URL: 'http://127.0.0.1:5173',
      XDUCRAFT_DATA_DIR: dataDir,
      XDUCRAFT_ACCESS_FILE_LOG: 'false',
      XDUCRAFT_AUTH_FILE_LOG: 'false',
      XDUCRAFT_PROXY_SECRET: '',
      SESSION_SECRET: secret,
      BLESSING_ADMIN_IDS: 'admin'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  children.push(child)
  child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
  const baseUrl = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API exited before readiness: ${stderr}`)
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return { baseUrl, secret }
    } catch {
      // Retry until the process starts listening.
    }
    await delay(20)
  }
  throw new Error(`API readiness timeout: ${stderr}`)
}

const seedState = {
  surveys: [{
    id: 'survey-1', title: 'Survey', description: '', guideText: '', status: 'open', startsAt: null, endsAt: null,
    resultVisibility: 'always', allowVoteEdits: true, requireLogin: true, voteMode: 'multiple', maxVotes: 2,
    candidateSubmission: { enabled: true, requiresReview: true },
    candidateFields: [{ id: 'field-1', key: 'oldKey', label: 'Old field', type: 'text', required: false, placeholder: '' }],
    createdAt: '2026-01-01', updatedAt: '2026-01-01'
  }],
  candidates: [
    { id: 'a', surveyId: 'survey-1', title: 'A', status: 'approved', sortOrder: 0, fields: { oldKey: 'preserved' }, submitterUserId: '', submitterName: '', createdAt: '2026-01-01' },
    { id: 'b', surveyId: 'survey-1', title: 'B', status: 'approved', sortOrder: 1000, fields: {}, submitterUserId: '', submitterName: '', createdAt: '2026-01-01' }
  ],
  votes: [{ id: 'vote-1', surveyId: 'survey-1', userId: 'player', userName: 'Player', gameId: 'Player', candidateIds: ['a', 'b'], createdAt: '2026-01-01', updatedAt: '2026-01-01', history: [] }],
  auditLogs: []
}

describe.sequential('self-hosted API', () => {
  it('preserves historical multi-select votes when switching to single-select', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'xducraft-api-'))
    tempDirs.push(dataDir)
    await writeFile(path.join(dataDir, 'app-state.json'), JSON.stringify(seedState), 'utf8')
    const { baseUrl, secret } = await startApi(dataDir)
    const publicState = await (await fetch(`${baseUrl}/api/state`)).json()
    expect(publicState.votes).toEqual([])
    expect(publicState.auditLogs).toEqual([])
    expect(publicState.results['survey-1']).toMatchObject({ totalVoters: 1, totalSelections: 2, counts: { a: 1, b: 1 } })


    const response = await fetch(`${baseUrl}/api/admin/surveys/survey-1`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${sessionToken(secret)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ voteMode: 'single', maxVotes: 1 })
    })

    expect(response.status).toBe(200)
    const fieldsResponse = await fetch(`${baseUrl}/api/admin/surveys/survey-1/fields`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${sessionToken(secret)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidateFields: [{ id: 'field-1', key: 'newKey', label: 'New field', type: 'text', required: false, placeholder: '' }]
      })
    })
    expect(fieldsResponse.status).toBe(200)

    const persisted = JSON.parse(await readFile(path.join(dataDir, 'app-state.json'), 'utf8'))
    expect(persisted.surveys[0]).toMatchObject({ voteMode: 'single', maxVotes: 1 })
    expect(persisted.votes[0].candidateIds).toEqual(['a', 'b'])
    expect(persisted.candidates.find((candidate) => candidate.id === 'a').fields.newKey).toBe('preserved')

    const deleteResponse = await fetch(`${baseUrl}/api/admin/surveys/survey-1`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${sessionToken(secret)}` }
    })
    expect(deleteResponse.status).toBe(409)
  })

  it('returns an error without replacing malformed state data', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'xducraft-api-'))
    tempDirs.push(dataDir)
    const stateFile = path.join(dataDir, 'app-state.json')
    await writeFile(stateFile, '{ malformed', 'utf8')
    const { baseUrl } = await startApi(dataDir)

    const response = await fetch(`${baseUrl}/api/state`)

    expect(response.status).toBe(500)
    await expect(readFile(stateFile, 'utf8')).resolves.toBe('{ malformed')
  })
})
