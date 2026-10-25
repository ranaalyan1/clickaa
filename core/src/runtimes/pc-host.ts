/**
 * PC host runtime — the HeyClicky/Dots actuator layer for desktops.
 *
 * Contract mirrors both RE studies: screen capture, window listing,
 * input injection (coordinate or a11y-indexed), app launch, file read.
 * Execution goes through a NativeDriver: PowerShell+.NET on Windows,
 * X11 tools on Linux, a fake driver for tests and dry runs.
 * Commands with `defaultApproval: ASK_ALWAYS` always gate first.
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
import { detectDriver, type NativeDriver } from './pc-drivers.js';

const SPECS: CommandSpec[] = [
  {
    id: 'pc.screenshot',
    version: 'v1',
    title: 'Take a screenshot of the desktop',
    description: 'Captures the screen and returns a PNG (base64).',
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
    title: 'Click on the screen',
    description: 'Clicks at a coordinate on the desktop.',
    args: [
      { name: 'x', type: 'number', description: 'X coordinate', required: true },
      { name: 'y', type: 'number', description: 'Y coordinate', required: true },
    ],
    defaultApproval: 'ASK_ALWAYS',
  },
  {
    id: 'pc.type_text',
    version: 'v1',
    title: 'Type text into the focused window',
    description: 'Injects keyboard input. NEVER use for passwords/secrets.',
    args: [{ name: 'text', type: 'string', description: 'Text to type', required: true }],
    defaultApproval: 'ASK_ALWAYS',
  },
  {
    id: 'pc.press_key',
    version: 'v1',
    title: 'Press a key chord',
    description: 'Presses a key or key chord (e.g. "ctrl+s").',
    args: [{ name: 'keys', type: 'string', description: 'Key chord, "+"-separated', required: true }],
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
    title: 'Read a file on the user machine',
    description: 'Reads a text file (truncated). Sensitive paths should be refused.',
    args: [{ name: 'path', type: 'string', description: 'Absolute file path', required: true }],
    defaultApproval: 'ASK_ALWAYS',
  },
];

export interface PcHostOptions {
  runtimeId?: string;
  /** Explicit driver; when omitted, detectDriver() probes the machine. */
  driver?: NativeDriver;
}

export class PcHostRuntime implements Runtime {
  readonly runtimeId: string;
  private driver?: NativeDriver;

  constructor(opts: PcHostOptions = {}) {
    this.runtimeId = opts.runtimeId ?? 'pc-host';
    this.driver = opts.driver;
  }

  async snapshot(): Promise<CapabilitySnapshot> {
    if (!this.driver) this.driver = await detectDriver();
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
    if (!this.driver) this.driver = await detectDriver();
    if (!this.driver) {
      return {
        invocationId: cmd.invocationId,
        ok: false,
        error: {
          code: 503,
          message: 'no native driver available on this machine (need Windows or an X11 Linux desktop)',
          retryable: false,
        },
      };
    }
    try {
      const data = await this.execute(cmd.commandId, cmd.args);
      return { invocationId: cmd.invocationId, ok: true, data: { kind: 'string', value: data } };
    } catch (err) {
      return {
        invocationId: cmd.invocationId,
        ok: false,
        error: { code: 500, message: (err as Error).message, retryable: false },
      };
    }
  }

  onTrigger(handler: (event: TriggerEvent) => void): void {
    // Global hotkey registration arrives with the native listener backend.
    void handler;
  }

  private async execute(commandId: string, args: Args): Promise<string> {
    const d = this.driver!;
    switch (commandId) {
      case 'pc.screenshot': {
        const png = await d.screenshot(str(args.windowId));
        return `image/png;base64,${png.slice(0, 64)}… (${png.length} chars)`;
      }
      case 'pc.list_windows': {
        const windows = await d.listWindows();
        return windows.map((w) => `${w.windowId}  ${w.title}  [${w.app}]`).join('\n');
      }
      case 'pc.click': {
        await d.click({ x: num(args.x), y: num(args.y) });
        return `clicked ${num(args.x)},${num(args.y)}`;
      }
      case 'pc.type_text': {
        const text = str(args.text) ?? '';
        await d.typeText('', text);
        return `typed ${text.length} chars`;
      }
      case 'pc.press_key': {
        const keys = str(args.keys) ?? '';
        await d.pressKey('', keys);
        return `pressed ${keys}`;
      }
      case 'pc.launch_app': {
        const appId = str(args.appId) ?? '';
        await d.launchApp(appId);
        return `launched ${appId}`;
      }
      case 'pc.files.read': {
        const path = str(args.path) ?? '';
        const content = await d.readFile(path, 8_000);
        return content;
      }
      default:
        throw new Error(`unknown pc command: ${commandId}`);
    }
  }

  static specs(): CommandSpec[] {
    return SPECS;
  }
}

function str(v: Args[string] | undefined): string | undefined {
  return v?.kind === 'string' ? v.value : undefined;
}

function num(v: Args[string] | undefined): number | undefined {
  return v?.kind === 'number' ? v.value : undefined;
}
