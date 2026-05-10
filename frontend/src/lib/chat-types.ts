import type { createOpenAI } from "@ai-sdk/openai"
import type { InferUITools, UIMessage } from "ai"

type OpenAIProvider = ReturnType<typeof createOpenAI>

export type ChatToolSet = {
  web_search: ReturnType<OpenAIProvider["tools"]["webSearch"]>
  image_generation: ReturnType<OpenAIProvider["tools"]["imageGeneration"]>
}

export type ChatUITools = InferUITools<ChatToolSet>
export type ChatUIMessage = UIMessage<unknown, never, ChatUITools>
export type ChatUIPart = ChatUIMessage["parts"][number]
