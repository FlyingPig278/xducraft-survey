import { computed, reactive, ref, watch } from 'vue'
import type { FieldDefinition, ResultVisibility, SurveyDefinition, SurveyStatus, VoteMode } from '../types'
import { createId } from '../storage'
import { useAppState } from './useAppState'
import { useAuth } from './useAuth'
import { navigateAdmin } from './useRouter'

export const DEFAULT_GUIDE_TEXT = '请先确认列表中是否已有你想玩的服务器。若没有，请选择列表末尾的自定义项提交候选。'
const LEGACY_GUIDE_TEXT = '请先确认列表中是否已有你想玩的服务器。若没有，请选择列表末尾的自定义项提交候选，审核通过后再投票。'

const defaultCandidateFieldTemplates: Array<Omit<FieldDefinition, 'id'>> = [
  { key: 'packName', label: '整合包名', type: 'text', required: true, placeholder: '例如 All the Mods 10' },
  { key: 'modloader', label: 'ModLoader', type: 'select', required: true, placeholder: '', options: ['Fabric', 'Forge', 'NeoForge', 'Quilt', 'Vanilla/DataPack'] },
  { key: 'gameVersion', label: '游戏版本', type: 'text', required: true, placeholder: '例如 1.20.1' },
  { key: 'category', label: '大致分类', type: 'select', required: true, placeholder: '', options: ['科技', '魔法', '冒险探索', '养老建筑', '专家包', '轻量休闲', '大型综合'] },
  { key: 'packUrl', label: '整合包链接', type: 'url', required: true, placeholder: 'CurseForge / Modrinth / 官网链接' },
  { key: 'videoUrl', label: '宣传视频', type: 'url', required: false, placeholder: 'Bilibili / YouTube 链接' },
  { key: 'notes', label: '介绍 / 推荐理由', type: 'textarea', required: false, placeholder: '简要介绍玩法、亮点或推荐理由' }
]

const surveyCreateModalOpen = ref(false)

const surveyDraft = reactive({
  title: '',
  description: '',
  guideText: DEFAULT_GUIDE_TEXT,
  voteMode: 'multiple' as VoteMode,
  maxVotes: 3,
  resultVisibility: 'always' as ResultVisibility,
  allowVoteEdits: false,
  requireLogin: true,
  candidateSubmissionEnabled: true,
  candidateSubmissionRequiresReview: true,
  cloneCurrentFields: true
})

const surveySettingsDraft = reactive({
  title: '',
  description: '',
  guideText: '',
  status: 'draft' as SurveyStatus,
  voteMode: 'multiple' as VoteMode,
  maxVotes: 3,
  resultVisibility: 'always' as ResultVisibility,
  allowVoteEdits: false,
  requireLogin: true,
  candidateSubmissionEnabled: true,
  candidateSubmissionRequiresReview: true
})

const duplicateField = (f: FieldDefinition): FieldDefinition => ({ ...f, id: createId('field'), options: f.options ? [...f.options] : undefined })
const createDefaultCandidateFields = (): FieldDefinition[] => defaultCandidateFieldTemplates.map((f) => ({ ...f, id: createId('field'), options: f.options ? [...f.options] : undefined }))

const settingsSnapshot = (item: SurveyDefinition) => JSON.stringify({
  title: item.title,
  description: item.description,
  guideText: item.guideText,
  status: item.status,
  voteMode: item.voteMode,
  maxVotes: item.maxVotes,
  resultVisibility: item.resultVisibility,
  allowVoteEdits: item.allowVoteEdits,
  requireLogin: item.requireLogin,
  candidateSubmissionEnabled: item.candidateSubmission.enabled,
  candidateSubmissionRequiresReview: item.candidateSubmission.requiresReview
})

