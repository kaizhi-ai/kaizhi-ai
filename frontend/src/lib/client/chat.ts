import {
  isFileUIPart,
  isTextUIPart,
  safeValidateUIMessages,
  validateUIMessages,
} from "ai"

import type { ChatUIMessage, ChatUIPart } from "@/lib/chat-types"
import i18n from "@/lib/i18n"

import { get, post, request } from "./http"
import { fetchChatMediaAsDataURL, uploadChatAttachment } from "./media"

export type ChatSession = {
  id: string
  user_id: string
  title: string
  created_at: string
  updated_at: string
}

const SUPPORTED_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
])
const IMAGE_GENERATION_TOOL_TYPE = "tool-image_generation"
const DATA_IMAGE_URL_RE = /^data:([^;,]+);base64,(.*)$/is
const CHAT_MEDIA_URL_PREFIX = "/api/v1/chats/media/"

type ImageGenerationOutputPart = Extract<
  ChatUIPart,
  { type: "tool-image_generation"; state: "output-available" }
>

function joinTextParts(parts: ChatUIMessage["parts"]) {
  return parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join("")
    .trim()
}

function imageExtension(mediaType: string) {
  switch (mediaType) {
    case "image/jpeg":
      return "jpg"
    case "image/png":
      return "png"
    case "image/webp":
      return "webp"
    case "image/gif":
      return "gif"
    default:
      return "webp"
  }
}

function isLocalChatMediaURL(url: string) {
  return url.startsWith(CHAT_MEDIA_URL_PREFIX)
}

function isGeneratedImageOutputPart(
  part: ChatUIPart
): part is ImageGenerationOutputPart {
  if (part.type !== IMAGE_GENERATION_TOOL_TYPE) return false
  if (part.state !== "output-available" || part.preliminary === true) {
    return false
  }
  return (
    typeof part.output.result === "string" && part.output.result.trim() !== ""
  )
}

function generatedImageResult(part: ImageGenerationOutputPart) {
  return part.output.result.trim()
}

function generatedImageBlob(result: string) {
  let mediaType = "image/webp"
  let base64 = result.trim()
  const match = DATA_IMAGE_URL_RE.exec(base64)
  if (match) {
    mediaType = match[1].toLowerCase()
    base64 = match[2]
  }
  if (!SUPPORTED_IMAGE_MIME.has(mediaType)) return null

  try {
    const binary = atob(base64.replace(/\s/g, ""))
    const chunks: ArrayBuffer[] = []
    for (let offset = 0; offset < binary.length; offset += 8192) {
      const slice = binary.slice(offset, offset + 8192)
      const buffer = new ArrayBuffer(slice.length)
      const bytes = new Uint8Array(buffer)
      for (let i = 0; i < slice.length; i += 1) {
        bytes[i] = slice.charCodeAt(i)
      }
      chunks.push(buffer)
    }
    return {
      mediaType,
      blob: new Blob(chunks, { type: mediaType }),
    }
  } catch {
    return null
  }
}

async function fetchSavedMediaAsDataURL(url: string) {
  if (!isLocalChatMediaURL(url)) return url
  return fetchChatMediaAsDataURL(url)
}

function withGeneratedImageResult(
  part: ImageGenerationOutputPart,
  result: string
): ImageGenerationOutputPart {
  return {
    ...part,
    output: {
      ...part.output,
      result,
    },
  }
}

async function savedPartToUiPart(savedPart: ChatUIPart): Promise<ChatUIPart> {
  if (isFileUIPart(savedPart)) {
    return {
      ...savedPart,
      url: await fetchSavedMediaAsDataURL(savedPart.url),
    }
  }

  if (!isGeneratedImageOutputPart(savedPart)) return savedPart
  const result = generatedImageResult(savedPart)

  return withGeneratedImageResult(
    savedPart,
    await fetchSavedMediaAsDataURL(result)
  )
}

async function uiMessageToSavedMessage(
  uiMessage: ChatUIMessage
): Promise<ChatUIMessage> {
  return {
    id: uiMessage.id,
    role: uiMessage.role,
    ...(uiMessage.metadata === undefined
      ? {}
      : { metadata: uiMessage.metadata }),
    parts: await uiPartsToSavedParts(uiMessage.parts),
  }
}

async function savedPartsToUiParts(
  savedParts: ChatUIMessage["parts"]
): Promise<ChatUIMessage["parts"]> {
  const uiParts = await Promise.all(savedParts.map(savedPartToUiPart))
  return uiParts.length > 0 ? uiParts : [{ type: "text", text: "" }]
}

