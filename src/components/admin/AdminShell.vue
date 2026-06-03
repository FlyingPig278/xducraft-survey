<script setup lang="ts">
import { NAlert, NButton, NCard } from 'naive-ui'
import {
  ClipboardList, Settings2, CheckSquare, Archive, GripVertical,
  LogIn, LogOut
} from '../../icons'
import { useAppState } from '../../composables/useAppState'
import { useAuth } from '../../composables/useAuth'
import { useRouter, type AdminPanelKey } from '../../composables/useRouter'
import { useAdminCandidates } from '../../composables/useAdminCandidates'
import { publicSurveyUrlFor } from '../../composables/useRouter'
import SurveyPanel from './SurveyPanel.vue'
import SurveyCreateModal from './SurveyCreateModal.vue'
import SurveySettingsPanel from './SurveySettingsPanel.vue'
import FieldsPanel from './FieldsPanel.vue'
import CandidatesPanel from './CandidatesPanel.vue'
import ArchivePanel from './ArchivePanel.vue'

const { apiLoading, apiError, adminSurveyId } = useAppState()
const { currentUser, isAdmin, startOAuthLogin, logout } = useAuth()
const { adminPanel, navigateAdmin } = useRouter()
const { pendingCandidateCount } = useAdminCandidates()

const adminPanels: Array<{ key: AdminPanelKey; label: string; icon: any }> = [
  { key: 'surveys', label: '问卷列表', icon: ClipboardList },
  { key: 'settings', label: '问卷设置', icon: Settings2 },
  { key: 'fields', label: '字段配置', icon: GripVertical },
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
  <main class="admin-shell" :class="{ 'admin-shell-locked': !isAdmin }">
    <!-- Desktop sidebar -->
    <aside v-if="isAdmin" class="admin-sidebar">
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
    <nav v-if="isAdmin" class="admin-mobile-nav">
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

      <div v-if="!isAdmin" class="admin-login-panel">
        <n-card title="管理员登录" size="large">
          <n-alert v-if="currentUser" type="warning" :bordered="false" style="margin-bottom: 16px">
            当前账号「{{ currentUser.displayName }}」已登录，但没有管理员权限。请确认管理员白名单是否包含该账号的 uid、邮箱、昵称或游戏名。
          </n-alert>
          <p class="admin-login-copy">
            后台仅允许 XDUCraft 皮肤站管理员白名单账号进入。
          </p>
          <n-button type="primary" block @click="startOAuthLogin('admin')">
            <template #icon><LogIn :size="15" /></template>
            使用 XDUCraft 皮肤站登录
          </n-button>
          <n-button v-if="currentUser" block quaternary style="margin-top: 10px" @click="logout">
            <template #icon><LogOut :size="15" /></template>
            退出当前账号
          </n-button>
        </n-card>
      </div>

      <div v-else class="admin-content">
        <SurveyPanel v-if="adminPanel === 'surveys'" />
        <SurveySettingsPanel v-else-if="adminPanel === 'settings'" />
        <FieldsPanel v-else-if="adminPanel === 'fields'" />
        <CandidatesPanel v-else-if="adminPanel === 'candidates'" />
        <ArchivePanel v-else-if="adminPanel === 'archive'" />
      </div>
    </section>

    <SurveyCreateModal v-if="isAdmin" />
  </main>
</template>
