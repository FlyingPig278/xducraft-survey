import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const commands = [
  ['api', process.execPath, [path.join(rootDir, 'server/index.mjs')], { PORT: process.env.PORT || '8787' }],
  ['vite', process.execPath, [path.join(rootDir, 'node_modules/vite/bin/vite.js'), '--host', '0.0.0.0'], {}]
]

const children = []
let shuttingDown = false

const shutdown = (exitCode = 0) => {
  if (shuttingDown) return
  shuttingDown = true
  process.exitCode = exitCode
  for (const child of children) {
    if (!child.killed && child.exitCode === null) child.kill('SIGTERM')
  }
}

for (const [name, command, args, env] of commands) {
  const child = spawn(command, args, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    stdio: ['inherit', 'pipe', 'pipe']
  })
  children.push(child)
  child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`))
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`))
  child.on('error', (error) => {
    console.error(`[${name}] failed to start: ${error instanceof Error ? error.message : error}`)
    shutdown(1)
  })
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`
    console.error(`[${name}] exited with ${reason}`)
    shutdown(code && code !== 0 ? code : 1)
  })
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
