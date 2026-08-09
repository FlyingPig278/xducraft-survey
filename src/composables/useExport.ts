import { computed } from 'vue'
import { useAppState } from './useAppState'
import { useSurveyVote } from './useSurveyVote'
import { statusLabel } from './useCandidateFields'
import { csvCell } from '../utils/security'

export function useExport() {
  const { survey, appState } = useAppState()
  const { surveyCandidates, surveyVotes, approvedCandidates, totalVoters, totalSelections, candidateCounts } = useSurveyVote()

  const latestVote = computed(() => [...surveyVotes.value].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null)
  const currentSurveyAuditLogs = computed(() => appState.value.auditLogs.filter((log) => log.surveyId === survey.value.id))


  const downloadFile = (name: string, content: string, type: string) => {
    const normalizedContent = type.startsWith('text/csv') ? `\uFEFF${content}` : content
    const url = URL.createObjectURL(new Blob([normalizedContent], { type }))
    const link = document.createElement('a')
    link.href = url
    link.download = name
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const exportResultsCsv = () => {
    const h = ['问卷', '候选项', '状态', '票数', '投稿人', '创建时间', ...survey.value.candidateFields.map((f) => f.label)]
    const rows = surveyCandidates.value.map((c) => [survey.value.title, c.title, statusLabel(c.status), candidateCounts.value.get(c.id) ?? 0, c.submitterName, c.createdAt, ...survey.value.candidateFields.map((f) => c.fields[f.key] ?? '')])
    downloadFile('xducraft-survey-results.csv', [h, ...rows].map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8')
  }

  const exportVotesCsv = () => {
    const h = ['问卷', '玩家', '游戏 ID', '选择', '创建时间', '更新时间', '历史版本数']
    const rows = surveyVotes.value.map((v) => [
      survey.value.title,
      v.userName,
      v.gameId,
      v.candidateIds.map((id) => surveyCandidates.value.find((candidate) => candidate.id === id)?.title ?? '未知候选项').join(' / '),
      v.createdAt,
      v.updatedAt,
      v.history.length
    ])
    downloadFile('xducraft-survey-votes.csv', [h, ...rows].map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8')
  }

  const exportJson = () => {
    const data = { survey: survey.value, candidates: surveyCandidates.value, votes: surveyVotes.value, auditLogs: currentSurveyAuditLogs.value }
    downloadFile('xducraft-survey-data.json', JSON.stringify(data, null, 2), 'application/json')
  }

  return { latestVote, currentSurveyAuditLogs, totalVoters, totalSelections, approvedCandidates, surveyVotes, exportResultsCsv, exportVotesCsv, exportJson }
}
