export type FieldType = 'text' | 'textarea' | 'url' | 'select' | 'number'

export type SurveyStatus = 'draft' | 'open' | 'closed'

export type VoteMode = 'single' | 'multiple'

export type ResultVisibility = 'always' | 'after_vote' | 'hidden'

export type CandidateStatus = 'pending' | 'approved' | 'rejected'

export type UserRole = 'player' | 'admin'

export interface FieldDefinition {
  id: string
  key: string
  label: string
  type: FieldType
  required: boolean
  placeholder?: string
  options?: string[]
}

export interface SurveyDefinition {
  id: string
  title: string
  description: string
  guideText: string
  status: SurveyStatus
  startsAt?: string | null
  endsAt?: string | null
  resultVisibility: ResultVisibility
  allowVoteEdits: boolean
  requireLogin: boolean
  voteMode: VoteMode
  maxVotes: number
  candidateSubmission: {
    enabled: boolean
    requiresReview: boolean
  }
  candidateFields: FieldDefinition[]
  createdAt: string
  updatedAt: string
}

export interface Candidate {
  id: string
  surveyId: string
  title: string
  status: CandidateStatus
  fields: Record<string, string>
  submitterUserId: string
  submitterName: string
  createdAt: string
  reviewedAt?: string
  reviewerName?: string
  reviewNote?: string
}

export interface VoteSnapshot {
  candidateIds: string[]
  changedAt: string
}

export interface VoteRecord {
  id: string
  surveyId: string
  userId: string
  userName: string
  gameId: string
  candidateIds: string[]
  createdAt: string
  updatedAt: string
  history: VoteSnapshot[]
}

export interface AuthUser {
  id: string
  displayName: string
  gameId: string
  role: UserRole
  authProvider: 'blessing'
  blessingUserId?: string
}

export interface AuditLog {
  id: string
  action: string
  actor: string
  detail: string
  surveyId?: string
  createdAt: string
}

export interface AppState {
  surveys: SurveyDefinition[]
  candidates: Candidate[]
  votes: VoteRecord[]
  auditLogs: AuditLog[]
}
