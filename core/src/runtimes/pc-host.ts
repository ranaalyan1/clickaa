/**
 * PC host runtime — the HeyClicky/Dots actuator layer for desktops.
 *
 * The contract below mirrors what both RE studies proved out:
 *  - HeyClicky: screen capture, input injection, app launching, files.
 *  - Dots (sky window2): per-window state, list apps/windows, accessibility
 *    actions — plus a "full desktop" mode.
 *
 * This is the stub implementation: every command logs and returns a
 * placeholder so the full agent loop works end-to-end before the native
import type { Runtime } from '../registry.js';
 */

import type {
  Args,
  CapabilitySnapshot,
  CommandResult,
  CommandSpec,
  InvokeCommand,
  TriggerEvent,
} from '../types.js';
import type { Runtime } from '../registry.js';

const SPECS: CommandSpec[] = [
  {
    id: 'pc.screenshot',
    version: 'v1',
    title: 'Take a screenshot of a window or the whole desktop',
    description: 'Captures the screen (a window, or the full desktop if no window id given).',
    args: [
      { name: 'windowId', type: 'string', description: 'Optional window id; omit for full desktop', required: false },
    ],
    defaultApproval: 'AUTO',
  },
  {
    id: 'pc.list_windows',
    version: 'v1',
    title: 'List open windows',
    description: 'Returns the windows currently open, with ids, titles and owning apps.',
    args: [],
    defaultApproval: 'AUTO',
  },
  {
    id: 'pc.click',
    version: 'v1',
    title: 'Click in a window',
    description: 'Clicks at a coordinate or on an accessibility element of a window.',
    args: [
      { name: 'windowId', type: 'string', description: 'Target window', required: true },
      { name: 'x', type: 'number', description: 'X coordinate', required: false },
      { name: 'y', type: 'number', description: 'Y coordinate', required: false },
      { name: 'elementIndex', type: 'number', description: 'Accessibility element index instead of coordinates', required: false },
    ],
    defaultApproval: 'ASK_ALWAYS',
  },
  {
    id: 'pc.type_text',
    version: 'v1',
    title: 'Type text into the focused window',
    description: 'Injects keyboard input into a window. NEVER use for passwords/secrets.',
    args: [
      { name: 'windowId', type: 'string', description: 'Target window', required: true },
      { name: 'text', type: 'string', description: 'Text to type', required: true },
    ],
    defaultApproval: 'ASK_ALWAYS',
  },
  {
    id: 'pc.press_key',
    version: 'v1',
    title: 'Press a key chord',
    description: 'Presses a key or key chord (e.g. "ctrl+s") in a window.',
    args: [
      { name: 'windowId', type: 'string', description: 'Target window', required: true },
      { name: 'keys', type: 'string', description: 'Key chord, "+"-separated', required: true },
    ],
    defaultApproval: 'ASK_ALWAYS',
  },
  {
    id: 'pc.launch_app',
    version: 'v1',
    title: 'Launch an application',
    description: 'Starts an app by id/name so its window can be targeted.',
    args: [{ name: 'appId', type: 'string', description: 'App to launch', required: true }],
    defaultApproval: 'ASK_ONCE',
  },
  {
    id: 'pc.files.read',
    version: 'v1',
    title: 'Read a file from the user machine',
    description: 'Reads a text file (truncated). Sensitive paths should be refused.',
    args: [{ name: 'path', type: 'string', description: 'Absolute file path', required: true }],
    defaultApproval: 'ASK_ALWAYS',
  },
];

export interface PcHostOptions {
  runtimeId?: string;
  /** Set to true once native backends are wired; stub otherwise. */
  enabled?: boolean;
}

export class PcHostRuntime implements Runtime {
  readonly runtimeId: string;
  private enabled: boolean;

  constructor(opts: PcHostOptions = {}) {
    this.runtimeId = opts.runtimeId ?? 'pc-host';
    this.enabled = opts.enabled ?? false;
  }

  async snapshot(): Promise<CapabilitySnapshot> {
    return {
      runtimeId: this.runtimeId,
      runtimeKind: 'pc-host',
      protocolVersion: '1',
      commands: SPECS,
      dataSources: [
        { id: 'pc.files.watch', version: 'v1', description: 'File system change events', supportsBackfill: true },
        { id: 'pc.clipboard', version: 'v1', description: 'Clipboard read/write events', supportsBackfill: false },
      ],
      triggers: [{ id: 'pc.hotkey', version: 'v1', description: 'Global hotkey pressed' }],
    };
  }

  async invoke(cmd: InvokeCommand): Promise<CommandResult> {
    if (!this.enabled) {
      return {
        invocationId: cmd.invocationId,
        ok: false,
        error: {
          code: 501,
          message: `pc-host native backend not wired yet (stub build); '${cmd.commandId}' is the contract only`,
          retryable: false,
        },
      };
    }
    // Native backends (Win32/UIA on Windows, AT-SPI on Linux, AX on macOS)
    // land in later milestones — the protocol and gating already work.
    return { invocationId: cmd.invocationId, ok: true, data: { kind: 'string', value: 'not implemented' } };
  }

  onTrigger(handler: (event: TriggerEvent) => void): void {
    // Global hotkey registration arrives with the native backend.
    void handler;
  }

  /** Introspect specs (used by tests and docs). */
  static specs(): CommandSpec[] {
    return SPECS;
  }

  private args(args: Args, key: string): string | undefined {
    return args[key]?.kind === 'string' ? args[key].value : undefined;
  }
}
