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

import { describe, expect, it } from '@jest/globals';
import { evalFlowRun } from '../../src/commands/eval-flow-run';

describe('eval:flow', () => {
  const command = evalFlowRun.exitOverride().configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });

  it("fails if flow isn't passed", () => {
    expect(() => {
      command.parse(['node', 'eval:flow']);
    }).toThrowError(new Error("error: missing required argument 'flowName'"));
  });
});
