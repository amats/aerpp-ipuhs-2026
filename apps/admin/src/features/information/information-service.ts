import "server-only"
import { createInformationRepository } from "@aerpp/firestore/information"
import { firestore } from "@/lib/firestore"
export function informationRepository() {
  return createInformationRepository(firestore)
}
