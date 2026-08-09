export const aggregateSurveyResults = (state, surveyId) => {
  const approvedIds = new Set(state.candidates
    .filter((candidate) => candidate.surveyId === surveyId && candidate.status === 'approved')
    .map((candidate) => candidate.id))
  const votes = state.votes.filter((vote) => vote.surveyId === surveyId)
  const counts = {}
  let totalSelections = 0
  for (const vote of votes) {
    for (const candidateId of Array.isArray(vote.candidateIds) ? vote.candidateIds : []) {
      if (!approvedIds.has(candidateId)) continue
      counts[candidateId] = (counts[candidateId] ?? 0) + 1
      totalSelections += 1
    }
  }
  return { totalVoters: votes.length, totalSelections, counts }
}

const resultsVisibleTo = (survey, state, viewer) => {
  if (viewer.role === 'admin') return true
  if (survey.resultVisibility === 'always') return true
  if (survey.resultVisibility !== 'after_vote' || !viewer.userId) return false
  return state.votes.some((vote) => vote.surveyId === survey.id && vote.userId === viewer.userId)
}

const ownVotesFor = (state, viewer, visibleSurveyIds) => {
  if (!viewer.userId) return []
  return state.votes
    .filter((vote) => visibleSurveyIds.has(vote.surveyId) && vote.userId === viewer.userId)
    .map((vote) => ({
      ...vote,
      candidateIds: Array.isArray(vote.candidateIds) ? [...vote.candidateIds] : [],
      history: Array.isArray(vote.history) ? vote.history.map((item) => ({ ...item, candidateIds: [...item.candidateIds] })) : []
    }))
}

export const stateForViewer = (state, viewer) => {
  const isAdmin = viewer.role === 'admin'
  const surveys = isAdmin ? state.surveys : state.surveys.filter((survey) => survey.status !== 'draft')
  const visibleSurveyIds = new Set(surveys.map((survey) => survey.id))
  const results = Object.fromEntries(surveys
    .filter((survey) => resultsVisibleTo(survey, state, viewer))
    .map((survey) => [survey.id, aggregateSurveyResults(state, survey.id)]))

  if (isAdmin) {
    return { ...state, results }
  }

  return {
    surveys,
    candidates: state.candidates
      .filter((candidate) => visibleSurveyIds.has(candidate.surveyId) && candidate.status === 'approved')
      .map((candidate) => ({
        ...candidate,
        submitterUserId: '',
        submitterName: '',
        reviewedAt: undefined,
        reviewerName: undefined,
        reviewNote: undefined
      })),
    votes: ownVotesFor(state, viewer, visibleSurveyIds),
    auditLogs: [],
    results
  }
}
