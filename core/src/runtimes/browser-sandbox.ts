/**
 * Browser sandbox runtime — the Grok Bot / Muse pattern: browser work runs
 * in an ephemeral, disposable worker (container), never on the host. The
 * worker streams a live view so the user can watch and take over
 * (Muse AgentBrowserTakeoverControls).
 *
 * Stub until the worker service lands (see sandbox/).
 */

import type { CapabilitySnapshot, CommandSpec, InvokeCommand, CommandResult } from '../types.js';
import type { Runtime } from '../registry.js';

const SPECS: CommandSpec[] = [
  {
    id: 'web.navigate',
    version: 'v1',
    title: 'Open a URL in the sandboxed browser',
    description: 'Navigates the isolated browser to a URL and returns page text.',
    args: [{ name: 'url', type: 'string', description: 'URL to open', required: true }],
    defaultApproval: 'AUTO',
  },
  {
    id: 'web.click',
    version: 'v1',
    title: 'Click an element in the sandboxed browser',
    description: 'Clicks by accessibility index or selector inside the sandbox page.',
    args: [
      { name: 'elementIndex', type: 'number', description: 'Element index from the last state', required: false },
      { name: 'selector', type: 'string', description: 'CSS selector alternative', required: false },
    ],
    defaultApproval: 'ASK_ONCE',
  },
  {
    id: 'web.type',
    version: 'v1',
    title: 'Type into the sandboxed browser',
    description: 'Types text into a focused field in the sandbox page.',
    args: [
      { name: 'elementIndex', type: 'number', description: 'Target field', required: false },
      { name: 'text', type: 'string', description: 'Text to type', required: true },
    ],
    defaultApproval: 'ASK_ALWAYS',
  },
  {
    id: 'web.state',
    version: 'v1',
    title: 'Get page state as an accessibility tree',
    description: 'Returns the current page as a diffed accessibility tree (Dots pattern).',
    args: [],
    defaultApproval: 'AUTO',
  },
  {
    id: 'web.submit_search',
    version: 'v1',
    title: 'Search the web',
    description: 'Runs a web search in the sandbox and returns top results.',
    args: [{ name: 'query', type: 'string', description: 'Search query', required: true }],
    defaultApproval: 'AUTO',
  },
];

export class BrowserSandboxRuntime implements Runtime {
  readonly runtimeId: string;
  private workerUrl?: string;

  constructor(workerUrl?: string, runtimeId = 'sandbox-browser') {
    this.workerUrl = workerUrl;
    this.runtimeId = runtimeId;
  }

  async snapshot(): Promise<CapabilitySnapshot> {
    return {
      runtimeId: this.runtimeId,
      runtimeKind: 'sandbox-browser',
      protocolVersion: '1',
      commands: SPECS,
      dataSources: [],
      triggers: [],
    };
  }

  async invoke(cmd: InvokeCommand): Promise<CommandResult> {
    if (!this.workerUrl) {
      return {
        invocationId: cmd.invocationId,
        ok: false,
        error: {
          code: 501,
          message: `browser sandbox worker not connected yet; '${cmd.commandId}' is the contract only`,
          retryable: false,
        },
      };
    }
    // Worker client (Playwright inside a container, WS protocol) lands next milestone.
    return { invocationId: cmd.invocationId, ok: true, data: { kind: 'string', value: 'not implemented' } };
  }

  static specs(): CommandSpec[] {
    return SPECS;
  }
}
