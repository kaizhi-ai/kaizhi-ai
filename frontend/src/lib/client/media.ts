import type { FileUIPart } from "ai"

import i18n from "@/lib/i18n"

import { request, responseErrorMessage } from "./http"
import { clearToken, getToken } from "./token"

type UploadedChatAttachment = {
  url: string
  mediaType: string
  name: string
  size: number
}

function uploadedAttachmentToFilePart(
  uploaded: UploadedChatAttachment
): FileUIPart {
  return {
    type: "file",
    mediaType: uploaded.mediaType,
    url: uploaded.url,
    filename: uploaded.name,
  }
}

export function readBlobAsDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result)
      } else {
        reject(new Error(i18n.t("errors.readFileFailed")))
      }
    }
    reader.onerror = () =>
      reject(reader.error ?? new Error(i18n.t("errors.readFileFailed")))
    reader.readAsDataURL(blob)
  })
}

export async function fetchChatMediaAsDataURL(url: string, token = getToken()) {
  if (!token) throw new Error(i18n.t("errors.notLoggedIn"))

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
  if (!res.ok) {
    if (res.status === 401) clearToken()
    throw new Error(
      await responseErrorMessage(res, i18n.t("chat.imageLoadFailed"))
    )
  }

  return readBlobAsDataURL(await res.blob())
}

export async function uploadChatAttachment(file: File): Promise<FileUIPart> {
  const form = new FormData()
  form.append("file", file)
  const uploaded = await request<UploadedChatAttachment>(
    "/api/v1/chats/uploads",
    {
      method: "POST",
      body: form,
    }
  )
  return uploadedAttachmentToFilePart(uploaded)
}
