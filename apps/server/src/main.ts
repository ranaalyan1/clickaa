/**
 * Clickaa panel server entry — runs the agent and serves the Clicky-style
 * interface at http://localhost:4747
 *
 *   CLICKAA_MODEL_BASE_URL=https://api.openai.com/v1 \
 *   CLICKAA_MODEL_KEY=sk-... \
 *   CLICKAA_MODEL=gpt-4o-mini \
 *   npm run start -w @clickaa/server
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BrowserSandboxRuntime,
  createAgent,
  OpenAICompatibleAdapter,
  PcHostRuntime,
} from '@clickaa/core';
import { agentEventsFor, createClickaaServer, createUiBridge } from './createServer.js';

const PORT = Number(process.env.CLICKAA_PORT ?? 4747);
const baseUrl = process.env.CLICKAA_MODEL_BASE_URL ?? 'https://api.openai.com/v1';
const apiKey = process.env.CLICKAA_MODEL_KEY ?? '';
const model = process.env.CLICKAA_MODEL ?? 'gpt-4o-mini';

async function main(): Promise<void> {
  if (!apiKey) {
    console.error('Set CLICKAA_MODEL_KEY (any OpenAI-compatible endpoint) to start.');
    process.exit(1);
  }

  const bridge = createUiBridge();
  const agent = createAgent({
    model: new OpenAICompatibleAdapter({ baseUrl, apiKey, model }),
    runtimes: [new PcHostRuntime(), new BrowserSandboxRuntime()],
    events: agentEventsFor(bridge),
  });

  const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
  const server = createClickaaServer({ agent, webRoot, bridge });

  server.listen(PORT, () => {
    console.log(`Clickaa panel: http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
