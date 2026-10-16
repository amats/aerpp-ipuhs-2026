"use client"

import {
  type KeyboardEventHandler,
  type SetStateAction,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react"
import { useAppContext } from "@/features/app-context/app-context-provider"
import { useMessageContext } from "@/features/message/message-context-provider"
import { getSessionFailureStatus } from "@/features/session/session-recovery"
import type { AlertTone } from "@/ui/alert-tone"
import { DOCUMENT_CONSTRAINTS } from "./document-constraints"
import {
  countDocumentBodyGraphemes,
  getDocumentReadiness,
  restoreDocumentDraft,
} from "./document-draft"
import {
  type DocumentDraft,
  EMPTY_DOCUMENT_DRAFT,
  type UpdateDocumentDraft,
} from "./document-draft-types"
import {
  extractDocxText,
  extractPptxText,
  isDocxFile,
  isPlainTextFile,
  isPptxFile,
  validateImportFile,
} from "./document-file-extraction"
import { checkExtractedText } from "./document-import-text"

type InlineStatusMessage = {
  message: string
  tone?: AlertTone
}

const INITIAL_DOCUMENTS = EMPTY_DOCUMENT_DRAFT.documents

function useDocumentDraftField<Key extends keyof DocumentDraft>(
  draft: DocumentDraft,
  updateDraft: UpdateDocumentDraft,
  key: Key,
) {
  const setValue = useCallback(
    (value: SetStateAction<DocumentDraft[Key]>) => {
      updateDraft((current) => ({
        ...current,
        [key]: typeof value === "function" ? value(current[key]) : value,
      }))
    },
    [key, updateDraft],
  )
  return [draft[key], setValue] as const
}

export function useDocumentEditor() {
  const [_, startTransition] = useTransition()
  const { analysisJob, startAnalysis, documentDraft, updateDocumentDraft } =
    useAppContext()
  const { updateStatusMessage } = useMessageContext()
  const jobIdPrefix = useId()

  const [activeDocumentKey, setActiveDocumentKey] = useDocumentDraftField(
    documentDraft,
    updateDocumentDraft,
    "activeDocumentKey",
  )
  const [documents, setDocuments] = useDocumentDraftField(
    documentDraft,
    updateDocumentDraft,
    "documents",
  )
  const [documentNames, setDocumentNames] = useDocumentDraftField(
    documentDraft,
    updateDocumentDraft,
    "documentNames",
  )
  const nextDocumentIndexRef = useRef(2)
  const [sourceFileNames, setSourceFileNames] = useDocumentDraftField(
    documentDraft,
    updateDocumentDraft,
    "sourceFileNames",
  )
  const [statusMessages, setStatusMessages] = useState<
    Record<string, InlineStatusMessage>
  >({})
  const [isParsing, setIsParsing] = useState(false)
  const parsingInFlightRef = useRef(false)
  const importRef = useRef<{ key: string; controller: AbortController } | null>(
    null,
  )
  const screenGenerationRef = useRef(0)
  const [isStartingAnalysis, setIsStartingAnalysis] = useState(false)
  const analysisStartInFlightRef = useRef(false)
  const tabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const pendingFocusDocumentKeyRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      screenGenerationRef.current += 1
      importRef.current?.controller.abort()
    }
  }, [])

  const documentBodyGraphemeCounts = useMemo(
    () => countDocumentBodyGraphemes(documents),
    [documents],
  )
  const { totalGraphemeCount, analysisDisabledReason } = getDocumentReadiness(
    documents,
    documentNames,
    documentBodyGraphemeCounts,
  )
  const canProceed = analysisDisabledReason === null
  const documentKeys = Object.keys(documents)
  const titles = Object.fromEntries(
    documentKeys.map((key) => [
      key,
      documentNames[key]?.trim() || "無題の書類",
    ]),
  )

  const activeDocumentKeyRef = useRef(activeDocumentKey)
  activeDocumentKeyRef.current = activeDocumentKey
  const documentKeysRef = useRef(documentKeys)
  documentKeysRef.current = documentKeys

  useEffect(() => {
    if (
      !analysisJob ||
      documentDraft.restoredAnalysisJobId === analysisJob.jobId
    ) {
      return
    }

    updateDocumentDraft(() => restoreDocumentDraft(analysisJob))
    setStatusMessages({})
  }, [analysisJob, documentDraft.restoredAnalysisJobId, updateDocumentDraft])

  const addDocument = useCallback(() => {
    if (Object.keys(documents).length >= DOCUMENT_CONSTRAINTS.maxDocuments)
      return
    let index = nextDocumentIndexRef.current++
    while (`document-${index}` in documents)
      index = nextDocumentIndexRef.current++
    const newKey = `document-${index}`
    setDocuments((prev) => ({ ...prev, [newKey]: "" }))
    setDocumentNames((prev) => ({ ...prev, [newKey]: `書類${index}` }))
    pendingFocusDocumentKeyRef.current = newKey
    setActiveDocumentKey(newKey)
  }, [documents, setDocuments, setDocumentNames, setActiveDocumentKey])

  const updateDocumentName = useCallback(
    (key: string, name: string) => {
      setDocumentNames((prev) => ({
        ...prev,
        [key]: name.slice(0, DOCUMENT_CONSTRAINTS.maxDocumentNameCodeUnits),
      }))
    },
    [setDocumentNames],
  )

  const updateSourceFileName = useCallback(
    (key: string, filename: string | null) => {
      if (filename === null) {
        setSourceFileNames((prev) => {
          if (!(key in prev)) {
            return prev
          }
          const { [key]: removed, ...rest } = prev
          return rest
        })
        return
      }
      setSourceFileNames((prev) => ({ ...prev, [key]: filename }))
      updateDocumentName(key, filename)
    },
    [setSourceFileNames, updateDocumentName],
  )

  const updateDocumentStatusMessage = useCallback(
    (key: string, message: string | InlineStatusMessage | null) => {
      if (message === null) {
        setStatusMessages((prev) => {
          if (!(key in prev)) {
            return prev
          }
          const { [key]: removed, ...rest } = prev
          return rest
        })
        return
      }
      const newMessage =
        typeof message === "string"
          ? { message, tone: "info" as const }
          : message
      setStatusMessages((prev) => ({ ...prev, [key]: newMessage }))
      updateStatusMessage(newMessage)
    },
    [updateStatusMessage],
  )

  const removeDocument = useCallback(
    (key: string) => {
      if (
        documents[key] &&
        !window.confirm(
          "この書類と入力した本文を削除します。この操作は取り消せません。削除しますか？",
        )
      )
        return
      const removedTitle = titles[key] ?? "書類"
      setDocuments((prev) => {
        if (!(key in prev)) {
          return prev
        }
        if (Object.keys(prev).length > 1) {
          const { [key]: removed, ...rest } = prev
          return rest
        }
        return { ...prev, [key]: "" }
      })

      if (
        documentKeysRef.current.length > 1 &&
        activeDocumentKeyRef.current === key
      ) {
        const nextKeys = documentKeysRef.current.filter(
          (documentKey) => documentKey !== key,
        )
        const nextKey = nextKeys[0] ?? Object.keys(INITIAL_DOCUMENTS)[0]
        pendingFocusDocumentKeyRef.current = nextKey
        setActiveDocumentKey(nextKey)
      }
      updateSourceFileName(key, null)
      updateDocumentStatusMessage(key, null)
      if (documentKeysRef.current.length > 1) {
        setDocumentNames((prev) => {
          const { [key]: removed, ...rest } = prev
          return rest
        })
        updateStatusMessage({
          message: `${removedTitle} を削除しました。`,
          tone: "info",
        })
      }
    },
    [
      documents,
      titles,
      setDocuments,
      setDocumentNames,
      setActiveDocumentKey,
      updateDocumentStatusMessage,
      updateStatusMessage,
      updateSourceFileName,
    ],
  )

  const clearDocument = useCallback(
    (key: string) => {
      if (
        documents[key] &&
        !window.confirm(
          "入力した本文を消去します。この操作は取り消せません。消去しますか？",
        )
      )
        return
      setDocuments((prev) => ({ ...prev, [key]: "" }))
      updateSourceFileName(key, null)
      updateDocumentStatusMessage(key, null)
    },
    [
      documents,
      setDocuments,
      updateDocumentStatusMessage,
      updateSourceFileName,
    ],
  )

  const updateDocument = useCallback(
    (key: string, text: string) => {
      setDocuments((prev) => ({ ...prev, [key]: text }))
    },
    [setDocuments],
  )

  const cancelImport = useCallback(() => {
    const current = importRef.current
    if (!current) return
    current.controller.abort()
    importRef.current = null
    parsingInFlightRef.current = false
    setIsParsing(false)
    updateDocumentStatusMessage(
      current.key,
      "ファイルの読み込みを中止しました。",
    )
  }, [updateDocumentStatusMessage])

  const handleFiles = useCallback(
    async (key: string, files: FileList | readonly File[] | null) => {
      if (
        !files ||
        files.length === 0 ||
        parsingInFlightRef.current ||
        analysisStartInFlightRef.current
      ) {
        return
      }
      parsingInFlightRef.current = true
      const controller = new AbortController()
      importRef.current = { key, controller }
      const generation = screenGenerationRef.current
      const file = files[0]
      const lowerCaseName = file.name.toLowerCase()
      try {
        setIsParsing(true)
        validateImportFile(file)
        let text: string
        let message: string
        if (isDocxFile(file, lowerCaseName)) {
          text = await extractDocxText(file, controller.signal)
          message = "DOCXファイルを読み込みました。"
        } else if (isPptxFile(file, lowerCaseName)) {
          text = await extractPptxText(file, controller.signal)
          message = "PPTXファイルを読み込みました。"
        } else if (isPlainTextFile(file, lowerCaseName)) {
          text = checkExtractedText(await file.text())
          message = "テキストファイルを読み込みました。"
        } else {
          updateDocumentStatusMessage(key, {
            message:
              "対応していないファイル形式です。DOCX、PPTX、テキスト、またはMarkdownを選択してください。",
            tone: "error",
          })
          return
        }
        if (
          generation !== screenGenerationRef.current ||
          controller.signal.aborted === true
        )
          return
        updateDocument(key, text)
        updateSourceFileName(key, file.name)
        updateDocumentStatusMessage(key, message)
      } catch {
        if (
          generation !== screenGenerationRef.current ||
          controller.signal.aborted === true
        )
          return
        updateDocumentStatusMessage(key, {
          message:
            "ファイルを読み込めませんでした。形式・サイズ・本文の長さを確認してください。端末内で本文をテキストファイルに保存して読み込む方法もあります。",
          tone: "error",
        })
      } finally {
        if (importRef.current?.controller === controller) {
          importRef.current = null
          parsingInFlightRef.current = false
          if (generation === screenGenerationRef.current) setIsParsing(false)
        }
      }
    },
    [updateDocument, updateDocumentStatusMessage, updateSourceFileName],
  )

  const updateActiveDocumentKey = useCallback(
    (key: string) => {
      startTransition(() => {
        setActiveDocumentKey((currentKey) =>
          currentKey === key ? currentKey : key,
        )
      })
    },
    [setActiveDocumentKey],
  )

  const focusDocumentTab = useCallback((key: string) => {
    tabButtonRefs.current[key]?.focus()
  }, [])

  useEffect(() => {
    const key = pendingFocusDocumentKeyRef.current
    if (!key) {
      return
    }
    pendingFocusDocumentKeyRef.current = null
    tabButtonRefs.current[key]?.focus()
  })

  const handleTabKeyDown = useCallback(
    (currentKey: string): KeyboardEventHandler<HTMLButtonElement> =>
      (event) => {
        const currentIndex = documentKeys.indexOf(currentKey)
        if (currentIndex === -1) {
          return
        }

        let nextIndex: number | null = null

        switch (event.key) {
          case "ArrowLeft":
          case "ArrowUp":
            nextIndex =
              currentIndex === 0 ? documentKeys.length - 1 : currentIndex - 1
            break
          case "ArrowRight":
          case "ArrowDown":
            nextIndex =
              currentIndex === documentKeys.length - 1 ? 0 : currentIndex + 1
            break
          case "Home":
            nextIndex = 0
            break
          case "End":
            nextIndex = documentKeys.length - 1
            break
          default:
            return
        }

        event.preventDefault()
        const nextKey = documentKeys[nextIndex]
        if (!nextKey) {
          return
        }
        updateActiveDocumentKey(nextKey)
        focusDocumentTab(nextKey)
      },
    [documentKeys, focusDocumentTab, updateActiveDocumentKey],
  )

  const handleStartAnalysis = useCallback(async () => {
    if (
      analysisStartInFlightRef.current ||
      parsingInFlightRef.current ||
      !canProceed
    )
      return
    analysisStartInFlightRef.current = true
    const generation = screenGenerationRef.current
    setIsStartingAnalysis(true)
    updateStatusMessage(null)
    const failureMessage =
      "解析を開始できませんでした。通信状態を確認して、もう一度お試しください。"
    try {
      const startAnalysisResult = await startAnalysis({
        jobId: `${jobIdPrefix}-${Date.now()}`,
        documents,
        documentNames,
      })
      if (generation !== screenGenerationRef.current) return
      if (!startAnalysisResult.ok) {
        if (startAnalysisResult.reason === "superseded_operation") return
        updateStatusMessage(
          getSessionFailureStatus(startAnalysisResult.reason) ?? {
            message: failureMessage,
            tone: "error",
          },
        )
      }
    } catch {
      if (generation !== screenGenerationRef.current) return
      updateStatusMessage({ message: failureMessage, tone: "error" })
    } finally {
      analysisStartInFlightRef.current = false
      if (generation === screenGenerationRef.current)
        setIsStartingAnalysis(false)
    }
  }, [
    canProceed,
    documents,
    documentNames,
    jobIdPrefix,
    startAnalysis,
    updateStatusMessage,
  ])

  return {
    activeDocumentKey,
    addDocument,
    canProceed,
    cancelImport,
    analysisDisabledReason,
    clearDocument,
    documentKeys,
    documentNames,
    documents,
    handleFiles,
    handleStartAnalysis,
    handleTabKeyDown,
    isParsing,
    isStartingAnalysis,
    removeDocument,
    registerTabButtonRef: (key: string, element: HTMLButtonElement | null) => {
      tabButtonRefs.current[key] = element
    },
    statusMessages,
    titles,
    documentBodyGraphemeCounts,
    totalGraphemeCount,
    updateActiveDocumentKey,
    updateDocument,
    updateDocumentName,
    sourceFileNames,
  }
}
