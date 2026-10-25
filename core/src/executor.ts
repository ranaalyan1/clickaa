/**
 * Executor — the agent loop. Chat in, tool calls out, HITL gates in front
 * of anything sensitive, results back to the model until done.
 */

import type { ApprovalDecision, ApprovalRequest, Args, ArgValue, InvokeCommand, TriggerEvent } from './types.js';
import type { ChatMessage, ModelAdapter } from './model.js';
import type { RuntimeRegistry } from './registry.js';
import type { HitlEngine } from './hitl.js';

export interface ExecutorEvents {
  onApprovalRequest?: (req: ApprovalRequest) => Promise<ApprovalDecision>;
  onAssistantMessage?: (content: string) => void;
  onCommandResult?: (ok: boolean, summary: string) => void;
}

export class Executor {
  constructor(
    private model: ModelAdapter,
    private registry: RuntimeRegistry,
    private hitl: HitlEngine,
    private events: ExecutorEvents,
  ) {}

  /**
   * Run a user turn to completion: model <-> tools until the model answers
   * without tool calls. Sensitive commands pause for human approval.
   */
  async run(history: ChatMessage[], maxSteps = 12): Promise<ChatMessage[]> {
    const messages = [...history];
    for (let step = 0; step < maxSteps; step++) {
      const reply = await this.model.chat(messages, this.registry.toolSchemas());

      if (reply.content && this.events.onAssistantMessage) {
        this.events.onAssistantMessage(reply.content);
      }

      if (reply.toolCalls.length === 0) {
        messages.push({ role: 'assistant', content: reply.content });
        return messages;
      }

      messages.push({ role: 'assistant', content: reply.content, toolCalls: reply.toolCalls });

      for (const call of reply.toolCalls) {
        const result = await this.dispatchTool(call.id, call.name, call.argumentsJson);
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          content: result,
        });
      }
    }
    messages.push({
      role: 'assistant',
      content: 'I hit my step limit for this turn; some steps may be incomplete.',
    });
    return messages;
  }

  private async dispatchTool(callId: string, commandId: string, argsJson: string): Promise<string> {
    const entry = this.registry.get(commandId);
    if (!entry) {
      return JSON.stringify({ error: `unknown command: ${commandId}` });
    }

    let args: Args;
    try {
      const raw = JSON.parse(argsJson || '{}') as Record<string, string | number | boolean>;
      args = coerceArgs(entry.spec, raw);
    } catch {
      return JSON.stringify({ error: 'arguments were not valid JSON' });
    }

    const invocation: InvokeCommand = {
      invocationId: crypto.randomUUID(),
      commandId: commandId,
      commandVersion: entry.spec.version,
      args,
    };

    // HITL gate — Muse-style approval before sensitive execution.
    const verdict = this.hitl.gate(entry.spec, invocation.invocationId, args);
    if (verdict.action === 'refuse') {
      return JSON.stringify({ error: `refused: ${verdict.reason}` });
    }
    if (verdict.action === 'ask') {
      if (!this.events.onApprovalRequest) {
        return JSON.stringify({ error: 'approval required but no approver connected' });
      }
      const decision = await this.events.onApprovalRequest(verdict.request);
      this.hitl.record(commandId, decision);
      if (!decision.approved) {
        return JSON.stringify({ error: 'the user declined this action' });
      }
      invocation.approvedBy = decision.decidedBy;
    } else {
      invocation.approvedBy = verdict.approvedBy;
    }

    const result = await entry.runtime.invoke(invocation);
    this.events.onCommandResult?.(result.ok, result.ok ? brief(result.data) : result.error?.message ?? 'failed');
    return JSON.stringify(result.ok ? { result: plain(result.data), cards: result.cards ?? [] } : { error: result.error?.message });
  }

  /** Handle a proactive trigger: hand it to the model as a new turn. */
  async handleTrigger(event: TriggerEvent, systemPrompt: string): Promise<void> {
    // Triggered turns are a follow-up: build a fresh history with the event.
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `A device event fired: ${event.triggerId}. Payload: ${JSON.stringify(event.payload)}` },
    ];
    await this.run(messages);
  }
}

function coerceArgs(spec: { args: { name: string; type: string }[] }, raw: Record<string, string | number | boolean>): Args {
  const out: Args = {};
  for (const arg of spec.args) {
    const v = raw[arg.name];
    if (v === undefined || v === null) continue;
    switch (arg.type) {
      case 'number':
        out[arg.name] = { kind: 'number', value: Number(v) };
        break;
      case 'boolean':
        out[arg.name] = { kind: 'boolean', value: Boolean(v) };
        break;
      case 'image':
        out[arg.name] = { kind: 'image', value: String(v) };
        break;
      default:
        out[arg.name] = { kind: 'string', value: String(v) };
    }
  }
  return out;
}

function plain(v: ArgValue | undefined): unknown {
  return v ? v.value : null;
}

function brief(v: ArgValue | undefined): string {
  return v ? String(v.value).slice(0, 120) : 'ok';
}
