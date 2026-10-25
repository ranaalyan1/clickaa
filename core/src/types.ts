/**
 * Clickaa core protocol types — TS mirror of protocol/clickaa/v1/*.proto.
 * Kept hand-rolled (JSON on the wire) until protobuf codegen lands; the
 * .proto files are the source of truth.
 */

export type ArgType = 'string' | 'number' | 'boolean' | 'enum' | 'image';

export interface ArgSpec {
  name: string;
  type: ArgType;
  description: string;
  enumValues?: string[];
  required: boolean;
}

export type ApprovalMode = 'AUTO' | 'ASK_ONCE' | 'ASK_ALWAYS' | 'NEVER';

export interface CommandSpec {
  id: string;
  version: string;
  title: string;
  description: string;
  args: ArgSpec[];
  defaultApproval: ApprovalMode;
  requiresPermissions?: string[];
}

export interface DataSourceSpec {
  id: string;
  version: string;
  description: string;
  supportsBackfill: boolean;
}

export interface TriggerSpec {
  id: string;
  version: string;
  description: string;
}

export interface CapabilitySnapshot {
  runtimeId: string;
  runtimeKind: 'pc-host' | 'android' | 'sandbox-browser' | 'connector' | (string & {});
  protocolVersion: string;
  commands: CommandSpec[];
  dataSources: DataSourceSpec[];
  triggers: TriggerSpec[];
}

export type ArgValue =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'image'; value: string }; // base64 ref

export type Args = Record<string, ArgValue>;

export interface InvokeCommand {
  invocationId: string;
  commandId: string;
  commandVersion: string;
  args: Args;
  approvedBy?: string;
}

export interface Card {
  kind: string;
  json: string;
}

export interface CommandResult {
  invocationId: string;
  ok: boolean;
  data?: ArgValue;
  error?: { code: number; message: string; retryable: boolean };
  cards?: Card[];
}

export interface ApprovalRequest {
  requestId: string;
  invocationId: string;
  commandId: string;
  summary: string;
  risk: string;
  argSummaries: { name: string; preview: string; sensitive: boolean }[];
  scope: string;
}

export interface ApprovalDecision {
  requestId: string;
  invocationId: string;
  approved: boolean;
  scope: 'once' | 'session' | `always:${string}` | string;
  decidedBy: string;
  decidedAtMs: number;
}

export interface TriggerEvent {
  triggerId: string;
  payload: unknown;
  occurredAtMs: number;
  backfill?: { cursor: string; hasMore: boolean };
}

export interface StreamFrame {
  kind: 'viewport' | 'a11y-diff' | 'audio' | 'log' | (string & {});
  data: string; // base64
  atMs: number;
}

export interface ControlCommand {
  action: 'takeover' | 'release' | 'cancel' | 'pause' | (string & {});
  taskId: string;
}
