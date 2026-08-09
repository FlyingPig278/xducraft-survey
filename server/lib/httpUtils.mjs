export const httpError = (status, message) => {
  const error = new Error(message)
  error.status = status
  return error
}

export const readJsonBody = async (req, maxBytes = 128 * 1024) => {
  const chunks = []
  let totalBytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.length
    if (totalBytes > maxBytes) throw httpError(413, '请求体过大。')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('root must be an object')
    return value
  } catch {
    throw httpError(400, '请求体不是有效的 JSON 对象。')
  }
}

export const parseIntegerEnv = (name, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min} 到 ${max} 之间的整数。`)
  }
  return value
}

export const validateSecret = (name, value, { required = false } = {}) => {
  const normalized = String(value || '').trim()
  const placeholder = /replace-with|change-me|your[-_]?secret|示例|随机字符串/i.test(normalized)
  if (!normalized) {
    if (required) throw new Error(`${name} 未配置。`)
    return ''
  }
  if (placeholder || normalized.length < 32) {
    throw new Error(`${name} 必须替换为至少 32 个字符的随机字符串，不能使用示例占位值。`)
  }
  return normalized
}

export const isHttpUrl = (value) => {
  if (!String(value || '').trim()) return true
  try {
    const url = new URL(String(value))
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export const clientIpFromRequest = (req) => {
  const forwarded = Array.isArray(req.headers['x-forwarded-for']) ? req.headers['x-forwarded-for'][0] : req.headers['x-forwarded-for']
  return String(forwarded || req.socket.remoteAddress || 'unknown').split(',')[0].trim()
}

export const createWindowRateLimiter = ({ windowMs, maxEntries = 10000 }) => {
  const entries = new Map()
  return (key, limit) => {
    const now = Date.now()
    if (entries.size >= maxEntries) {
      for (const [entryKey, entry] of entries) {
        if (entry.resetAt <= now) entries.delete(entryKey)
      }
      if (entries.size >= maxEntries) entries.delete(entries.keys().next().value)
    }
    const current = entries.get(key)
    if (!current || current.resetAt <= now) {
      entries.set(key, { count: 1, resetAt: now + windowMs })
      return { allowed: true, retryAfterSeconds: 0 }
    }
    current.count += 1
    if (current.count <= limit) return { allowed: true, retryAfterSeconds: 0 }
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) }
  }
}
