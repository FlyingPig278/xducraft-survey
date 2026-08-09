const DANGEROUS_CSV_PREFIX = /^[\t\r ]*[=+\-@]/

export const safeHttpUrl = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

export const openHttpUrl = (value: string) => {
  const url = safeHttpUrl(value)
  if (!url) return false
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}

export const csvCell = (value: unknown) => {
  const text = String(value ?? '')
  const neutralized = DANGEROUS_CSV_PREFIX.test(text) ? `'${text}` : text
  return `"${neutralized.replaceAll('"', '""')}"`
}
