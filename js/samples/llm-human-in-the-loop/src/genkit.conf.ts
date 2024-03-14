import { getProjectId } from '@genkit-ai/common';
import { configureGenkit } from '@genkit-ai/common/config';
import { openAI } from '@genkit-ai/plugin-openai';
import { googleGenAI } from '@genkit-ai/plugin-google-genai';
import { firebase } from '@genkit-ai/plugin-firebase';

export default configureGenkit({
  plugins: [firebase({ projectId: getProjectId() }), googleGenAI(), openAI()],
  flowStateStore: 'firebase',
  traceStore: 'firebase',
  enableTracingAndMetrics: true,
  logLevel: 'debug',
});