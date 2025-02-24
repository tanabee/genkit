/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  CandidateData,
  defineModel,
  GenerationCommonConfigSchema,
  getBasicUsageStats,
  MediaPart,
  MessageData,
  ModelAction,
  modelRef,
  ModelReference,
  Part,
} from '@genkit-ai/ai/model';
import {
  downloadRequestMedia,
  simulateSystemPrompt,
} from '@genkit-ai/ai/model/middleware';
import { GENKIT_CLIENT_HEADER } from '@genkit-ai/core';
import {
  GenerateContentCandidate as GeminiCandidate,
  Content as GeminiMessage,
  Part as GeminiPart,
  GenerateContentResponse,
  GoogleGenerativeAI,
  RequestOptions,
  StartChatParams,
} from '@google/generative-ai';
import process from 'process';
import z from 'zod';

const SafetySettingsSchema = z.object({
  category: z.enum([
    'HARM_CATEGORY_UNSPECIFIED',
    'HARM_CATEGORY_HATE_SPEECH',
    'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    'HARM_CATEGORY_HARASSMENT',
    'HARM_CATEGORY_DANGEROUS_CONTENT',
  ]),
  threshold: z.enum([
    'BLOCK_LOW_AND_ABOVE',
    'BLOCK_MEDIUM_AND_ABOVE',
    'BLOCK_ONLY_HIGH',
    'BLOCK_NONE',
  ]),
});

const GeminiConfigSchema = GenerationCommonConfigSchema.extend({
  safetySettings: z.array(SafetySettingsSchema).optional(),
});

export const geminiPro = modelRef({
  name: 'googleai/gemini-pro',
  info: {
    label: 'Google AI - Gemini Pro',
    versions: ['gemini-1.0-pro', 'gemini-1.0-pro-latest', 'gemini-1.0-pro-001'],
    supports: {
      multiturn: true,
      media: false,
      tools: false,
    },
  },
  configSchema: GeminiConfigSchema,
});

export const geminiProVision = modelRef({
  name: 'googleai/gemini-pro-vision',
  info: {
    label: 'Google AI - Gemini Pro Vision',
    // none declared on https://ai.google.dev/models/gemini#model-variations
    versions: [],
    supports: {
      multiturn: true,
      media: true,
      tools: false,
    },
  },
  configSchema: GeminiConfigSchema,
});

export const gemini15Pro = modelRef({
  name: 'googleai/gemini-1.5-pro-latest',
  info: {
    label: 'Google AI - Gemini 1.5 Pro',
    supports: {
      multiturn: true,
      media: true,
      tools: true,
    },
  },
  configSchema: GeminiConfigSchema,
});

export const geminiUltra = modelRef({
  name: 'googleai/gemini-ultra',
  info: {
    label: 'Google AI - Gemini Ultra',
    versions: [],
    supports: {
      multiturn: true,
      media: false,
      tools: false,
    },
  },
  configSchema: GeminiConfigSchema,
});

export const V1_SUPPORTED_MODELS: Record<
  string,
  ModelReference<z.ZodTypeAny>
> = {
  'gemini-pro': geminiPro,
  'gemini-pro-vision': geminiProVision,
};

export const V1_BETA_SUPPORTED_MODELS: Record<
  string,
  ModelReference<z.ZodTypeAny>
> = {
  'gemini-1.5-pro-latest': gemini15Pro,
};

const SUPPORTED_MODELS = {
  ...V1_SUPPORTED_MODELS,
  ...V1_BETA_SUPPORTED_MODELS,
};

function toGeminiRole(role: MessageData['role']): string {
  switch (role) {
    case 'user':
      return 'user';
    case 'model':
      return 'model';
    case 'system':
      throw new Error('system role is not supported');
    case 'tool':
      return 'function';
    default:
      return 'user';
  }
}

function toInlineData(part: MediaPart): GeminiPart {
  const dataUrl = part.media.url;
  const b64Data = dataUrl.substring(dataUrl.indexOf(',')! + 1);
  const contentType =
    part.media.contentType ||
    dataUrl.substring(dataUrl.indexOf(':')! + 1, dataUrl.indexOf(';'));
  return { inlineData: { mimeType: contentType, data: b64Data } };
}

function fromInlineData(inlinePart: GeminiPart): MediaPart {
  // Check if the required properties exist
  if (
    !inlinePart.inlineData ||
    !inlinePart.inlineData.hasOwnProperty('mimeType') ||
    !inlinePart.inlineData.hasOwnProperty('data')
  ) {
    throw new Error('Invalid GeminiPart: missing required properties');
  }
  const { mimeType, data } = inlinePart.inlineData;
  // Combine data and mimeType into a data URL
  const dataUrl = `data:${mimeType};base64,${data}`;
  return {
    media: {
      url: dataUrl,
      contentType: mimeType,
    },
  };
}

