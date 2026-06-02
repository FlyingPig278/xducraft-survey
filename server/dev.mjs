import { spawn } from 'node:child_process'

const commands = [
  ['api', 'node', ['server/index.mjs'], { PORT: process.env.PORT || '8787' }],
  ['vite', 'vite', ['--host', '0.0.0.0'], {}]
]

const children = commands.map(([name, command, args, env]) => {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['inherit', 'pipe', 'pipe']
  })

  child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`))
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`))
  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`)
      shutdown()
    }
  })

  return child
})

const shutdown = () => {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
}

process.on('SIGINT', () => {
  shutdown()
  process.exit(0)
})

process.on('SIGTERM', () => {
  shutdown()
  process.exit(0)
})
