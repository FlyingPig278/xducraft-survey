import { copyFile, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const isMissingFileError = (error) => error && typeof error === 'object' && error.code === 'ENOENT'

export const createJsonStateStore = ({
  filePath,
  createSeed,
  normalize,
  lockTimeoutMs = 5000,
  staleLockMs = 30000
}) => {
  const lockFile = `${filePath}.lock`
  const backupFile = `${filePath}.bak`
  let queue = Promise.resolve()

  const ensureDirectory = () => mkdir(path.dirname(filePath), { recursive: true })

  const read = async () => {
    await ensureDirectory()
    try {
      const raw = await readFile(filePath, 'utf8')
      return normalize(JSON.parse(raw))
    } catch (error) {
      if (isMissingFileError(error)) return createSeed()
      if (error instanceof SyntaxError) {
        const wrapped = new Error(`状态文件不是有效 JSON，已停止写入以保护原数据：${filePath}`)
        wrapped.code = 'INVALID_STATE_FILE'
        wrapped.cause = error
        throw wrapped
      }
      throw error
    }
  }

  const acquireLock = async () => {
    const startedAt = Date.now()
    await ensureDirectory()
    while (true) {
      try {
        const handle = await open(lockFile, 'wx')
        await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, 'utf8')
        return handle
      } catch (error) {
        if (!error || error.code !== 'EEXIST') throw error
        try {
          const lockStat = await stat(lockFile)
          if (Date.now() - lockStat.mtimeMs > staleLockMs) {
            await rm(lockFile, { force: true })
            continue
          }
        } catch (statError) {
          if (!isMissingFileError(statError)) throw statError
          continue
        }
        if (Date.now() - startedAt >= lockTimeoutMs) {
          const timeoutError = new Error('等待状态文件写锁超时，请确认没有异常残留的服务进程。')
          timeoutError.code = 'STATE_LOCK_TIMEOUT'
          throw timeoutError
        }
        await sleep(25)
      }
    }
  }

  const releaseLock = async (handle) => {
    try {
      await handle.close()
    } finally {
      await rm(lockFile, { force: true })
    }
  }

  const persist = async (state) => {
    await ensureDirectory()
    const normalized = normalize(state)
    const tempFile = `${filePath}.${process.pid}.${randomUUID()}.tmp`
    const handle = await open(tempFile, 'wx')
    try {
      await handle.writeFile(JSON.stringify(normalized, null, 2), 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }

    try {
      try {
        await copyFile(filePath, backupFile)
      } catch (error) {
        if (!isMissingFileError(error)) throw error
      }
      await rename(tempFile, filePath)
      return normalized
    } catch (error) {
      await rm(tempFile, { force: true })
      throw error
    }
  }

  const load = async () => {
    await queue
    return read()
  }

  const update = async (mutator) => {
    let output
    queue = queue.then(async () => {
      const lockHandle = await acquireLock()
      try {
        const current = await read()
        const draft = structuredClone(current)
        output = await mutator(draft)
        await persist(draft)
        return output
      } finally {
        await releaseLock(lockHandle)
      }
    }, async () => {
      const lockHandle = await acquireLock()
      try {
        const current = await read()
        const draft = structuredClone(current)
        output = await mutator(draft)
        await persist(draft)
        return output
      } finally {
        await releaseLock(lockHandle)
      }
    })
    await queue
    return output
  }

  return { load, update }
}
