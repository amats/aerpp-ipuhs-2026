import {
  handleAnalysisJobRead,
  handleAnalysisResultAcknowledgement,
} from "@/features/llm/analysis-job-route"

export async function GET(request: Request) {
  return handleAnalysisJobRead(request, true)
}

export async function DELETE(request: Request) {
  return handleAnalysisResultAcknowledgement(request)
}
