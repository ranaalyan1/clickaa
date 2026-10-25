/**
 * Runtime contract + registry. The core plans ONLY against snapshots that
 * runtimes register here — the same pattern as Muse's HatchCapabilitiesSnapshot:
 * a device can't be asked to do what it hasn't advertised it can do.
 */

import type {
  ApprovalDecision,
  ApprovalRequest,
  Args,
  CapabilitySnapshot,
  CommandResult,
  CommandSpec,
  InvokeCommand,
  TriggerEvent,
} from './types.js';
import type { ModelToolSchema } from './model.js';

export interface Runtime {
  readonly runtimeId: string;
  snapshot(): Promise<CapabilitySnapshot>;
  invoke(cmd: InvokeCommand): Promise<CommandResult>;
  /** Subscribe to proactive triggers (optional). */
  onTrigger?(handler: (event: TriggerEvent) => void): void;
}

export function specToToolSchema(spec: CommandSpec): ModelToolSchema {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const arg of spec.args) {
    switch (arg.type) {
      case 'number':
        properties[arg.name] = { type: 'number', description: arg.description };
        break;
      case 'boolean':
        properties[arg.name] = { type: 'boolean', description: arg.description };
        break;
      case 'enum':
        properties[arg.name] = { type: 'string', enum: arg.enumValues ?? [], description: arg.description };
        break;
      case 'image':
        properties[arg.name] = { type: 'string', description: arg.description + ' (base64)' };
        break;
      default:
        properties[arg.name] = { type: 'string', description: arg.description };
    }
    if (arg.required) required.push(arg.name);
  }
  return {
    type: 'function',
    function: {
      name: spec.id,
      description: spec.description,
      parameters: { type: 'object', properties, ...(required.length ? { required } : {}) },
    },
  };
}

export class RuntimeRegistry {
  private runtimes = new Map<string, Runtime>();
  private specs = new Map<string, { spec: CommandSpec; runtime: Runtime }>();

  async register(runtime: Runtime): Promise<CapabilitySnapshot> {
    this.runtimes.set(runtime.runtimeId, runtime);
    const snap = await runtime.snapshot();
    for (const spec of snap.commands) {
      this.specs.set(spec.id, { spec, runtime });
    }
    runtime.onTrigger?.((event) => this.triggerHandler?.(event));
    return snap;
  }

  get(commandId: string): { spec: CommandSpec; runtime: Runtime } | undefined {
    return this.specs.get(commandId);
  }

  allSpecs(): CommandSpec[] {
    return [...this.specs.values()].map((s) => s.spec);
  }

  toolSchemas(): ModelToolSchema[] {
    return this.allSpecs().map(specToToolSchema);
  }

  onTriggerEvent(handler: (event: TriggerEvent) => void): void {
    this.triggerHandler = handler;
  }

  private triggerHandler?: (event: TriggerEvent) => void;
}
