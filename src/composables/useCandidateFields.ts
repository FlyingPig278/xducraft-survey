import type { Candidate, FieldDefinition, FieldType, SurveyDefinition, SurveyStatus, CandidateStatus } from '../types'

export function useCandidateFields(surveyById: (id: string) => SurveyDefinition | undefined) {
  const candidateMetaFor = (candidate: Candidate, ownerSurvey = surveyById(candidate.surveyId)) =>
    (ownerSurvey?.candidateFields ?? [])
      .filter((f) => f.key !== 'packName' && f.type !== 'textarea' && f.type !== 'url')
      .slice(0, 3)
      .map((f) => candidate.fields[f.key])
      .filter(Boolean)
      .join(' / ')

  const candidateFieldValue = (candidate: Candidate, keys: string[], labelHints: string[] = [], type?: FieldType) => {
    const lowerKeys = new Set(keys.map((key) => key.toLowerCase()))
    const entry = Object.entries(candidate.fields).find(([key, value]) => lowerKeys.has(key.toLowerCase()) && value.trim())
    if (entry?.[1]?.trim()) return entry[1].trim()
    const lowerHints = labelHints.map((hint) => hint.toLowerCase())
    const ownerSurvey = surveyById(candidate.surveyId)
    const field = ownerSurvey?.candidateFields.find((item) => {
      if (type && item.type !== type) return false
      const label = item.label.toLowerCase()
      return lowerHints.some((hint) => label.includes(hint))
    })
    return field ? candidate.fields[field.key]?.trim() ?? '' : ''
  }

  const candidatePackUrl = (c: Candidate) => candidateFieldValue(c, ['packUrl', 'modpackUrl', 'serverUrl', 'link', 'url'], ['整合包', '服务器', 'modpack', 'pack', 'modrinth', 'curseforge'], 'url')
  const candidateVideoUrl = (c: Candidate) => candidateFieldValue(c, ['videoUrl', 'video', 'trailerUrl', 'promoVideo'], ['视频', '宣传', 'trailer', 'video', 'bilibili', 'youtube'], 'url')
  const candidateIntro = (c: Candidate) => candidateFieldValue(c, ['notes', 'intro', 'description', 'summary', 'reason'], ['介绍', '推荐', '理由', '说明', '描述', 'intro', 'description', 'summary', 'reason'])
  const candidateCategory = (c: Candidate) => candidateFieldValue(c, ['category', 'type', 'genre'], ['分类', '类型', 'category'])

  const candidateReviewFields = (candidate: Candidate) => {
    const ownerSurvey = surveyById(candidate.surveyId)
    const fields = ownerSurvey?.candidateFields ?? []
    if (fields.length === 0) return Object.entries(candidate.fields).map(([key, value]) => ({ key, label: key, value }))
    return fields.map((field) => ({ key: field.key, label: field.label, value: candidate.fields[field.key] || '未填' }))
  }

  const openExternal = (url: string) => { window.open(url, '_blank', 'noopener,noreferrer') }

  return { candidateMetaFor, candidatePackUrl, candidateVideoUrl, candidateIntro, candidateCategory, candidateReviewFields, openExternal }
}

export const fieldOptions = (field: FieldDefinition) => field.options?.filter(Boolean) ?? []
export const fieldSelectOptions = (field: FieldDefinition) => fieldOptions(field).map((o) => ({ label: o, value: o }))

export const statusLabel = (status: SurveyStatus | CandidateStatus) => {
  const labels: Record<string, string> = { draft: '草稿', open: '开放', closed: '已关闭', pending: '待审核', approved: '已通过', rejected: '已拒绝' }
  return labels[status] ?? status
}

export const statusTagType = (status: string): 'success' | 'warning' | 'error' | 'info' | 'default' => {
  const types: Record<string, 'success' | 'warning' | 'error' | 'info' | 'default'> = { draft: 'default', open: 'success', closed: 'error', pending: 'warning', approved: 'success', rejected: 'error' }
  return types[status] ?? 'default'
}

export const formatDate = (value?: string) => {
  if (!value) return '未记录'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}
