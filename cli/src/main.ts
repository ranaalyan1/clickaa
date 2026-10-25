/**
 * clickaa-cli — chat with your agent from the terminal.
 *
 *   CLICKAA_MODEL_BASE_URL=https://api.openai.com/v1 \
 *   CLICKAA_MODEL_KEY=sk-... \
 *   CLICKAA_MODEL=gpt-4o-mini \
 *   npm run -w cli start
 */

import * as readline from 'node:readline/promises';
import { createAgent, OpenAICompatibleAdapter, PcHostRuntime, BrowserSandboxRuntime } from '@clickaa/core';

async function main(): Promise<void> {
  const baseUrl = process.env.CLICKAA_MODEL_BASE_URL ?? 'https://api.openai.com/v1';
  const apiKey = process.env.CLICKAA_MODEL_KEY ?? '';
  const model = process.env.CLICKAA_MODEL ?? 'gpt-4o-mini';

  if (!apiKey) {
    console.error('Set CLICKAA_MODEL_KEY (any OpenAI-compatible endpoint) to start.');
    process.exit(1);
  }

  const agent = createAgent({
    model: new OpenAICompatibleAdapter({ baseUrl, apiKey, model }),
    runtimes: [new PcHostRuntime(), new BrowserSandboxRuntime()],
    events: {
      onAssistantMessage: (content) => {
        if (content) process.stdout.write(`\n${content}\n`);
      },
      onCommandResult: (ok, summary) => {
        process.stdout.write(`  [${ok ? 'ok' : 'fail'}] ${summary}\n`);
      },
      onApprovalRequest: async (req) => {
        console.log(`\nApproval needed: ${req.summary}`);
        for (const a of req.argSummaries) console.log(`  ${a.name} = ${a.preview}`);
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = (await rl.question('Approve? (y)es / (n)o / (a)lways: ')).trim().toLowerCase();
        rl.close();
        const approved = answer.startsWith('y') || answer.startsWith('a');
        return {
          requestId: req.requestId,
          invocationId: req.invocationId,
          approved,
          scope: answer.startsWith('a') ? `always:${req.commandId}` : 'once',
          decidedBy: 'cli-user',
          decidedAtMs: Date.now(),
        };
      },
    },
  });

  const summary = await agent.start();
  console.log(`Clickaa is up.\n${summary}\nType a message, or 'quit' to exit.\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  while (true) {
    const line = await rl.question('you > ');
    if (!line.trim()) continue;
    if (line.trim() === 'quit' || line.trim() === 'exit') break;
    try {
      const reply = await agent.send(line);
      if (!reply) console.log('(no textual reply — see action output above)');
    } catch (err) {
      console.error(`error: ${(err as Error).message}`);
    }
  }
  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
