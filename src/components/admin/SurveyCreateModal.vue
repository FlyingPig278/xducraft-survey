<script setup lang="ts">
import { NModal, NForm, NFormItem, NInput, NInputNumber, NSelect, NSpace, NSwitch, NButton, NDatePicker } from 'naive-ui'
import { useAdminSurvey } from '../../composables/useAdminSurvey'

const { surveyDraft, surveyCreateModalOpen, createSurvey } = useAdminSurvey()

const voteModeOptions = [{ label: '单选', value: 'single' }, { label: '多选', value: 'multiple' }]
const resultVisibilityOptions = [
  { label: '投票前后均显示', value: 'always' },
  { label: '投票后显示', value: 'after_vote' },
  { label: '不对玩家显示', value: 'hidden' }
]
const guideTextPlaceholder = [
  '普通段落会保留换行。',
  '',
  '> [!WARNING]',
  '> 这里可以写注意事项。'
].join('\n')
</script>

<template>
  <n-modal
    v-model:show="surveyCreateModalOpen"
    preset="card"
    title="新建问卷"
    style="width: 560px; max-width: 95vw"
    :bordered="true"
  >
    <n-form label-placement="top" :show-feedback="false">
      <n-form-item label="标题">
        <n-input v-model:value="surveyDraft.title" placeholder="例如 夏季服务器方案投票" />
      </n-form-item>
      <n-form-item label="说明">
        <n-input v-model:value="surveyDraft.description" type="textarea" :rows="2" placeholder="请选择你愿意参与的服务器方案。" />
      </n-form-item>
      <n-form-item label="答题指引（支持 Markdown）">
        <n-input
          v-model:value="surveyDraft.guideText"
          type="textarea"
          :rows="5"
          :autosize="{ minRows: 4, maxRows: 10 }"
          :placeholder="guideTextPlaceholder"
        />
      </n-form-item>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
        <n-form-item label="开始时间">
          <n-date-picker v-model:value="surveyDraft.startsAt" type="datetime" clearable style="width: 100%" />
        </n-form-item>
        <n-form-item label="结束时间">
          <n-date-picker v-model:value="surveyDraft.endsAt" type="datetime" clearable style="width: 100%" />
        </n-form-item>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
        <n-form-item label="模式">
          <n-select v-model:value="surveyDraft.voteMode" :options="voteModeOptions" />
        </n-form-item>
        <n-form-item label="最多项数">
          <n-input-number v-model:value="surveyDraft.maxVotes" :min="1" style="width: 100%" />
        </n-form-item>
      </div>
      <n-form-item label="票数显示">
        <n-select v-model:value="surveyDraft.resultVisibility" :options="resultVisibilityOptions" />
      </n-form-item>
      <n-space vertical :size="10" style="margin: 4px 0 16px">
        <n-space align="center" :size="8"><n-switch v-model:value="surveyDraft.requireLogin" size="small" /><span>强制要求登录</span></n-space>
        <n-space align="center" :size="8"><n-switch v-model:value="surveyDraft.allowVoteEdits" size="small" /><span>允许投票后修改</span></n-space>
        <n-space align="center" :size="8"><n-switch v-model:value="surveyDraft.candidateSubmissionEnabled" size="small" /><span>开放自定义候选项</span></n-space>
        <n-space align="center" :size="8"><n-switch v-model:value="surveyDraft.candidateSubmissionRequiresReview" size="small" /><span>候选项需要审核</span></n-space>
        <n-space align="center" :size="8"><n-switch v-model:value="surveyDraft.cloneCurrentFields" size="small" /><span>克隆当前问卷字段</span></n-space>
      </n-space>
      <n-button type="primary" block @click="createSurvey">创建并配置字段</n-button>
    </n-form>
  </n-modal>
</template>
