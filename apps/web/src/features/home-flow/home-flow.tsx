"use client"

import { useEffect, useRef } from "react"
import { useAppContext } from "@/features/app-context/app-context-provider"
import { RootStep } from "@/features/app-context/root-step-types"
import SectionDocument from "@/features/document/section-document"
import SectionAuth from "@/features/home-flow/section-auth"
import SectionConsent from "@/features/home-flow/section-consent"
import SectionExplanation from "@/features/home-flow/section-explanation"
import SectionResult from "@/features/home-flow/section-result"
import SectionStart from "@/features/home-flow/section-start"
import SectionThanks from "@/features/home-flow/section-thanks"
import SectionWithdrawn from "@/features/home-flow/section-withdrawn"
import SectionSurvey from "@/features/survey/section-survey"
import type { SurveyQuestionSet } from "@/features/survey/survey-question-types"

export default function HomeFlow({
  supportContactEmail,
  authenticationEmailSender,
  initialSurveyQuestionSet,
  followUpSurveyQuestionSet,
}: {
  supportContactEmail: string
  authenticationEmailSender?: string
  initialSurveyQuestionSet: SurveyQuestionSet
  followUpSurveyQuestionSet: SurveyQuestionSet
}) {
  const { rootStep } = useAppContext()
  const contentRef = useRef<HTMLDivElement | null>(null)
  const previousStepRef = useRef(rootStep)

  useEffect(() => {
    if (previousStepRef.current === rootStep) return
    previousStepRef.current = rootStep

    switch (rootStep) {
      case RootStep.start:
      case RootStep.explanation:
      case RootStep.consent:
      case RootStep.auth:
      case RootStep.document:
      case RootStep.result:
      case RootStep.survey:
      case RootStep.thanks:
      case RootStep.withdrawn:
        window.scrollTo({ top: 0, left: 0, behavior: "instant" })
        break
    }

    const frame = window.requestAnimationFrame(() => {
      const heading = contentRef.current?.querySelector("h2")
      if (heading instanceof HTMLElement) {
        heading.focus()
      }
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [rootStep])

  return (
    <div className="flex flex-col">
      <div ref={contentRef}>
        {rootStep === RootStep.start && <SectionStart />}
        {rootStep === RootStep.explanation && <SectionExplanation />}
        {rootStep === RootStep.consent && <SectionConsent />}
        {rootStep === RootStep.auth && (
          <SectionAuth authenticationEmailSender={authenticationEmailSender} />
        )}
        {rootStep === RootStep.document && <SectionDocument />}
        {rootStep === RootStep.result && <SectionResult />}
        {rootStep === RootStep.survey && (
          <SectionSurvey
            initialSurveyQuestionSet={initialSurveyQuestionSet}
            followUpSurveyQuestionSet={followUpSurveyQuestionSet}
          />
        )}
        {rootStep === RootStep.thanks && <SectionThanks />}
        {rootStep === RootStep.withdrawn && (
          <SectionWithdrawn contactEmail={supportContactEmail} />
        )}
      </div>
    </div>
  )
}
