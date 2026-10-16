import { env } from "@aerpp/config/server/web"
import HomeFlow from "@/features/home-flow/home-flow"
import StepProgress from "@/features/home-flow/step-progress"
import { surveyQuestionSets } from "@/features/survey/survey-question-sets"

export default function Home() {
  return (
    <>
      <StepProgress />
      <HomeFlow
        supportContactEmail={env.supportContactEmail}
        authenticationEmailSender={env.authenticationEmailSender}
        initialSurveyQuestionSet={surveyQuestionSets.initialSurveyQuestionSet}
        followUpSurveyQuestionSet={surveyQuestionSets.followUpSurveyQuestionSet}
      />
    </>
  )
}
