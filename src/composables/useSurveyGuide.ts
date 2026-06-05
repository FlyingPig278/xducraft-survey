import { computed } from 'vue'
import { useAppState } from './useAppState'
import { DEFAULT_GUIDE_TEXT, LEGACY_GUIDE_TEXT } from '../constants/surveyDefaults'

export function useSurveyGuide() {
  const { survey } = useAppState()

  const surveyGuideText = computed(() => {
    const text = survey.value.guideText?.trim()
    return !text || text === LEGACY_GUIDE_TEXT ? DEFAULT_GUIDE_TEXT : text
  })

  return { surveyGuideText }
}
