<script setup lang="ts">
import { NModal, NInput, NButton, NSpace } from 'naive-ui'
import { User } from '../../icons'
import { useAuth } from '../../composables/useAuth'

const { guestDraft, guestNameModalOpen, confirmGuestName, cancelGuestName } = useAuth()

const handleConfirm = () => {
  if (!guestDraft.gameId.trim()) return
  confirmGuestName()
}
</script>

<template>
  <n-modal
    v-model:show="guestNameModalOpen"
    preset="card"
    title="填写游戏昵称"
    style="width: 400px; max-width: 95vw"
    :bordered="true"
    :mask-closable="false"
  >
    <div style="display: flex; flex-direction: column; gap: 12px">
      <div style="display: flex; align-items: center; gap: 8px; color: #64748b; font-size: 14px; line-height: 1.6">
        <User :size="16" :stroke-width="2" style="flex-shrink: 0; color: #6366f1" />
        <span>请输入你的游戏昵称，方便我们记录你的选择。</span>
      </div>
      <n-input
        v-model:value="guestDraft.gameId"
        placeholder="例如 Steve"
        size="large"
        @keydown.enter="handleConfirm"
      />
      <n-space justify="end" :size="8">
        <n-button @click="cancelGuestName">取消</n-button>
        <n-button type="primary" :disabled="!guestDraft.gameId.trim()" @click="handleConfirm">
          确认并继续
        </n-button>
      </n-space>
    </div>
  </n-modal>
</template>
