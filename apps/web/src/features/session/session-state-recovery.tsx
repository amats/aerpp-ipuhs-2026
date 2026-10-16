import AlertMessage from "@/ui/alert-message"
import ReloadPageButton from "./reload-page-button"
import {
  SESSION_RELOAD_MESSAGE,
  SESSION_RELOAD_NOTICE,
} from "./session-recovery"

export default function SessionStateRecovery() {
  return (
    <AlertMessage tone="error">
      <p>{SESSION_RELOAD_MESSAGE}</p>
      <p>{SESSION_RELOAD_NOTICE}</p>
      <ReloadPageButton />
    </AlertMessage>
  )
}
