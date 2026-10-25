/**
 * HITL approval engine — every sensitive command passes through a gate
 * before execution. Grants are scoped and remembered.
 *
 * Pattern credit: Muse NodeHitl (approval modes + scoped grants) and the
 * Dots computer-use confirmation policy (user-authored intent is valid
 * intent; third-party content never counts as permission).
 */

import type { ApprovalDecision, ApprovalMode, ApprovalRequest, Args, CommandSpec } from './types.js';

export interface ApprovalStore {
  findGrant(commandId: string, scope: string): ApprovalDecision | undefined;
  saveGrant(commandId: string, decision: ApprovalDecision): void;
}

export class InMemoryApprovalStore implements ApprovalStore {
  private grants = new Map<string, ApprovalDecision>();

  findGrant(commandId: string, scope: string): ApprovalDecision | undefined {
    return this.grants.get(`${commandId}::${scope}`);
  }

  saveGrant(commandId: string, decision: ApprovalDecision): void {
    this.grants.set(`${commandId}::${decision.scope}`, decision);
  }

  clear(): void {
    this.grants.clear();
  }
}

export interface Approver {
  /** Ask the human. Resolves with their decision. */
  request(req: ApprovalRequest): Promise<ApprovalDecision>;
}

/** Redact obviously sensitive values before showing them to anyone. */
export function summarizeArgs(args: Args): { name: string; preview: string; sensitive: boolean }[] {
  const sensitiveNames = /pass|secret|otp|token|key|credential|ssn|card/i;
  return Object.entries(args).map(([name, v]) => {
    const raw = v.kind === 'image' ? `<image ${v.value.length}b>` : String(v.value);
    return {
      name,
      preview: sensitiveNames.test(name) ? '••••••' : raw.slice(0, 200),
      sensitive: sensitiveNames.test(name),
    };
  });
}

export type ApprovalVerdict =
  | { action: 'run'; reason: string; approvedBy?: string }
  | { action: 'ask'; request: ApprovalRequest }
  | { action: 'refuse'; reason: string };

export class HitlEngine {
  constructor(private store: ApprovalStore = new InMemoryApprovalStore()) {}

  /** Decide what happens before a command executes. */
  gate(spec: CommandSpec, invocationId: string, args: Args): ApprovalVerdict {
    switch (spec.defaultApproval) {
      case 'AUTO':
        return { action: 'run', reason: 'auto-safe' };
      case 'NEVER':
        return { action: 'refuse', reason: 'policy: this action is never allowed' };
      case 'ASK_ONCE': {
        const grant = this.store.findGrant(spec.id, `always:${spec.id}`);
        if (grant?.approved) {
          return { action: 'run', reason: 'covered by earlier grant', approvedBy: grant.decidedBy };
        }
        return { action: 'ask', request: this.buildRequest(spec, invocationId, args) };
      }
      case 'ASK_ALWAYS':
      default:
        return { action: 'ask', request: this.buildRequest(spec, invocationId, args) };
    }
  }

  buildRequest(spec: CommandSpec, invocationId: string, args: Args): ApprovalRequest {
    return {
      requestId: crypto.randomUUID(),
      invocationId,
      commandId: spec.id,
      summary: spec.title,
      risk: spec.description,
      argSummaries: summarizeArgs(args),
      scope: `always:${spec.id}`,
    };
  }

  /** Remember a decision so ASK_ONCE scopes stick. */
  record(commandId: string, decision: ApprovalDecision): void {
    if (decision.approved && decision.scope.startsWith('always:')) {
      this.store.saveGrant(commandId, decision);
    }
  }
}
