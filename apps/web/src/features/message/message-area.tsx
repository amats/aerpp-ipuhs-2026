"use client"

import InformationMessageList from "./information-message-list"
import StatusMessageAlert from "./status-message-alert"

export default function MessageArea() {
  return (
    <div className="mx-auto flex w-full flex-col gap-3 empty:hidden">
      <StatusMessageAlert />
      <InformationMessageList />
    </div>
  )
}
