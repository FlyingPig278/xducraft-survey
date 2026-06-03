<script setup lang="ts">
import { computed } from 'vue'
import { NAlert, NButton, NCard, NForm, NFormItem, NInput } from 'naive-ui'
import {
  ClipboardList, Eye, Settings2, CheckSquare, Archive,
  LogOut
} from '../../icons'
import { useAppState } from '../../composables/useAppState'
import { useAuth } from '../../composables/useAuth'
import { useRouter, type AdminPanelKey } from '../../composables/useRouter'
import { useAdminCandidates } from '../../composables/useAdminCandidates'
import { publicSurveyUrlFor } from '../../composables/useRouter'
import SurveyPanel from './SurveyPanel.vue'
import SurveyCreateModal from './SurveyCreateModal.vue'
import PreviewPanel from './PreviewPanel.vue'
import FieldsPanel from './FieldsPanel.vue'
import CandidatesPanel from './CandidatesPanel.vue'
import ArchivePanel from './ArchivePanel.vue'

const { apiLoading, apiError, adminSurveyId } = useAppState()
const { currentUser, loginDraft, isAdmin, loginAs, logout } = useAuth()
const { adminPanel, navigateAdmin } = useRouter()
const { pendingCandidateCount } = useAdminCandidates()

const adminPanels: Array<{ key: AdminPanelKey; label: string; icon: any }> = [
  { key: 'surveys', label: '问卷管理', icon: ClipboardList },
  { key: 'preview', label: '发布预览', icon: Eye },
  { key: 'fields', label: '字段配置', icon: Settings2 },
  { key: 'candidates', label: '候选审核', icon: CheckSquare },
  { key: 'archive', label: '数据留档', icon: Archive }
]

const navigatePanel = (panel: AdminPanelKey) => {
  navigateAdmin(panel, adminSurveyId.value)
}

const openPublicSurvey = () => {
  window.open(publicSurveyUrlFor(adminSurveyId.value), '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <main class="admin-shell">
    <!-- Desktop sidebar -->
    <aside class="admin-sidebar">
      <div class="admin-sidebar-brand">
        <strong>XDUCraft Survey</strong>
        <span>管理后台</span>
      </div>
      <nav>
        <button
          v-for="panel in adminPanels"
          :key="panel.key"
          class="admin-nav-btn"
          :class="{ active: adminPanel === panel.key }"
          @click="navigatePanel(panel.key)"
        >
          <component :is="panel.icon" :size="16" :stroke-width="2" />
          <span class="nav-label">{{ panel.label }}</span>
          <span v-if="panel.key === 'candidates' && pendingCandidateCount" class="admin-nav-badge">{{ pendingCandidateCount }}</span>
        </button>
      </nav>
      <div class="admin-sidebar-footer">
        <div v-if="currentUser" class="admin-sidebar-user">
          <strong>{{ currentUser.displayName }}</strong>
          <n-button size="tiny" quaternary style="color: #64748b; margin-left: auto" @click="logout">
            <template #icon><LogOut :size="12" /></template>
          </n-button>
        </div>
        <n-button block quaternary size="small" @click="openPublicSurvey" style="color: #94a3b8">
          新窗口打开问卷
        </n-button>
      </div>
    </aside>

    <!-- Mobile bottom tab bar -->
    <nav class="admin-mobile-nav">
      <button
        v-for="panel in adminPanels"
        :key="panel.key"
        class="admin-mobile-nav-btn"
        :class="{ active: adminPanel === panel.key }"
        @click="navigatePanel(panel.key)"
      >
        <component :is="panel.icon" :size="20" :stroke-width="2" />
        <span>{{ panel.label }}</span>
        <span v-if="panel.key === 'candidates' && pendingCandidateCount" class="mobile-badge">{{ pendingCandidateCount }}</span>
      </button>
    </nav>

    <section class="admin-main">
      <n-alert v-if="apiError" type="error" :bordered="false" style="margin-bottom: 16px">
        API 连接失败：{{ apiError }}
      </n-alert>
      <n-alert v-else-if="apiLoading" type="info" :bordered="false" style="margin-bottom: 16px">
        正在同步后台数据...
      </n-alert>

      <!-- Admin login -->
      <div v-if="!isAdmin" class="admin-content" style="max-width: 440px">
        <n-card title="管理员登录">
          <p style="color: #64748b; margin: 0 0 20px">当前为 mock OAuth 身份。正式版本会替换为 Blessing Skin OAuth2。</p>
          <n-form label-placement="top" :show-feedback="false">
            <n-form-item label="显示名">
              <n-input v-model:value="loginDraft.displayName" />
            </n-form-item>
            <n-form-item label="游戏 ID">
              <n-input v-model:value="loginDraft.gameId" />
            </n-form-item>
            <n-button type="primary" block @click="loginAs('admin')" style="margin-top: 8px">进入后台</n-button>
          </n-form>
        </n-card>
      </div>

      <div v-else class="admin-content">
        <SurveyPanel v-if="adminPanel === 'surveys'" />
        <PreviewPanel v-else-if="adminPanel === 'preview'" />
        <FieldsPanel v-else-if="adminPanel === 'fields'" />
        <CandidatesPanel v-else-if="adminPanel === 'candidates'" />
        <ArchivePanel v-else-if="adminPanel === 'archive'" />
      </div>
    </section>

    <SurveyCreateModal />
  </main>
</template>
