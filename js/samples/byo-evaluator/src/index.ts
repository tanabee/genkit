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
import { EvaluatorAction } from '@genkit-ai/ai';
import { ModelReference } from '@genkit-ai/ai/model';
import { PluginProvider, genkitPlugin } from '@genkit-ai/core';
import * as z from 'zod';
import {
  DELICIOUSNESS,
  createDeliciousnessEvaluator,
} from './deliciousness/deliciousness_evaluator.js';
import {
  FUNNINESS,
  createFunninessEvaluator,
} from './funniness/funniness_evaluator.js';
import { PII_DETECTION, createPiiEvaluator } from './pii/pii_evaluator.js';
import {
  RegexMetric,
  createRegexEvaluators,
  isRegexMetric,
} from './regex/regex_evaluator.js';

/**
 * Generic metric definition with flexible configuration.
 */
export interface ByoMetric {
  name: string;
}

/**
 * Plugin option definition for the PII evaluator
 */
export interface PluginOptions<ModelCustomOptions extends z.ZodTypeAny> {
  judge: ModelReference<ModelCustomOptions>;
  judgeConfig?: z.infer<ModelCustomOptions>;
  metrics?: Array<ByoMetric>;
}

/**
 * Configurable Eval plugin that provides different kinds of custom evaluators.
 */
export function byoEval<ModelCustomOptions extends z.ZodTypeAny>(
  params: PluginOptions<ModelCustomOptions>
): PluginProvider {
  // Define the new plugin
  const plugin = genkitPlugin(
    'byo',
    async (params: PluginOptions<ModelCustomOptions>) => {
      const { judge, judgeConfig, metrics } = params;
      if (!metrics) {
        throw new Error(`Found no configured metrics.`);
      }
      const regexMetrics = metrics?.filter((metric) => isRegexMetric(metric));
      const hasPiiMetric = metrics?.includes(PII_DETECTION);
      const hasFunninessMetric = metrics?.includes(FUNNINESS);
      const hasDelicousnessMetric = metrics?.includes(DELICIOUSNESS);

      let evaluators: EvaluatorAction[] = [];

      if (regexMetrics) {
        evaluators = [...createRegexEvaluators(regexMetrics as RegexMetric[])];
      }

      if (hasPiiMetric) {
        evaluators.push(createPiiEvaluator(judge, judgeConfig));
      }

      if (hasFunninessMetric) {
        evaluators.push(createFunninessEvaluator(judge, judgeConfig));
      }

      if (hasDelicousnessMetric) {
        evaluators.push(createDeliciousnessEvaluator(judge, judgeConfig));
      }

      return { evaluators };
    }
  );

  // create the plugin with the passed params
  return plugin(params);
}
export default byoEval;

export * from './genkit.config.js';