export function useAdminSurvey() {
  const { survey, appState, persist, addAudit, message, surveys } = useAppState()
  const { isAdmin, currentUser } = useAuth()

  const surveyGuideText = computed(() => {
    const text = survey.value.guideText?.trim()
    return !text || text === LEGACY_GUIDE_TEXT ? DEFAULT_GUIDE_TEXT : text
  })

  const surveySettingsDirty = computed(() => settingsSnapshot(survey.value) !== JSON.stringify(surveySettingsDraft))
  const surveyHasVotes = computed(() => appState.value.votes.some((v) => v.surveyId === survey.value.id))

  const syncSurveySettingsDraft = () => {
    Object.assign(surveySettingsDraft, {
      title: survey.value.title,
      description: survey.value.description,
      guideText: survey.value.guideText,
      status: survey.value.status,
      voteMode: survey.value.voteMode,
      maxVotes: survey.value.maxVotes,
      resultVisibility: survey.value.resultVisibility,
      allowVoteEdits: survey.value.allowVoteEdits,
      requireLogin: survey.value.requireLogin,
      candidateSubmissionEnabled: survey.value.candidateSubmission.enabled,
      candidateSubmissionRequiresReview: survey.value.candidateSubmission.requiresReview
    })
  }

  watch(() => survey.value.id, syncSurveySettingsDraft, { immediate: true })

  const saveSurveySettings = async (successText = '问卷设置已保存') => {
    if (!isAdmin.value || !currentUser.value) { message.error('请先登录管理员身份。'); return false }
    const title = surveySettingsDraft.title.trim()
    if (!title) { message.warning('请填写问卷标题。'); return false }
    const surveyId = survey.value.id
    survey.value.title = title
    survey.value.description = surveySettingsDraft.description.trim() || '请选择你愿意参与的服务器方案。'
    survey.value.guideText = surveySettingsDraft.guideText.trim() || DEFAULT_GUIDE_TEXT
    survey.value.status = surveySettingsDraft.status
    survey.value.voteMode = surveySettingsDraft.voteMode
    survey.value.maxVotes = Math.max(1, Number(surveySettingsDraft.maxVotes) || 1)
    survey.value.resultVisibility = surveySettingsDraft.resultVisibility
    survey.value.allowVoteEdits = surveySettingsDraft.allowVoteEdits
    survey.value.requireLogin = surveySettingsDraft.requireLogin
    survey.value.candidateSubmission = {
      enabled: surveySettingsDraft.candidateSubmissionEnabled,
      requiresReview: surveySettingsDraft.candidateSubmissionRequiresReview
    }
    survey.value.updatedAt = new Date().toISOString()
    addAudit('survey.settings_saved', `${currentUser.value.displayName} 保存了问卷「${survey.value.title}」的设置`, surveyId, currentUser.value.displayName)
    if (!(await persist(surveyId))) return false
    syncSurveySettingsDraft()
    message.success(successText)
    return true
  }

  const publishSurvey = async () => {
    surveySettingsDraft.status = 'open'
    await saveSurveySettings('问卷已发布，公开链接现在可访问。')
  }

  const createSurvey = async () => {
    if (!isAdmin.value || !currentUser.value) { message.error('请先登录管理员身份。'); return }
    const title = surveyDraft.title.trim()
    if (!title) { message.warning('请填写新问卷标题。'); return }
    const ts = new Date().toISOString()
    const fields = surveyDraft.cloneCurrentFields ? survey.value.candidateFields.map(duplicateField) : createDefaultCandidateFields()
    const next: SurveyDefinition = {
      id: createId('survey'), title, description: surveyDraft.description.trim() || '请选择你愿意参与的服务器方案。',
      guideText: surveyDraft.guideText.trim() || DEFAULT_GUIDE_TEXT, status: 'draft', resultVisibility: surveyDraft.resultVisibility,
      allowVoteEdits: surveyDraft.allowVoteEdits, requireLogin: surveyDraft.requireLogin, voteMode: surveyDraft.voteMode,
      maxVotes: Math.max(1, Number(surveyDraft.maxVotes) || 1),
      candidateSubmission: { enabled: surveyDraft.candidateSubmissionEnabled, requiresReview: surveyDraft.candidateSubmissionRequiresReview },
      candidateFields: fields, createdAt: ts, updatedAt: ts
    }
    appState.value.surveys.unshift(next)
    surveyDraft.title = ''; surveyDraft.description = ''; surveyDraft.guideText = DEFAULT_GUIDE_TEXT
    addAudit('survey.created', `${currentUser.value.displayName} 创建了问卷「${next.title}」`, next.id, currentUser.value.displayName)
    if (!(await persist(next.id))) return
    surveyCreateModalOpen.value = false
    message.success(`问卷「${next.title}」已创建，开始配置投稿字段。`)
    navigateAdmin('fields', next.id)
  }

  return {
    surveyDraft,
    surveySettingsDraft,
    surveyCreateModalOpen,
    surveys,
    surveyGuideText,
    surveySettingsDirty,
    surveyHasVotes,
    syncSurveySettingsDraft,
    saveSurveySettings,
    publishSurvey,
    createSurvey
  }
}