async function savedMessageToUiMessage(
  savedMessage: ChatUIMessage
): Promise<ChatUIMessage> {
  const uiParts = await savedPartsToUiParts(savedMessage.parts)
  return {
    id: savedMessage.id,
    role: savedMessage.role,
    ...(savedMessage.metadata === undefined
      ? {}
      : { metadata: savedMessage.metadata }),
    parts: uiParts,
  }
}

async function validateChatMessage(message: unknown): Promise<ChatUIMessage> {
  const [validated] = await validateUIMessages<ChatUIMessage>({
    messages: [message],
  })
  if (!validated) throw new Error("invalid chat message response")
  return validated
}

async function validChatMessages(
  messages: unknown[]
): Promise<ChatUIMessage[]> {
  const results = await Promise.all(
    messages.map(async (message) => {
      const result = await safeValidateUIMessages<ChatUIMessage>({
        messages: [message],
      })
      return result.success ? result.data[0] : null
    })
  )
  return results.filter((message): message is ChatUIMessage => message !== null)
}

export async function listChats(): Promise<ChatSession[]> {
  const data = await get<{ chats: ChatSession[] }>("/api/v1/chats")
  return data.chats
}

export async function createChat(title: string): Promise<ChatSession> {
  return post<ChatSession>("/api/v1/chats", { title })
}

export async function deleteChat(id: string): Promise<void> {
  await request<void>(`/api/v1/chats/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export async function listChatMessages(id: string): Promise<ChatUIMessage[]> {
  const data = await get<{ messages: unknown[] }>(
    `/api/v1/chats/${encodeURIComponent(id)}/messages`
  )
  const savedMessages = await validChatMessages(data.messages)
  return Promise.all(savedMessages.map(savedMessageToUiMessage))
}

export async function appendChatMessage(
  chatId: string,
  uiMessage: ChatUIMessage
): Promise<ChatUIMessage> {
  const outbound = await uiMessageToSavedMessage(uiMessage)
  const savedMessage = await post<unknown>(
    `/api/v1/chats/${encodeURIComponent(chatId)}/messages`,
    outbound
  )
  return savedMessageToUiMessage(await validateChatMessage(savedMessage))
}

export function draftTitleFromText(text: string): string {
  const title = text.trim().replace(/\s+/g, " ").slice(0, 40)
  return title || i18n.t("chat.newChat")
}

export function textFromUIMessage(uiMessage: ChatUIMessage): string {
  return joinTextParts(uiMessage.parts)
}

async function uiPartsToSavedParts(
  uiParts: ChatUIMessage["parts"]
): Promise<ChatUIMessage["parts"]> {
  const savedParts: ChatUIMessage["parts"] = []
  for (const uiPart of uiParts) {
    const savedPart = await uiPartToSavedPart(uiPart)
    if (savedPart !== null) savedParts.push(savedPart)
  }
  return savedParts.length > 0 ? savedParts : [{ type: "text", text: "" }]
}

async function uploadImageResult(result: string, fallbackFilename: string) {
  const image = generatedImageBlob(result)
  if (!image) {
    throw new Error(i18n.t("errors.uploadFailed"))
  }

  const fallbackExt = imageExtension(image.mediaType)
  const name = fallbackFilename || "image"
  const filename = name.includes(".") ? name : `${name}.${fallbackExt}`
  const file = new File([image.blob], filename, { type: image.mediaType })
  return uploadChatAttachment(file)
}

async function uiPartToSavedPart(
  uiPart: ChatUIPart
): Promise<ChatUIPart | null> {
  if (isFileUIPart(uiPart)) {
    if (isLocalChatMediaURL(uiPart.url)) return uiPart

    const ext = imageExtension(uiPart.mediaType)
    const uploaded = await uploadImageResult(
      uiPart.url,
      uiPart.filename ?? `image.${ext}`
    )
    return {
      ...uiPart,
      mediaType: uploaded.mediaType,
      url: uploaded.url,
      filename: uploaded.filename,
    }
  }

  if (!isGeneratedImageOutputPart(uiPart)) return uiPart
  const result = generatedImageResult(uiPart)
  if (isLocalChatMediaURL(result)) return uiPart

  const uploaded = await uploadImageResult(result, "generated-image")
  return withGeneratedImageResult(uiPart, uploaded.url)
}
