import { requireAdminSession } from "@/lib/auth"
import { logInformationFailure } from "@/lib/logger"
import InformationManager from "./information-manager"
import { informationRepository } from "./information-service"

export default async function Information() {
  await requireAdminSession("/information")
  try {
    const records = await informationRepository().list()
    return (
      <InformationManager records={records} now={new Date().toISOString()} />
    )
  } catch (error) {
    logInformationFailure("listInformation", error)
    return <InformationManager records={null} now={new Date().toISOString()} />
  }
}
