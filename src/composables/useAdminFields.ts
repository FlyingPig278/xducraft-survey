import { computed, reactive, ref, watch } from 'vue'
import type { FieldDefinition, FieldType } from '../types'
import { createId } from '../storage'
import { useAppState } from './useAppState'
import { useAuth } from './useAuth'
import { fieldOptions } from './useCandidateFields'
import { surveyApi } from '../api'

const fieldDrafts = ref<FieldDefinition[]>([])
const draggedFieldId = ref('')

const newField = reactive({
  label: '',
  key: '',
  type: 'text' as FieldType,
  required: true,
  placeholder: '',
  optionsText: ''
})

const cloneField = (f: FieldDefinition): FieldDefinition => ({ ...f, id: f.id || createId('field'), options: f.options ? [...f.options] : undefined })

export function useAdminFields() {
  const { survey, appState, applyRemoteState, message } = useAppState()
  const { isAdmin, currentUser } = useAuth()

  const fieldsDirty = computed(() => JSON.stringify(survey.value.candidateFields) !== JSON.stringify(fieldDrafts.value))
  const surveyHasCandidates = computed(() => appState.value.candidates.some((c) => c.surveyId === survey.value.id))

  const syncFieldDrafts = () => {
    fieldDrafts.value = survey.value.candidateFields.map(cloneField)
  }

  watch(() => survey.value.id, syncFieldDrafts, { immediate: true })

  const buildKey = (label: string, fallbackIndex = Math.max(fieldDrafts.value.length, survey.value.candidateFields.length) + 1) => {
    const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    return key || `custom_field_${fallbackIndex}`
  }

  const addField = () => {
    const label = newField.label.trim()
    if (!label) { message.warning('请先填写字段名称。'); return }
    const key = (newField.key.trim() || buildKey(label)).replace(/[^a-zA-Z0-9_]/g, '_')
    if (fieldDrafts.value.some((f) => f.key === key)) { message.warning('字段 key 已存在。'); return }
    fieldDrafts.value = [...fieldDrafts.value, { id: createId('field'), key, label, type: newField.type, required: newField.required, placeholder: newField.placeholder.trim(), options: newField.optionsText.split('\n').map((o) => o.trim()).filter(Boolean) }]
    newField.label = ''; newField.key = ''; newField.type = 'text'; newField.required = true; newField.placeholder = ''; newField.optionsText = ''
    message.success('字段已加入草稿，请保存后生效。')
  }

  const removeField = (field: FieldDefinition) => {
    fieldDrafts.value = fieldDrafts.value.filter((f) => f.id !== field.id)
  }

  const moveField = (fieldId: string, offset: number) => {
    const fields = [...fieldDrafts.value]
    const idx = fields.findIndex((f) => f.id === fieldId)
    const next = idx + offset
    if (idx < 0 || next < 0 || next >= fields.length) return
    const [f] = fields.splice(idx, 1)
    fields.splice(next, 0, f)
    fieldDrafts.value = fields
  }

  const dropFieldBefore = (targetId: string) => {
    const srcId = draggedFieldId.value; draggedFieldId.value = ''
    if (!srcId || srcId === targetId) return
    const fields = [...fieldDrafts.value]
    const si = fields.findIndex((f) => f.id === srcId)
    const ti = fields.findIndex((f) => f.id === targetId)
    if (si < 0 || ti < 0) return
    const [f] = fields.splice(si, 1)
    fields.splice(si < ti ? ti - 1 : ti, 0, f)
    fieldDrafts.value = fields
  }

  const updateFieldOptions = (field: FieldDefinition, value: string) => {
    field.options = value.split('\n').map((o) => o.trim()).filter(Boolean)
  }

  const saveFieldDrafts = async (successText = '字段配置已保存') => {
    if (!isAdmin.value || !currentUser.value) { message.error('请先登录管理员身份。'); return false }
    const surveyId = survey.value.id
    const normalized = fieldDrafts.value.map((field, index) => ({
      ...field,
      label: field.label.trim(),
      key: (field.key.trim() || buildKey(field.label, index + 1)).replace(/[^a-zA-Z0-9_]/g, '_'),
      placeholder: field.placeholder?.trim() ?? '',
      options: fieldOptions(field)
    }))
    if (normalized.some((field) => !field.label || !field.key)) { message.warning('字段名称和 Key 不能为空。'); return false }
    const keySet = new Set<string>()
    for (const field of normalized) {
      if (keySet.has(field.key)) { message.warning(`字段 key「${field.key}」重复。`); return false }
      keySet.add(field.key)
    }
    try {
      applyRemoteState(await surveyApi.updateSurveyFields(surveyId, normalized.map(cloneField)), surveyId)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '字段保存失败')
      return false
    }
    syncFieldDrafts()
    message.success(successText)
    return true
  }

  return {
    fieldDrafts,
    draggedFieldId,
    newField,
    fieldsDirty,
    surveyHasCandidates,
    syncFieldDrafts,
    addField,
    removeField,
    moveField,
    dropFieldBefore,
    updateFieldOptions,
    saveFieldDrafts
  }
}
