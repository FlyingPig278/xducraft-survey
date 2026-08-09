<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import QRCode from 'qrcode'
import { NAlert, NButton, NCard, NDatePicker, NForm, NFormItem, NInput, NInputNumber, NRadioButton, NRadioGroup, NSelect, NSpace, NSwitch, NTag } from 'naive-ui'
import { Copy, Download, Eye, Save, Settings2 } from '../../icons'
import { useAppState } from '../../composables/useAppState'
import { useAdminSurvey } from '../../composables/useAdminSurvey'
import { navigateAdmin, publicSurveyUrlFor } from '../../composables/useRouter'

type PosterMode = 'mobile' | 'desktop'
type WallpaperKey = 'bedrock' | 'java' | 'bundle'

const { survey, adminSurveyId, surveys, message } = useAppState()
const {
  surveySettingsDraft,
  surveySettingsDirty,
  surveyHasVotes,
  saveSurveySettings
} = useAdminSurvey()

const surveySelectOptions = computed(() => surveys.value.map((s) => ({ label: s.title, value: s.id })))
const hasSurveys = computed(() => surveys.value.length > 0)
const voteModeOptions = [{ label: '单选', value: 'single' }, { label: '多选', value: 'multiple' }]
const statusOptions = [{ label: '草稿', value: 'draft' }, { label: '开放', value: 'open' }, { label: '已关闭', value: 'closed' }]
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

const wallpaperOptions: Array<{ label: string; value: WallpaperKey; desktop: string; mobile: string }> = [
  {
    label: 'Bedrock',
    value: 'bedrock',
    desktop: '/wallpapers/wallpaper_minecraft_bedrock_edition_1920x1080.png',
    mobile: '/wallpapers/wallpaper_minecraft_bedrock_edition_1080x1920.png'
  },
  {
    label: 'Java',
    value: 'java',
    desktop: '/wallpapers/wallpaper_minecraft_java_edition_1920x1080.png',
    mobile: '/wallpapers/wallpaper_minecraft_java_edition_1080x1920.png'
  },
  {
    label: 'PC Bundle',
    value: 'bundle',
    desktop: '/wallpapers/wallpaper_minecraft_pc_bundle_1920x1080.png',
    mobile: '/wallpapers/wallpaper_minecraft_pc_bundle_1080x1920.png'
  }
]

const posterMode = ref<PosterMode>('mobile')
const wallpaperKey = ref<WallpaperKey>('bedrock')

const publicSurveyUrl = computed(() => publicSurveyUrlFor(survey.value.id))
const publicSurveyQrUrl = ref('')
let qrGeneration = 0
watch(publicSurveyUrl, async (url) => {
  const generation = ++qrGeneration
  try {
    const dataUrl = await QRCode.toDataURL(url, { width: 520, margin: 1, errorCorrectionLevel: 'M' })
    if (generation === qrGeneration) publicSurveyQrUrl.value = dataUrl
  } catch {
    if (generation === qrGeneration) publicSurveyQrUrl.value = ''
  }
}, { immediate: true })
const selectedWallpaper = computed(() => wallpaperOptions.find((item) => item.value === wallpaperKey.value) ?? wallpaperOptions[0])
const posterBackground = computed(() => posterMode.value === 'mobile' ? selectedWallpaper.value.mobile : selectedWallpaper.value.desktop)
const posterModeOptions = [
  { label: '手机竖版', value: 'mobile' },
  { label: '电脑横版', value: 'desktop' }
]

const copyPublicLink = async () => {
  try {
    await navigator.clipboard.writeText(publicSurveyUrl.value)
    message.success('已复制公开链接')
  } catch {
    message.warning('复制失败，请手动复制链接。')
  }
}

const openPublicPreview = async () => {
  if (surveySettingsDirty.value && !await saveSurveySettings('问卷设置已保存')) return
  window.open(publicSurveyUrl.value, '_blank', 'noopener,noreferrer')
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => resolve(img)
  img.onerror = reject
  img.src = src
})

const drawCoverImage = (ctx: CanvasRenderingContext2D, img: HTMLImageElement, width: number, height: number) => {
  const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight)
  const sw = width / scale
  const sh = height / scale
  const sx = (img.naturalWidth - sw) / 2
  const sy = (img.naturalHeight - sh) / 2
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height)
}

const wrappedLines = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) => {
  const words = text.trim().split('')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const testLine = `${line}${word}`
    if (ctx.measureText(testLine).width > maxWidth && line) {
      lines.push(line)
      line = word
      if (lines.length >= maxLines) break
    } else {
      line = testLine
    }
  }
  if (line && lines.length < maxLines) lines.push(line)
  if (lines.length === maxLines && words.join('').length > lines.join('').length) {
    const last = lines[lines.length - 1]
    let clipped = last
    while (clipped && ctx.measureText(`${clipped}...`).width > maxWidth) clipped = clipped.slice(0, -1)
    lines[lines.length - 1] = `${clipped || last.slice(0, 1)}...`
  }
  return lines
}

