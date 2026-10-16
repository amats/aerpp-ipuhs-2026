export function isRejectedSessionState(reason: unknown) {
  return (
    typeof reason === "string" &&
    [
      "stale_session_state",
      "session_invalid",
      "session_snapshot_unavailable",
      "browser_context_invalid",
      "analysis_mismatch",
      "stage_mismatch",
      "step_mismatch",
    ].includes(reason)
  )
}
