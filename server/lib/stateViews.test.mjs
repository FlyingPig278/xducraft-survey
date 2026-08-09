import { describe, expect, it } from 'vitest'
import { stateForViewer } from './stateViews.mjs'

const state = {
  surveys: [
    { id: 'draft', status: 'draft', resultVisibility: 'always' },
    { id: 'open', status: 'open', resultVisibility: 'after_vote' }
  ],
  candidates: [
    { id: 'draft-candidate', surveyId: 'draft', status: 'approved', submitterName: 'secret' },
    { id: 'approved', surveyId: 'open', status: 'approved', submitterName: 'Alice' },
    { id: 'pending', surveyId: 'open', status: 'pending', submitterName: 'Bob' }
  ],
  votes: [
    { id: 'own', surveyId: 'open', userId: 'user-1', candidateIds: ['approved'], history: [] },
    { id: 'other', surveyId: 'open', userId: 'user-2', candidateIds: ['approved'], history: [] }
  ],
  auditLogs: [{ id: 'audit' }]
}

describe('stateForViewer', () => {
  it('hides drafts, pending candidates, submitters and individual ballots from public viewers', () => {
    const view = stateForViewer(state, { role: 'player', userId: '' })

    expect(view.surveys.map((survey) => survey.id)).toEqual(['open'])
    expect(view.candidates.map((candidate) => candidate.id)).toEqual(['approved'])
    expect(view.candidates[0].submitterName).toBe('')
    expect(view.votes).toEqual([])
    expect(view.results).toEqual({})
    expect(view.auditLogs).toEqual([])
  })

  it('returns only the viewer ballot and aggregate results after voting', () => {
    const view = stateForViewer(state, { role: 'player', userId: 'user-1' })

    expect(view.votes.map((vote) => vote.id)).toEqual(['own'])
    expect(view.results.open).toEqual({
      totalVoters: 2,
      totalSelections: 2,
      counts: { approved: 2 }
    })
  })

  it('keeps full records for administrators', () => {
    const view = stateForViewer(state, { role: 'admin', userId: 'admin' })

    expect(view.surveys).toHaveLength(2)
    expect(view.candidates).toHaveLength(3)
    expect(view.votes).toHaveLength(2)
    expect(view.auditLogs).toHaveLength(1)
  })
})
