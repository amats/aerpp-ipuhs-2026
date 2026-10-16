import "server-only"

import { Firestore } from "@google-cloud/firestore"
import { googleClientOptions } from "@/lib/google-auth"

export const firestore = new Firestore(googleClientOptions)
