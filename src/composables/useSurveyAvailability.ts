import type { SurveyDefinition } from '../types'

export type SurveyAvailabilityReason = 'draft' | 'closed' | 'not_started' | 'ended' | 'active'

interface SurveyAvailability {
  reason: SurveyAvailabilityReason
  canSubmit: boolean
  message: string
}

const timeValue = (value?: string | null) => {
  if (!value) return null
  const ts = Date.parse(value)
  return Number.isFinite(ts) ? ts : null
}

export const formatDateTime = (value?: string | null) => {
  const ts = timeValue(value)
  if (!ts) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(ts))
}

export const formatSurveyWindow = (survey: SurveyDefinition) => {
  const start = formatDateTime(survey.startsAt)
  const end = formatDateTime(survey.endsAt)
  if (start && end) return `${start} - ${end}`
  if (start) return `${start} 开始`
  if (end) return `${end} 结束`
  return ''
}

export const getSurveyAvailability = (survey: SurveyDefinition, now = Date.now()): SurveyAvailability => {
  if (survey.status === 'draft') {
    return { reason: 'draft', canSubmit: false, message: '问卷暂未开放。' }
  }
  if (survey.status === 'closed') {
    return { reason: 'closed', canSubmit: false, message: '问卷已关闭。' }
  }

  const startsAt = timeValue(survey.startsAt)
  if (startsAt && now < startsAt) {
    return { reason: 'not_started', canSubmit: false, message: `问卷将于 ${formatDateTime(survey.startsAt)} 开始。` }
  }

  const endsAt = timeValue(survey.endsAt)
  if (endsAt && now >= endsAt) {
    return { reason: 'ended', canSubmit: false, message: `问卷已于 ${formatDateTime(survey.endsAt)} 结束。` }
  }

  return { reason: 'active', canSubmit: true, message: '问卷开放中。' }
}

export const isSurveyAcceptingSubmissions = (survey: SurveyDefinition) =>
  getSurveyAvailability(survey).canSubmit
