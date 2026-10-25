import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent, HitlEngine, summarizeArgs } from '../src/index.js';
/** Scripted model: first turn asks for a tool, second turn answers. */
class ScriptedModel {
    toolName;
    finalText;
    seen = [];
    step = 0;
    constructor(toolName, finalText) {
        this.toolName = toolName;
        this.finalText = finalText;
    }
    async chat(_messages, tools) {
        this.seen = tools;
        if (this.step++ === 0) {
            return {
                content: '',
                toolCalls: [{ id: 'call-1', name: this.toolName, argumentsJson: '{}' }],
            };
        }
        return { content: this.finalText, toolCalls: [] };
    }
}
class EchoRuntime {
    runtimeId = 'test-runtime';
    invoked = [];
    async snapshot() {
        return {
            runtimeId: this.runtimeId,
            runtimeKind: 'pc-host',
            protocolVersion: '1',
            commands: [
                {
                    id: 'test.echo',
                    version: 'v1',
                    title: 'Echo',
                    description: 'Echoes text back',
                    args: [{ name: 'text', type: 'string', description: 'text', required: true }],
                    defaultApproval: 'AUTO',
                },
                {
                    id: 'test.danger',
                    version: 'v1',
                    title: 'Danger',
                    description: 'A sensitive action that must ask first',
                    args: [],
                    defaultApproval: 'ASK_ALWAYS',
                },
            ],
            dataSources: [],
            triggers: [],
        };
    }
    async invoke(cmd) {
        this.invoked.push(cmd);
        return { invocationId: cmd.invocationId, ok: true, data: { kind: 'string', value: 'echo' } };
    }
}
test('agent runs a full tool loop and returns the final text', async () => {
    const runtime = new EchoRuntime();
    const agent = createAgent({
        model: new ScriptedModel('test.echo', 'done!'),
        runtimes: [runtime],
    });
    await agent.start();
    const reply = await agent.send('say something');
    assert.equal(reply, 'done!');
    assert.equal(runtime.invoked.length, 1);
    assert.equal(runtime.invoked[0].commandId, 'test.echo');
});
test('unknown tools are reported to the model instead of crashing', async () => {
    const agent = createAgent({
        model: new ScriptedModel('test.does_not_exist', 'recovered'),
        runtimes: [new EchoRuntime()],
    });
    await agent.start();
    const reply = await agent.send('do a thing');
    assert.equal(reply, 'recovered');
});
test('ASK_ALWAYS commands pause for approval and run when approved', async () => {
    const runtime = new EchoRuntime();
    const requests = [];
    const agent = createAgent({
        model: new ScriptedModel('test.danger', 'did it'),
        runtimes: [runtime],
        events: {
            onApprovalRequest: async (req) => {
                requests.push(req);
                const decision = {
                    requestId: req.requestId,
                    invocationId: req.invocationId,
                    approved: true,
                    scope: 'once',
                    decidedBy: 'tester',
                    decidedAtMs: Date.now(),
                };
                return decision;
            },
        },
    });
    await agent.start();
    await agent.send('do the danger');
    assert.equal(requests.length, 1, 'approval was requested');
    assert.equal(requests[0].commandId, 'test.danger');
    assert.equal(runtime.invoked.length, 1);
    assert.equal(runtime.invoked[0].approvedBy, 'tester');
});
test('declined approvals block execution', async () => {
    const runtime = new EchoRuntime();
    const agent = createAgent({
        model: new ScriptedModel('test.danger', 'ok, I did not do it'),
        runtimes: [runtime],
        events: {
            onApprovalRequest: async (req) => ({
                requestId: req.requestId,
                invocationId: req.invocationId,
                approved: false,
                scope: 'once',
                decidedBy: 'tester',
                decidedAtMs: Date.now(),
            }),
        },
    });
    await agent.start();
    await agent.send('do the danger');
    assert.equal(runtime.invoked.length, 0, 'command must not run when declined');
});
test('sensitive args are redacted in approval summaries', () => {
    const summary = summarizeArgs({ password: { kind: 'string', value: 'hunter2' } });
    assert.equal(summary[0].sensitive, true);
    assert.notEqual(summary[0].preview, 'hunter2');
});
test('hitl gate honors prior always-grants for ASK_ONCE', async () => {
    const runtime = new EchoRuntime();
    const engine = new HitlEngine();
    // Pre-grant a once-command.
    const snap = await runtime.snapshot();
    const once = { ...snap.commands[0], id: 'test.once', defaultApproval: 'ASK_ONCE' };
    const verdict = engine.gate(once, 'inv-1', {});
    assert.equal(verdict.action, 'ask');
    if (verdict.action === 'ask') {
        engine.record('test.once', {
            requestId: verdict.request.requestId,
            invocationId: 'inv-1',
            approved: true,
            scope: 'always:test.once',
            decidedBy: 'tester',
            decidedAtMs: Date.now(),
        });
    }
    const again = engine.gate(once, 'inv-2', {});
    assert.equal(again.action, 'run');
});
