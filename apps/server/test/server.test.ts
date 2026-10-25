import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';

import { createAgent } from '@clickaa/core';
import type { ChatMessage, ModelAdapter, ModelReply, ModelToolSchema } from '@clickaa/core';
import { agentEventsFor, createClickaaServer, createUiBridge } from '../src/createServer.js';

/** Scripted model: one tool call then a plain answer. */
class ScriptedModel implements ModelAdapter {
  private step = 0;
  constructor(private finalText: string) {}
  async chat(_m: ChatMessage[], _t: ModelToolSchema[]): Promise<ModelReply> {
    if (this.step++ === 0) {
      return {
        content: '',
        toolCalls: [{ id: 'call-1', name: 'test.danger', argumentsJson: '{}' }],
      };
    }
    return { content: this.finalText, toolCalls: [] };
  }
}

class DangerRuntime {
  readonly runtimeId = 'test-runtime';
  public invoked = 0;
  async snapshot() {
    return {
      runtimeId: this.runtimeId,
      runtimeKind: 'pc-host',
      protocolVersion: '1',
      commands: [
        {
          id: 'test.danger',
          version: 'v1',
          title: 'Danger',
          description: 'Must be approved',
          args: [],
          defaultApproval: 'ASK_ALWAYS',
        },
      ],
      dataSources: [],
      triggers: [],
    };
  }
  async invoke() {
    this.invoked += 1;
    return { invocationId: 'x', ok: true, data: { kind: 'string', value: 'done' } };
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

function request(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      { host: 'localhost', port, method, path, headers: payload ? { 'content-type': 'application/json' } : {} },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, json: JSON.parse(data || '{}') });
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function sseWaitFor(port: number, event: string, timeoutMs = 4000): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port, path: '/api/events' }, (res) => {
      let buf = '';
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error(`timeout waiting for ${event}`));
      }, timeoutMs);
      res.on('data', (chunk) => {
        buf += chunk;
        const marker = `event: ${event}\ndata: `;
        const at = buf.indexOf(marker);
        if (at !== -1) {
          const rest = buf.slice(at + marker.length);
          const end = rest.indexOf('\n\n');
          if (end !== -1) {
            clearTimeout(timer);
            req.destroy();
            resolve(JSON.parse(rest.slice(0, end)));
          }
        }
      });
    });
    req.on('error', reject);
  });
}

const WEB_ROOT = path.join(import.meta.dirname, '..', '..', '..', 'web');

test('server serves chat, capabilities and the Clicky panel UI', async () => {
  const bridge = createUiBridge();
  const agent = createAgent({
    model: new ScriptedModel('all done'),
    runtimes: [new DangerRuntime() as any],
    events: agentEventsFor(bridge),
  });
  const server = createClickaaServer({ agent, webRoot: WEB_ROOT, bridge });
  const port = await freePort();
  await new Promise<void>((r) => server.listen(port, r));

  try {
    // static UI
    const ui = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      http.get({ host: 'localhost', port, path: '/' }, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: d }));
      }).on('error', reject);
    });
    assert.equal(ui.status, 200);
    assert.match(ui.body, /Clickaa/);

    // capabilities
    const caps = await request(port, 'GET', '/api/capabilities');
    assert.ok(Object.keys(caps.json.capabilities)[0].startsWith('test-runtime'));

    // chat triggers an approval that we resolve via the API + SSE
    const approvalEvent = sseWaitFor(port, 'approval');
    const chatPromise = request(port, 'POST', '/api/chat', { text: 'do the danger' });
    const approval = await approvalEvent;
    assert.equal(approval.commandId, 'test.danger');

    const decided = await request(port, 'POST', `/api/approvals/${approval.requestId}`, { approved: true, scope: 'once' });
    assert.equal(decided.json.ok, true);

    const chat = await chatPromise;
    assert.equal(chat.json.reply, 'all done');

    // unknown approval id -> 404
    const missing = await request(port, 'POST', '/api/approvals/nope', { approved: true });
    assert.equal(missing.status, 404);
  } finally {
    server.close();
  }
});

test('pending endpoint lists unresolved approvals', async () => {
  const bridge = createUiBridge();
  const agent = createAgent({
    model: new ScriptedModel('ok'),
    runtimes: [new DangerRuntime() as any],
    events: agentEventsFor(bridge),
  });
  const server = createClickaaServer({ agent, webRoot: WEB_ROOT, bridge });
  const port = await freePort();
  await new Promise<void>((r) => server.listen(port, r));
  try {
    const chatPromise = request(port, 'POST', '/api/chat', { text: 'go' });
    await new Promise((r) => setTimeout(r, 150));
    const pending = await request(port, 'GET', '/api/pending');
    assert.equal(pending.json.approvals.length, 1);
    assert.equal(pending.json.approvals[0].commandId, 'test.danger');
    const req = pending.json.approvals[0];
    await request(port, 'POST', `/api/approvals/${req.requestId}`, { approved: false });
    const chat = await chatPromise;
    assert.equal(chat.json.reply, 'ok');
    const runtime = agent // ensure command never ran
    const after = await request(port, 'GET', '/api/pending');
    assert.equal(after.json.approvals.length, 0);
  } finally {
    server.close();
  }
});
