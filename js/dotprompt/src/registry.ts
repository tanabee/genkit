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

import { PromptAction } from '@genkit-ai/ai';
import { config, GenkitError } from '@genkit-ai/core';
import { logger } from '@genkit-ai/core/logging';
import { lookupAction } from '@genkit-ai/core/registry';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Dotprompt } from './prompt.js';

export async function lookupPrompt(
  name: string,
  variant?: string
): Promise<Dotprompt> {
  const registryPrompt = (await lookupAction(
    `/prompt/${name}${variant ? `.${variant}` : ''}`
  )) as PromptAction;
  if (registryPrompt) {
    return Dotprompt.fromAction(registryPrompt);
  } else {
    const loadedPrompt = loadPrompt(name, variant);
    loadedPrompt.define(); // register it
    return loadedPrompt;
  }
}

export function loadPrompt(name: string, variant?: string) {
  const dir = config.options.promptDir || './prompts';
  const promptExists = existsSync(
    join(dir, `${name}${variant ? `.${variant}` : ''}.prompt`)
  );
  if (!promptExists && variant) {
    logger.warn(
      `Prompt '${name}.${variant}' not found, trying '${name}' without variant.`
    );
    return loadPrompt(name);
  } else if (!promptExists) {
    throw new GenkitError({
      source: 'dotprompt',
      status: 'NOT_FOUND',
      message: `Tried to load prompt '${name}.prompt' but the file did not exist.`,
    });
  }

  const source = readFileSync(
    join(dir, `${name}${variant ? `.${variant}` : ''}.prompt`),
    'utf8'
  );
  const prompt = Dotprompt.parse(name, source);
  prompt.variant = variant;
  return prompt;
}
