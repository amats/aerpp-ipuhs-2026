"use client"

import { useEffect, useState } from "react"
import { EMAIL_REGEXP } from "@/features/auth/email-regexp"

// Debounces email validation so typing does not show flickering errors.
export function useDebouncedEmailValidation({
  email,
  invalidMessage,
  debounceMs = 300,
}: {
  email: string
  invalidMessage: string
  debounceMs?: number
}): {
  emailError: string | null
  isValidationPending: boolean
} {
  const [validatedEmail, setValidatedEmail] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [isValidationPending, setIsValidationPending] = useState(false)

  useEffect(() => {
    const trimmedEmail = email.trim()
    if (trimmedEmail === "") {
      setEmailError(null)
      setIsValidationPending(false)
      return
    }

    setIsValidationPending(true)
    const timeoutId = window.setTimeout(() => {
      setEmailError(EMAIL_REGEXP.test(trimmedEmail) ? null : invalidMessage)
      setValidatedEmail(email)
      setIsValidationPending(false)
    }, debounceMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [debounceMs, email, invalidMessage])

  return {
    emailError,
    isValidationPending:
      email.trim() !== "" && (validatedEmail !== email || isValidationPending),
  }
}
