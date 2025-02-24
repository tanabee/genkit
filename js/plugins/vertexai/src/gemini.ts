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
  ModelMiddleware,
  modelRef,
  ModelReference,
  Part,
  ToolDefinitionSchema,
} from '@genkit-ai/ai/model';
import {
  downloadRequestMedia,
  simulateSystemPrompt,
} from '@genkit-ai/ai/model/middleware';
import { GENKIT_CLIENT_HEADER } from '@genkit-ai/core';
import {
  Content,
  FunctionDeclaration,
  FunctionDeclarationSchemaType,
  GenerateContentCandidate,
  GenerateContentResponse,
  GenerateContentResult,
  HarmBlockThreshold,
  HarmCategory,
  StartChatParams,
  VertexAI,
  Part as VertexPart,
} from '@google-cloud/vertexai';
import { z } from 'zod';

const SafetySettingsSchema = z.object({
  category: z.nativeEnum(HarmCategory),
  threshold: z.nativeEnum(HarmBlockThreshold),
});

const GeminiConfigSchema = GenerationCommonConfigSchema.extend({
  safetySettings: z.array(SafetySettingsSchema).optional(),
});

export const geminiPro = modelRef({
  name: 'vertexai/gemini-1.0-pro',
  info: {
    label: 'Vertex AI - Gemini Pro',
    versions: ['gemini-1.0-pro', 'gemini-1.0-pro-001'],
    supports: {
      multiturn: true,
      media: false,
      tools: true,
    },
  },
  configSchema: GeminiConfigSchema,
});

export const geminiProVision = modelRef({
  name: 'vertexai/gemini-1.0-pro-vision',
  info: {
    label: 'Vertex AI - Gemini Pro Vision',
    versions: ['gemini-1.0-pro-vision', 'gemini-1.0-pro-vision-001'],
    supports: {
      multiturn: true,
      media: true,
      tools: false,
    },
  },
  configSchema: GeminiConfigSchema,
});

export const gemini15ProPreview = modelRef({
  name: 'vertexai/gemini-1.5-pro-preview',
  info: {
    label: 'Vertex AI - Gemini 1.5 Pro Preview',
    versions: ['gemini-1.5-pro-preview-0409'],
    supports: {
      multiturn: true,
      media: true,
      tools: true,
    },
  },
  configSchema: GeminiConfigSchema,
  version: 'gemini-1.5-pro-preview-0409',
});

