import { GenerateContentCandidate } from '@google-cloud/vertexai';
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { fromGeminiCandidate, toGeminiMessage } from '../src/gemini';

describe('toGeminiMessages', () => {
  const testCases = [
    {
      should: 'should transform genkit message (text content) correctly',
      inputMessage: {
        role: 'user',
        content: [{ text: 'Tell a joke about dogs.' }],
      },
      expectedOutput: {
        role: 'user',
        parts: [{ text: 'Tell a joke about dogs.' }],
      },
    },
    {
      should:
        'should transform genkit message (tool request content) correctly',
      inputMessage: {
        role: 'model',
        content: [
          { toolRequest: { name: 'tellAFunnyJoke', input: { topic: 'dogs' } } },
        ],
      },
      expectedOutput: {
        role: 'model',
        parts: [
          { functionCall: { name: 'tellAFunnyJoke', args: { topic: 'dogs' } } },
        ],
      },
    },
    {
      should:
        'should transform genkit message (tool response content) correctly',
      inputMessage: {
        role: 'tool',
        content: [
          {
            toolResponse: {
              name: 'tellAFunnyJoke',
              output: 'Why did the dogs cross the road?',
            },
          },
        ],
      },
      expectedOutput: {
        role: 'function',
        parts: [
          {
            functionResponse: {
              name: 'tellAFunnyJoke',
              response: {
                name: 'tellAFunnyJoke',
                content: 'Why did the dogs cross the road?',
              },
            },
          },
        ],
      },
    },
    {
      should:
        'should transform genkit message (inline base64 image content) correctly',
      inputMessage: {
        role: 'user',
        content: [
          { text: 'describe the following image:' },
          {
            media: {
              contentType: 'image/jpeg',
              url: 'data:image/jpeg;base64,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',
            },
          },
        ],
      },
      expectedOutput: {
        role: 'user',
        parts: [
          { text: 'describe the following image:' },
          {
            inline_data: {
              mime_type: 'image/jpeg',
              data: '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',
            },
          },
        ],
      },
    },
  ];
  for (const test of testCases) {
    it(test.should, () => {
      assert.deepEqual(toGeminiMessage(test.inputMessage), test.expectedOutput);
    });
  }
});

describe('fromGeminiCandidate', () => {
  const testCases = [
    {
      should:
        'should transform gemini candidate to genkit candidate (text parts) correctly',
      // had to delete the probabilityScore, severity, severityScore for the HARM_CATEGORY_SEXUALLY_EXPLICIT safety rating category
      geminiCandidate: {
        content: {
          role: 'model',
          parts: [
            {
              text: 'Why did the dog go to the bank?\n\nTo get his bones cashed!',
            },
          ],
        },
        finishReason: 'STOP',
        safetyRatings: [
          {
            category: 'HARM_CATEGORY_HATE_SPEECH',
            probability: 'NEGLIGIBLE',
            probabilityScore: 0.12074952,
            severity: 'HARM_SEVERITY_NEGLIGIBLE',
            severityScore: 0.18388656,
          },
          {
            category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
            probability: 'NEGLIGIBLE',
            probabilityScore: 0.37874627,
            severity: 'HARM_SEVERITY_LOW',
            severityScore: 0.37227696,
          },
          {
            category: 'HARM_CATEGORY_HARASSMENT',
            probability: 'NEGLIGIBLE',
            probabilityScore: 0.3983479,
            severity: 'HARM_SEVERITY_LOW',
            severityScore: 0.22270013,
          },
          {
            category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
            probability: 'NEGLIGIBLE',
          },
        ],
      },
      expectedOutput: {
        index: 0,
        message: {
          role: 'model',
          content: [
            {
              text: 'Why did the dog go to the bank?\n\nTo get his bones cashed!',
            },
          ],
        },
        finishReason: 'stop',
        finishMessage: undefined,
        custom: {
          citationMetadata: undefined,
          safetyRatings: [
            {
              category: 'HARM_CATEGORY_HATE_SPEECH',
              probability: 'NEGLIGIBLE',
              probabilityScore: 0.12074952,
              severity: 'HARM_SEVERITY_NEGLIGIBLE',
              severityScore: 0.18388656,
            },
            {
              category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
              probability: 'NEGLIGIBLE',
              probabilityScore: 0.37874627,
              severity: 'HARM_SEVERITY_LOW',
              severityScore: 0.37227696,
            },
            {
              category: 'HARM_CATEGORY_HARASSMENT',
              probability: 'NEGLIGIBLE',
              probabilityScore: 0.3983479,
              severity: 'HARM_SEVERITY_LOW',
              severityScore: 0.22270013,
            },
            {
              category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
              probability: 'NEGLIGIBLE',
            },
          ],
        },
      },
    },
    {
      should:
        'should transform gemini candidate to genkit candidate (function call parts) correctly',
      geminiCandidate: {
        content: {
          role: 'model',
          parts: [
            {
              functionCall: { name: 'tellAFunnyJoke', args: { topic: 'dog' } },
            },
          ],
        },
        finishReason: 'STOP',
        safetyRatings: [
          {
            category: 'HARM_CATEGORY_HATE_SPEECH',
            probability: 'NEGLIGIBLE',
            probabilityScore: 0.11858909,
            severity: 'HARM_SEVERITY_NEGLIGIBLE',
            severityScore: 0.11456649,
          },
          {
            category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
            probability: 'NEGLIGIBLE',
            probabilityScore: 0.13857833,
            severity: 'HARM_SEVERITY_NEGLIGIBLE',
            severityScore: 0.11417085,
          },
          {
            category: 'HARM_CATEGORY_HARASSMENT',
            probability: 'NEGLIGIBLE',
            probabilityScore: 0.28012377,
            severity: 'HARM_SEVERITY_NEGLIGIBLE',
            severityScore: 0.112405084,
          },
          {
            category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
            probability: 'NEGLIGIBLE',
          },
        ],
      },
      expectedOutput: {
        index: 0,
        message: {
          role: 'model',
          content: [
            {
              toolRequest: { name: 'tellAFunnyJoke', input: { topic: 'dog' } },
            },
          ],
        },
        finishReason: 'stop',
        finishMessage: undefined,
        custom: {
          citationMetadata: undefined,
          safetyRatings: [
            {
              category: 'HARM_CATEGORY_HATE_SPEECH',
              probability: 'NEGLIGIBLE',
              probabilityScore: 0.11858909,
              severity: 'HARM_SEVERITY_NEGLIGIBLE',
              severityScore: 0.11456649,
            },
            {
              category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
              probability: 'NEGLIGIBLE',
              probabilityScore: 0.13857833,
              severity: 'HARM_SEVERITY_NEGLIGIBLE',
              severityScore: 0.11417085,
            },
            {
              category: 'HARM_CATEGORY_HARASSMENT',
              probability: 'NEGLIGIBLE',
              probabilityScore: 0.28012377,
              severity: 'HARM_SEVERITY_NEGLIGIBLE',
              severityScore: 0.112405084,
            },
            {
              category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
              probability: 'NEGLIGIBLE',
            },
          ],
        },
      },
    },
  ];
  for (const test of testCases) {
    it(test.should, () => {
      assert.deepEqual(
        fromGeminiCandidate(test.geminiCandidate as GenerateContentCandidate),
        test.expectedOutput
      );
    });
  }
});