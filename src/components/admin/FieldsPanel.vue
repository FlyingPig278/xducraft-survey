<script setup lang="ts">
import { computed } from 'vue'
import { NCard, NForm, NFormItem, NInput, NSelect, NSpace, NSwitch, NButton, NAlert, NTag } from 'naive-ui'
import { Save, Eye, GripVertical, ChevronUp, ChevronDown, Trash2 } from '../../icons'
import { useAppState } from '../../composables/useAppState'
import { useAdminSurvey } from '../../composables/useAdminSurvey'
import { useAdminFields } from '../../composables/useAdminFields'
import { fieldOptions } from '../../composables/useCandidateFields'
import { publicSurveyUrlFor } from '../../composables/useRouter'

const { adminSurveyId, surveys } = useAppState()
const { saveSurveySettings, surveySettingsDirty } = useAdminSurvey()
const {
  fieldDrafts, draggedFieldId, newField,
  fieldsDirty, surveyHasCandidates,
  addField, removeField, moveField, dropFieldBefore, updateFieldOptions, saveFieldDrafts
} = useAdminFields()

const surveySelectOptions = computed(() => surveys.value.map((s) => ({ label: s.title, value: s.id })))
const hasSurveys = computed(() => surveys.value.length > 0)
const fieldTypeOptions = [
  { label: 'text', value: 'text' },
  { label: 'textarea', value: 'textarea' },
  { label: 'url', value: 'url' },
  { label: 'select', value: 'select' },
  { label: 'number', value: 'number' }
]

const openPreview = async () => {
  if (surveySettingsDirty.value) await saveSurveySettings('问卷设置已保存')
  if (fieldsDirty.value) await saveFieldDrafts('字段配置已保存')
  window.open(publicSurveyUrlFor(adminSurveyId.value), '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <div class="admin-section-header">
    <div>
      <h1>字段配置</h1>
      <p>管理当前问卷的候选项投稿字段，可拖拽排序。</p>
    </div>
    <div class="admin-section-header-actions">
      <n-tag :type="fieldsDirty ? 'warning' : 'success'" :bordered="false">
        {{ fieldsDirty ? '有未保存字段' : '字段已保存' }}
      </n-tag>
      <n-select v-model:value="adminSurveyId" :options="surveySelectOptions" :disabled="!hasSurveys" style="width: 240px" />
      <n-button type="primary" :disabled="!hasSurveys || !fieldsDirty" @click="saveFieldDrafts()">
        <template #icon><Save :size="14" /></template>
        保存字段
      </n-button>
      <n-button :disabled="!hasSurveys" @click="openPreview">
        <template #icon><Eye :size="14" /></template>
        打开问卷
      </n-button>
    </div>
  </div>

  <n-alert v-if="!hasSurveys" type="info" :bordered="false" style="margin-bottom: 16px">
    还没有问卷。请先在问卷列表中新建问卷。
  </n-alert>

  <n-alert v-else-if="surveyHasCandidates" type="warning" :bordered="false" style="margin-bottom: 16px">
    当前问卷已有候选项。修改字段 Key 后，旧候选项中对应字段可能不再显示。
  </n-alert>

  <n-space v-if="hasSurveys" vertical :size="12">
    <div
      v-for="(field, index) in fieldDrafts"
      :key="field.id"
      class="field-row"
      draggable="true"
      @dragstart="draggedFieldId = field.id"
      @dragover.prevent
      @drop="dropFieldBefore(field.id)"
    >
      <div class="field-row-full" style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px">
        <span class="field-row-drag-handle" title="拖拽排序">
          <GripVertical :size="16" :stroke-width="2" />
        </span>
        <strong style="font-size: 13px; color: #475569">字段 {{ index + 1 }}</strong>
      </div>
      <n-form-item label="名称" :show-feedback="false">
        <n-input v-model:value="field.label" />
      </n-form-item>
      <n-form-item label="Key" :show-feedback="false">
        <n-input v-model:value="field.key" />
      </n-form-item>
      <n-form-item label="类型" :show-feedback="false">
        <n-select v-model:value="field.type" :options="fieldTypeOptions" />
      </n-form-item>
      <n-form-item label="占位文本" :show-feedback="false">
        <n-input v-model:value="field.placeholder" />
      </n-form-item>
      <div class="field-row-full" style="display: flex; align-items: center; justify-content: space-between; gap: 12px">
        <n-space align="center" :size="12">
          <n-space align="center" :size="6"><n-switch v-model:value="field.required" size="small" /><span style="font-size: 13px">必填</span></n-space>
          <n-button size="tiny" :disabled="index === 0" @click="moveField(field.id, -1)">
            <template #icon><ChevronUp :size="12" /></template>
          </n-button>
          <n-button size="tiny" :disabled="index === fieldDrafts.length - 1" @click="moveField(field.id, 1)">
            <template #icon><ChevronDown :size="12" /></template>
          </n-button>
        </n-space>
        <n-button size="small" type="error" @click="removeField(field)">
          <template #icon><Trash2 :size="14" /></template>
          移除
        </n-button>
      </div>
      <n-form-item label="选项（每行一个）" :show-feedback="false" class="field-row-full">
        <n-input type="textarea" :value="fieldOptions(field).join('\n')" :rows="2" @blur="(e: FocusEvent) => updateFieldOptions(field, (e.target as HTMLTextAreaElement).value)" />
      </n-form-item>
    </div>

    <n-card title="添加新字段" size="small" style="border-style: dashed">
      <div class="field-row" style="border: none; padding: 0">
        <n-form-item label="名称" :show-feedback="false">
          <n-input v-model:value="newField.label" />
        </n-form-item>
        <n-form-item label="Key（可留空）" :show-feedback="false">
          <n-input v-model:value="newField.key" />
        </n-form-item>
        <n-form-item label="类型" :show-feedback="false">
          <n-select v-model:value="newField.type" :options="fieldTypeOptions" />
        </n-form-item>
        <n-form-item label="占位文本" :show-feedback="false">
          <n-input v-model:value="newField.placeholder" />
        </n-form-item>
        <div class="field-row-full">
          <n-space align="center" :size="6"><n-switch v-model:value="newField.required" size="small" /><span style="font-size: 13px">必填</span></n-space>
        </div>
        <n-form-item label="选项（每行一个）" :show-feedback="false" class="field-row-full">
          <n-input v-model:value="newField.optionsText" type="textarea" :rows="2" />
        </n-form-item>
      </div>
      <n-button type="primary" block style="margin-top: 12px" @click="addField">添加字段</n-button>
    </n-card>
  </n-space>
</template>