export const SUPPORTED_GEMINI_MODELS = {
  'gemini-1.0-pro': geminiPro,
  'gemini-1.5-pro-preview': gemini15ProPreview,
  'gemini-1.0-pro-vision': geminiProVision,
  // 'gemini-ultra': geminiUltra,
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

const toGeminiTool = (
  tool: z.infer<typeof ToolDefinitionSchema>
): FunctionDeclaration => {
  const declaration: FunctionDeclaration = {
    name: tool.name.replace(/\//g, '__'), // Gemini throws on '/' in tool name
    description: tool.description,
    parameters: convertSchemaProperty(tool.inputSchema),
  };
  return declaration;
};

const toGeminiFileDataPart = (part: MediaPart): VertexPart => {
  const media = part.media;
  if (media.url.startsWith('gs://')) {
    if (!media.contentType)
      throw new Error(
        'Must supply contentType when using media from gs:// URLs.'
      );
    return {
      fileData: {
        mimeType: media.contentType,
        fileUri: media.url,
      },
    };
  } else if (media.url.startsWith('data:')) {
    const dataUrl = media.url;
    const b64Data = dataUrl.substring(dataUrl.indexOf(',')! + 1);
    const contentType =
      media.contentType ||
      dataUrl.substring(dataUrl.indexOf(':')! + 1, dataUrl.indexOf(';'));
    return { inlineData: { mimeType: contentType, data: b64Data } };
  }

  throw Error(
    'Could not convert genkit part to gemini tool response part: missing file data'
  );
};

const toGeminiToolRequestPart = (part: Part): VertexPart => {
  if (!part?.toolRequest?.input) {
    throw Error(
      'Could not convert genkit part to gemini tool response part: missing tool request data'
    );
  }
  return {
    functionCall: {
      name: part.toolRequest.name,
      args: part.toolRequest.input,
    },
  };
};

const toGeminiToolResponsePart = (part: Part): VertexPart => {
  if (!part?.toolResponse?.output) {
    throw Error(
      'Could not convert genkit part to gemini tool response part: missing tool response data'
    );
  }
  return {
    functionResponse: {
      name: part.toolResponse.name,
      response: {
        name: part.toolResponse.name,
        content: part.toolResponse.output,
      },
    },
  };
};

export const toGeminiMessage = (message: MessageData): Content => {
  const vertexRole = toGeminiRole(message.role);
  const vertexAiMessage: any = {
    role: vertexRole,
    parts: [],
  };

  const parts = message.content;
  parts.forEach((part) => {
    if (part.text) {
      vertexAiMessage.parts.push({ text: part.text });
    }
    if (part.media) {
      vertexAiMessage.parts.push(toGeminiFileDataPart(part));
    }
    if (part.toolRequest) {
      vertexAiMessage.parts.push(toGeminiToolRequestPart(part));
    }
    if (part.toolResponse) {
      vertexAiMessage.parts.push(toGeminiToolResponsePart(part));
    }
  });
  return vertexAiMessage;
};

function fromGeminiFinishReason(
  reason: GenerateContentCandidate['finishReason']
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

function fromGeminiInlineDataPart(part: VertexPart): MediaPart {
  // Check if the required properties exist
  if (
    !part.inlineData ||
    !part.inlineData.hasOwnProperty('mimeType') ||
    !part.inlineData.hasOwnProperty('data')
  ) {
    throw new Error('Invalid GeminiPart: missing required properties');
  }
  const { mimeType, data } = part.inlineData;
  // Combine data and mimeType into a data URL
  const dataUrl = `data:${mimeType};base64,${data}`;
  return {
    media: {
      url: dataUrl,
      contentType: mimeType,
    },
  };
}

function fromGeminiFileDataPart(part: VertexPart): MediaPart {
  if (
    !part.fileData ||
    !part.fileData.hasOwnProperty('mimeType') ||
    !part.fileData.hasOwnProperty('url')
  ) {
    throw new Error(
      'Invalid Gemini File Data Part: missing required properties'
    );
  }

  return {
    media: {
      url: part.fileData?.fileUri,
      contentType: part.fileData?.mimeType,
    },
  };
}

function fromGeminiFunctionCallPart(part: VertexPart): Part {
  if (!part.functionCall) {
    throw new Error(
      'Invalid Gemini Function Call Part: missing function call data'
    );
  }
  return {
    toolRequest: {
      name: part.functionCall.name,
      input: part.functionCall.args,
    },
  };
}

function fromGeminiFunctionResponsePart(part: VertexPart): Part {
  if (!part.functionResponse) {
    throw new Error(
      'Invalid Gemini Function Call Part: missing function call data'
    );
  }
  return {
    toolResponse: {
      name: part.functionResponse.name.replace(/__/g, '/'), // restore slashes
      output: part.functionResponse.response,
    },
  };
}

// Converts vertex part to genkit part
function fromGeminiPart(part: VertexPart): Part {
  if (part.text !== undefined) return { text: part.text };
  if (part.functionCall) return fromGeminiFunctionCallPart(part);
  if (part.functionResponse) return fromGeminiFunctionResponsePart(part);
  if (part.inlineData) return fromGeminiInlineDataPart(part);
  if (part.fileData) return fromGeminiFileDataPart(part);
  throw new Error(
    'Part type is unsupported/corrupted. Either data is missing or type cannot be inferred from type.'
  );
}

export function fromGeminiCandidate(
  candidate: GenerateContentCandidate
): CandidateData {
  const parts = candidate.content.parts || [];
  const genkitCandidate: CandidateData = {
    index: candidate.index || 0, // reasonable default?
    message: {
      role: 'model',
      content: parts.map(fromGeminiPart),
    },
    finishReason: fromGeminiFinishReason(candidate.finishReason),
    finishMessage: candidate.finishMessage,
    custom: {
      safetyRatings: candidate.safetyRatings,
      citationMetadata: candidate.citationMetadata,
    },
  };
  return genkitCandidate;
}

// Translate JSON schema to Vertex AI's format. Specifically, the type field needs be mapped.
// Since JSON schemas can include nested arrays/objects, we have to recursively map the type field
// in all nested fields.
const convertSchemaProperty = (property) => {
  if (!property) {
    return null;
  }
  if (property.type === 'object') {
    const nestedProperties = {};
    Object.keys(property.properties).forEach((key) => {
      nestedProperties[key] = convertSchemaProperty(property.properties[key]);
    });
    return {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: nestedProperties,
      required: property.required,
    };
  } else if (property.type === 'array') {
    return {
      type: FunctionDeclarationSchemaType.ARRAY,
      items: convertSchemaProperty(property.items),
    };
  } else {
    return {
      type: FunctionDeclarationSchemaType[property.type.toUpperCase()],
    };
  }
};

/**
 *
 */
export function geminiModel(name: string, vertex: VertexAI): ModelAction {
  const modelName = `vertexai/${name}`;

  const model: ModelReference<z.ZodTypeAny> = SUPPORTED_GEMINI_MODELS[name];
  if (!model) throw new Error(`Unsupported model: ${name}`);

  const middlewares: ModelMiddleware[] = [simulateSystemPrompt()];
  if (model?.info?.supports?.media) {
    middlewares.push(downloadRequestMedia({ maxBytes: 1024 * 1024 * 20 }));
  }

  return defineModel(
    {
      name: modelName,
      ...model.info,
      configSchema: GeminiConfigSchema,
      use: middlewares,
    },
    async (request, streamingCallback) => {
      const client = vertex.preview.getGenerativeModel(
        {
          model: request.config?.version || model.version || name,
        },
        {
          apiClient: GENKIT_CLIENT_HEADER,
        }
      );

      const messages = request.messages;
      if (messages.length === 0) throw new Error('No messages provided.');

      const chatRequest: StartChatParams = {
        tools: request.tools?.length
          ? [{ functionDeclarations: request.tools?.map(toGeminiTool) }]
          : [],
        history: messages
          .slice(0, -1)
          .map((message) => toGeminiMessage(message)),
        generationConfig: {
          candidateCount: request.candidates || undefined,
          temperature: request.config?.temperature,
          maxOutputTokens: request.config?.maxOutputTokens,
          topK: request.config?.topK,
          topP: request.config?.topP,
          stopSequences: request.config?.stopSequences,
        },
        safetySettings: request.config?.safetySettings,
      };
      const msg = toGeminiMessage(messages[messages.length - 1]);
      if (streamingCallback) {
        const result = await client
          .startChat(chatRequest)
          .sendMessageStream(msg.parts);
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
        let result: GenerateContentResult | undefined;
        try {
          result = await client.startChat(chatRequest).sendMessage(msg.parts);
        } catch (err) {
          throw new Error(`Vertex response generation failed: ${err}`);
        }
        if (!result?.response.candidates?.length) {
          throw new Error('No valid candidates returned.');
        }
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