function toGeminiPart(part: Part): GeminiPart {
  if (part.text !== undefined) return { text: part.text };
  if (part.media) return toInlineData(part);
  throw new Error('Only text and media parts are supported currently.');
}

function fromGeminiPart(part: GeminiPart): Part {
  if (part.text !== undefined) return { text: part.text };
  if (part.inlineData) return fromInlineData(part);
  throw new Error('Only support text for the moment.');
}

function toGeminiMessage(message: MessageData): GeminiMessage {
  return {
    role: toGeminiRole(message.role),
    parts: message.content.map(toGeminiPart),
  };
}

function fromGeminiFinishReason(
  reason: GeminiCandidate['finishReason']
): CandidateData['finishReason'] {
  if (!reason) return 'unknown';
  switch (reason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY': // blocked for safety
    case 'RECITATION': // blocked for reciting training data
      return 'blocked';
    default:
      return 'unknown';
  }
}

function fromGeminiCandidate(candidate: GeminiCandidate): CandidateData {
  return {
    index: candidate.index,
    message: {
      role: 'model',
      content: (candidate.content?.parts || []).map(fromGeminiPart),
    },
    finishReason: fromGeminiFinishReason(candidate.finishReason),
    finishMessage: candidate.finishMessage,
    custom: {
      safetyRatings: candidate.safetyRatings,
      citationMetadata: candidate.citationMetadata,
    },
  };
}

/**
 *
 */
export function googleAIModel(
  name: string,
  apiKey?: string,
  apiVersion?: string,
  baseUrl?: string
): ModelAction {
  const modelName = `googleai/${name}`;
  if (!apiKey)
    apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey)
    throw new Error(
      'please pass in the API key or set the GOOGLE_GENAI_API_KEY or GOOGLE_API_KEY environment variable'
    );
  const model: ModelReference<z.ZodTypeAny> = SUPPORTED_MODELS[name];
  if (!model) throw new Error(`Unsupported model: ${name}`);
  return defineModel(
    {
      name: modelName,
      ...model.info,
      configSchema: model.configSchema,
      use: [
        // simulate a system prompt since no native one is supported
        simulateSystemPrompt(),
        // since gemini api doesn't support downloading media from http(s)
        downloadRequestMedia({ maxBytes: 1024 * 1024 * 10 }),
      ],
    },
    async (request, streamingCallback) => {
      const options: RequestOptions = { apiClient: GENKIT_CLIENT_HEADER };
      if (apiVersion) {
        options.apiVersion = apiVersion;
      }
      if (apiVersion) {
        options.baseUrl = baseUrl;
      }
      const client = new GoogleGenerativeAI(apiKey!).getGenerativeModel(
        {
          model: request.config?.version || model.version || name,
        },
        options
      );
      const messages = request.messages.map(toGeminiMessage);
      if (messages.length === 0) throw new Error('No messages provided.');
      const chatRequest = {
        history: messages.slice(0, messages.length - 1),
        generationConfig: {
          candidateCount: request.candidates || undefined,
          temperature: request.config?.temperature,
          maxOutputTokens: request.config?.maxOutputTokens,
          topK: request.config?.topK,
          topP: request.config?.topP,
          stopSequences: request.config?.stopSequences,
        },
        safetySettings: request.config?.safetySettings,
      } as StartChatParams;
      if (streamingCallback) {
        const result = await client
          .startChat(chatRequest)
          .sendMessageStream(messages[messages.length - 1].parts);
        for await (const item of result.stream) {
          (item as GenerateContentResponse).candidates?.forEach((candidate) => {
            const c = fromGeminiCandidate(candidate);
            streamingCallback({
              index: c.index,
              content: c.message.content,
            });
          });
        }
        const response = await result.response;
        if (!response.candidates?.length) {
          throw new Error('No valid candidates returned.');
        }
        return {
          candidates: response.candidates?.map(fromGeminiCandidate) || [],
          custom: response,
        };
      } else {
        const result = await client
          .startChat(chatRequest)
          .sendMessage(messages[messages.length - 1].parts);
        if (!result.response.candidates?.length)
          throw new Error('No valid candidates returned.');
        const responseCandidates =
          result.response.candidates?.map(fromGeminiCandidate) || [];
        return {
          candidates: responseCandidates,
          custom: result.response,
          usage: getBasicUsageStats(request.messages, responseCandidates),
        };
      }
    }
  );
}
