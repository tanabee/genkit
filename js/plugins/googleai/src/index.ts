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

import { genkitPlugin, Plugin } from '@genkit-ai/core';
import {
  SUPPORTED_MODELS as EMBEDDER_MODELS,
  textEmbeddingGeckoEmbedder,
} from './embedder.js';
import {
  gemini15Pro,
  geminiPro,
  geminiProVision,
  googleAIModel,
  V1_BETA_SUPPORTED_MODELS,
  V1_SUPPORTED_MODELS,
} from './gemini.js';
export { gemini15Pro, geminiPro, geminiProVision };

export interface PluginOptions {
  apiKey?: string;
  apiVersion?: string | string[];
  baseUrl?: string;
}

export const googleAI: Plugin<[PluginOptions] | []> = genkitPlugin(
  'googleai',
  async (options?: PluginOptions) => {
    let models;
    let embedders;
    let apiVersions = ['v1'];

    if (options?.apiVersion) {
      if (Array.isArray(options?.apiVersion)) {
        apiVersions = options?.apiVersion;
      } else {
        apiVersions = [options?.apiVersion];
      }
    }
    if (apiVersions.includes('v1beta')) {
      (embedders = []),
        (models = [
          ...Object.keys(V1_BETA_SUPPORTED_MODELS).map((name) =>
            googleAIModel(name, options?.apiKey, 'v1beta', options?.baseUrl)
          ),
        ]);
    }
    if (apiVersions.includes('v1')) {
      models = [
        ...Object.keys(V1_SUPPORTED_MODELS).map((name) =>
          googleAIModel(name, options?.apiKey, undefined, options?.baseUrl)
        ),
      ];
      embedders = [
        ...Object.keys(EMBEDDER_MODELS).map((name) =>
          textEmbeddingGeckoEmbedder(name, { apiKey: options?.apiKey })
        ),
      ];
    }
    return {
      models,
      embedders,
    };
  }
);

export default googleAI;