const drawTextLines = (ctx: CanvasRenderingContext2D, lines: string[], x: number, y: number, lineHeight: number) => {
  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight)
  })
}

const downloadPoster = async () => {
  const isMobile = posterMode.value === 'mobile'
  const width = isMobile ? 1080 : 1600
  const height = isMobile ? 1350 : 900
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  if (!publicSurveyQrUrl.value) {
    message.error('二维码尚未生成，请稍后重试。')
    return
  }

  try {
    const [bg, qr] = await Promise.all([
      loadImage(posterBackground.value),
      loadImage(publicSurveyQrUrl.value)
    ])
    drawCoverImage(ctx, bg, width, height)

    const gradient = ctx.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, 'rgba(7, 15, 35, 0.82)')
    gradient.addColorStop(0.56, 'rgba(7, 15, 35, 0.28)')
    gradient.addColorStop(1, 'rgba(7, 15, 35, 0.76)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    const baseWidth = isMobile ? 340 : 680
    const scale = width / baseWidth
    const padding = (isMobile ? 26 : 34) * scale
    const columnGap = 18 * scale
    const textGap = 10 * scale
    const brandSize = 12 * scale
    const titleSize = (isMobile ? 27 : 34) * scale
    const descriptionSize = 14 * scale
    const copyMaxWidth = isMobile ? width - padding * 2 : width - padding * 2 - (132 + 28) * scale - columnGap
    const titleMaxWidth = Math.min(titleSize * 12, copyMaxWidth)
    const descriptionMaxWidth = Math.min(descriptionSize * 28, copyMaxWidth)

    ctx.font = `700 ${titleSize}px sans-serif`
    const titleLines = wrappedLines(ctx, survey.value.title, titleMaxWidth, 3)
    ctx.font = `400 ${descriptionSize}px sans-serif`
    const descriptionLines = wrappedLines(ctx, survey.value.description || '扫码参与问卷投票', descriptionMaxWidth, 2)
    const brandLineHeight = brandSize * 1.25
    const titleLineHeight = titleSize * 1.12
    const descriptionLineHeight = descriptionSize * 1.5
    const copyHeight = brandLineHeight + textGap + titleLines.length * titleLineHeight + textGap + descriptionLines.length * descriptionLineHeight
    const copyX = padding
    const copyY = isMobile ? padding : height - padding - copyHeight

    ctx.fillStyle = 'rgba(255, 255, 255, 0.78)'
    ctx.font = `700 ${brandSize}px sans-serif`
    ctx.fillText('XDUCraft Vote', copyX, copyY)

    ctx.fillStyle = '#ffffff'
    ctx.font = `700 ${titleSize}px sans-serif`
    drawTextLines(ctx, titleLines, copyX, copyY + brandLineHeight + textGap, titleLineHeight)

    ctx.fillStyle = 'rgba(255, 255, 255, 0.84)'
    ctx.font = `400 ${descriptionSize}px sans-serif`
    drawTextLines(
      ctx,
      descriptionLines,
      copyX,
      copyY + brandLineHeight + textGap + titleLines.length * titleLineHeight + textGap,
      descriptionLineHeight
    )

    const qrSize = 132 * scale
    const qrPadding = 14 * scale
    const qrGap = 8 * scale
    const qrTextSize = 12 * scale
    const qrTextHeight = qrTextSize * 1.35
    const qrCardWidth = qrSize + qrPadding * 2
    const qrCardHeight = qrPadding + qrSize + qrGap + qrTextHeight + qrPadding
    const qrCardX = isMobile ? (width - qrCardWidth) / 2 : width - padding - qrCardWidth
    const qrCardY = height - padding - qrCardHeight
    ctx.fillStyle = '#ffffff'
    ctx.globalAlpha = 0.96
    ctx.roundRect(qrCardX, qrCardY, qrCardWidth, qrCardHeight, 14 * scale)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.drawImage(qr, qrCardX + qrPadding, qrCardY + qrPadding, qrSize, qrSize)
    ctx.font = `700 ${qrTextSize}px sans-serif`
    ctx.fillStyle = '#0f172a'
    ctx.textAlign = 'center'
    ctx.fillText('扫码参与投票', qrCardX + qrCardWidth / 2, qrCardY + qrPadding + qrSize + qrGap)

    const link = document.createElement('a')
    link.download = `${survey.value.title}-${isMobile ? '手机海报' : '电脑海报'}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  } catch {
    message.error('海报生成失败，请稍后重试。')
  }
}
</script>

<template>
  <div class="admin-section-header">
    <div>
      <h1>问卷设置</h1>
      <p>配置当前问卷规则、发布状态和传播物料。</p>
    </div>
  </div>

  <n-alert v-if="!hasSurveys" type="info" :bordered="false">
    还没有问卷。请先在问卷列表中新建问卷。
  </n-alert>

  <n-card v-else size="small">
    <n-form label-placement="top" :show-feedback="false">
      <n-form-item label="选择问卷">
        <n-select v-model:value="adminSurveyId" :options="surveySelectOptions" />
      </n-form-item>
      <n-form-item label="标题">
        <n-input v-model:value="surveySettingsDraft.title" />
      </n-form-item>
      <n-form-item label="状态">
        <n-select v-model:value="surveySettingsDraft.status" :options="statusOptions" />
      </n-form-item>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
        <n-form-item label="开始时间">
          <n-date-picker
            v-model:value="surveySettingsDraft.startsAt"
            type="datetime"
            clearable
            style="width: 100%"
          />
        </n-form-item>
        <n-form-item label="结束时间">
          <n-date-picker
            v-model:value="surveySettingsDraft.endsAt"
            type="datetime"
            clearable
            style="width: 100%"
          />
        </n-form-item>
      </div>
      <n-form-item label="说明">
        <n-input v-model:value="surveySettingsDraft.description" type="textarea" :rows="2" />
      </n-form-item>
      <n-form-item label="答题指引（支持 Markdown）">
        <n-input
          v-model:value="surveySettingsDraft.guideText"
          type="textarea"
          :rows="6"
          :autosize="{ minRows: 5, maxRows: 12 }"
          :placeholder="guideTextPlaceholder"
        />
      </n-form-item>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
        <n-form-item label="模式">
          <n-select v-model:value="surveySettingsDraft.voteMode" :options="voteModeOptions" />
        </n-form-item>
        <n-form-item label="最多项数">
          <n-input-number v-model:value="surveySettingsDraft.maxVotes" :min="1" style="width: 100%" />
        </n-form-item>
      </div>
      <n-form-item label="票数显示">
        <n-select v-model:value="surveySettingsDraft.resultVisibility" :options="resultVisibilityOptions" />
      </n-form-item>
      <n-space vertical :size="10" style="margin: 4px 0 16px">
        <n-space align="center" :size="8"><n-switch v-model:value="surveySettingsDraft.requireLogin" size="small" /><span>强制要求登录</span></n-space>
        <n-space align="center" :size="8"><n-switch v-model:value="surveySettingsDraft.allowVoteEdits" size="small" /><span>允许投票后修改</span></n-space>
        <n-space align="center" :size="8"><n-switch v-model:value="surveySettingsDraft.candidateSubmissionEnabled" size="small" /><span>开放自定义候选项</span></n-space>
        <n-space align="center" :size="8"><n-switch v-model:value="surveySettingsDraft.candidateSubmissionRequiresReview" size="small" /><span>候选项需要审核</span></n-space>
      </n-space>

      <n-alert v-if="surveyHasVotes" type="info" :bordered="false" style="margin-bottom: 16px">
        该问卷已有投票。切换单选/多选或调整上限不会改写历史记录；之后的新投票和主动修改按新规则校验。
      </n-alert>

      <n-space justify="space-between" align="center" style="margin-bottom: 16px">
        <n-tag :type="surveySettingsDirty ? 'warning' : 'success'" :bordered="false">
          {{ surveySettingsDirty ? '有未保存设置' : '设置已保存' }}
        </n-tag>
        <n-space :size="8">
          <n-button @click="navigateAdmin('fields', adminSurveyId)">
            <template #icon><Settings2 :size="14" /></template>
            配置字段
          </n-button>
          <n-button @click="openPublicPreview">
            <template #icon><Eye :size="14" /></template>
            打开问卷
          </n-button>
          <n-button type="primary" :disabled="!surveySettingsDirty" @click="saveSurveySettings()">
            <template #icon><Save :size="14" /></template>
            保存设置
          </n-button>
        </n-space>
      </n-space>

      <div class="share-section poster-share-section">
        <div class="poster-share-toolbar">
          <div>
            <strong>传播海报</strong>
            <code>{{ publicSurveyUrl }}</code>
          </div>
          <n-space :size="8">
            <n-button size="small" @click="copyPublicLink">
              <template #icon><Copy :size="14" /></template>
              复制链接
            </n-button>
            <n-button size="small" type="primary" @click="downloadPoster">
              <template #icon><Download :size="14" /></template>
              下载海报
            </n-button>
          </n-space>
        </div>

        <div class="poster-controls">
          <n-radio-group v-model:value="posterMode" size="small">
            <n-radio-button v-for="item in posterModeOptions" :key="item.value" :value="item.value">
              {{ item.label }}
            </n-radio-button>
          </n-radio-group>
          <n-radio-group v-model:value="wallpaperKey" size="small">
            <n-radio-button v-for="item in wallpaperOptions" :key="item.value" :value="item.value">
              {{ item.label }}
            </n-radio-button>
          </n-radio-group>
        </div>

        <div class="poster-preview-wrap">
          <div class="poster-card" :class="posterMode" :style="{ backgroundImage: `url(${posterBackground})` }">
            <div class="poster-card-overlay">
              <div class="poster-card-copy">
                <span>XDUCraft Vote</span>
                <strong>{{ survey.title }}</strong>
                <small>{{ survey.description || '扫码参与问卷投票' }}</small>
              </div>
              <div class="poster-card-qr">
                <img v-if="publicSurveyQrUrl" :src="publicSurveyQrUrl" alt="问卷二维码" />
                <span>扫码参与投票</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </n-form>
  </n-card>
</template>
