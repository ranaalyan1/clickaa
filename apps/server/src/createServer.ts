/**
 * Clickaa UI server — bridges the agent core to the Clicky-style panel.
 * Plain node:http, zero deps: static UI + REST + SSE.
 *
 * The UI subscribes to /api/events (SSE): assistant messages, command
 * results, and approval requests arrive live. Approvals resolve through
 * /api/approvals/:id — the HITL engine's ask-flow, but click to approve.
 */

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Agent, ExecutorEvents } from '@clickaa/core';
import type { ApprovalDecision, ApprovalRequest } from '@clickaa/core';

interface SseClient extends http.ServerResponse {
  writeSse(event: string, data: unknown): void;
}

export interface PendingApproval {
  request: ApprovalRequest;
  resolve: (d: ApprovalDecision) => void;
}

/** Shared bus between the agent's events and the UI server. */
export interface UiBridge {
  pending: Map<string, PendingApproval>;
  broadcast(event: string, data: unknown): void;
}

export function createUiBridge(): UiBridge {
  const clients = new Set<SseClient>();
  return {
    pending: new Map(),
    broadcast(event, data) {
      for (const client of clients) client.writeSse(event, data);
    },
    /** @internal */ addClient(c: SseClient): void {
      clients.add(c);
    },
    /** @internal */ removeClient(c: SseClient): void {
      clients.delete(c);
    },
  } as UiBridge & { addClient(c: SseClient): void; removeClient(c: SseClient): void };
}

/** Wire the agent's executor events to the UI bridge. */
export function agentEventsFor(bridge: UiBridge): ExecutorEvents {
  return {
    onAssistantMessage(content) {
      if (content) bridge.broadcast('assistant', { content });
    },
    onCommandResult(ok, summary) {
      bridge.broadcast('result', { ok, summary });
    },
    onApprovalRequest(request) {
      return new Promise<ApprovalDecision>((resolve) => {
        bridge.pending.set(request.requestId, { request, resolve });
        bridge.broadcast('approval', request);
      });
    },
  };
}

export interface ClickaaServerOptions {
  agent: Agent;
  webRoot: string;
  bridge: UiBridge;
}

export function createClickaaServer(opts: ClickaaServerOptions): http.Server {
  const { agent, webRoot, bridge } = opts;
  const internalBridge = bridge as UiBridge & {
    addClient(c: SseClient): void;
    removeClient(c: SseClient): void;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const client = res as SseClient;
        client.writeSse = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        internalBridge.addClient(client);
        req.on('close', () => internalBridge.removeClient(client));
        client.writeSse('hello', { ok: true });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/capabilities') {
        await agent.start();
        return json(res, 200, { capabilities: summarizeCapabilities(agent) });
      }

      if (req.method === 'GET' && url.pathname === '/api/pending') {
        return json(res, 200, {
          approvals: [...bridge.pending.values()].map((p) => p.request),
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/chat') {
        const body = await readJson(req);
        const text = typeof body?.text === 'string' ? body.text : '';
        if (!text.trim()) return json(res, 400, { error: 'text required' });
        const reply = await agent.send(text);
        return json(res, 200, { reply });
      }

      if (req.method === 'POST' && url.pathname.startsWith('/api/approvals/')) {
        const requestId = url.pathname.split('/')[3];
        const body = await readJson(req);
        const approval = bridge.pending.get(requestId);
        if (!approval) return json(res, 404, { error: 'no such approval request' });
        bridge.pending.delete(requestId);
        const approved = body?.approved === true;
        const decision: ApprovalDecision = {
          requestId,
          invocationId: approval.request.invocationId,
          approved,
          scope: body?.scope === 'always' ? `always:${approval.request.commandId}` : 'once',
          decidedBy: typeof body?.decidedBy === 'string' ? body.decidedBy : 'web-ui',
          decidedAtMs: Date.now(),
        };
        approval.resolve(decision);
        bridge.broadcast('approval:resolved', { requestId, approved, scope: decision.scope });
        return json(res, 200, { ok: true });
      }

      return serveStatic(url.pathname, res);
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
    }
  });

  return server;

  function serveStatic(pathname: string, res: http.ServerResponse): void {
    const clean = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.join(webRoot, clean);
    if (!file.startsWith(webRoot)) return json(res, 403, { error: 'forbidden' });
    fs.readFile(file, (err, data) => {
      if (err) {
        fs.readFile(path.join(webRoot, 'index.html'), (err2, index) => {
          if (err2) return json(res, 404, { error: 'not found' });
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end(index);
        });
        return;
      }
      res.writeHead(200, { 'content-type': mimeFor(file) });
      res.end(data);
    });
  }
}

function summarizeCapabilities(agent: Agent): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const msg of agent.history()) {
    if (msg.role === 'system' && msg.content.startsWith('Connected runtimes:')) {
      for (const line of msg.content.split('\n').slice(1)) {
        const idx = line.indexOf(':');
        if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().split(',').map((s) => s.trim());
      }
    }
  }
  return out;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data) as Record<string, unknown>);
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function mimeFor(file: string): string {
  return MIME[path.extname(file)] ?? 'application/octet-stream';
}
