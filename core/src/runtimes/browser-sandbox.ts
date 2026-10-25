/**
 * Browser sandbox runtime — the Grok Bot / Muse pattern: web work happens
 * away from the host. This implementation is the "reader tier": real
 * fetch + search + text extraction with zero browser dependencies, safe to
 * run anywhere. The "actor tier" (click/type inside a containerized
 * Playwright worker with live view + takeover) is the next milestone;
 * its command specs already exist here so the model-facing surface is stable.
 */

import type { CapabilitySnapshot, CommandSpec, InvokeCommand, CommandResult, Args } from '../types.js';
import type { Runtime } from '../registry.js';

const SPECS: CommandSpec[] = [
  {
    id: 'web.navigate',
    version: 'v1',
    title: 'Open a URL and read the page',
    description: 'Fetches a URL (http/https only) and returns readable text, title and links.',
    args: [{ name: 'url', type: 'string', description: 'URL to open', required: true }],
    defaultApproval: 'AUTO',
  },
  {
    id: 'web.click',
    version: 'v1',
    title: 'Click an element in the sandboxed browser',
    description: 'Actor tier: clicks by index inside the containerized browser worker (landing next milestone).',
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
    description: 'Actor tier: types text into a focused field in the containerized browser worker.',
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
    description: 'Actor tier: returns the current page as a diffed accessibility tree (Dots pattern).',
    args: [],
    defaultApproval: 'AUTO',
  },
  {
    id: 'web.search',
    version: 'v1',
    title: 'Search the web',
    description: 'Runs a web search and returns top results with titles, urls and snippets.',
    args: [{ name: 'query', type: 'string', description: 'Search query', required: true }],
    defaultApproval: 'AUTO',
  },
];

export interface BrowserSandboxOptions {
  runtimeId?: string;
  searchEndpoint?: string; // HTML endpoint; default DuckDuckGo lite
  fetchFn?: typeof fetch;   // injectable for tests
  maxBytes?: number;
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export class BrowserSandboxRuntime implements Runtime {
  readonly runtimeId: string;
  private searchEndpoint: string;
  private fetchFn: typeof fetch;
  private maxBytes: number;

  constructor(opts: BrowserSandboxOptions = {}) {
    this.runtimeId = opts.runtimeId ?? 'sandbox-browser';
    this.searchEndpoint = opts.searchEndpoint ?? 'https://lite.duckduckgo.com/lite/?q=';
    this.fetchFn = opts.fetchFn ?? fetch;
    this.maxBytes = opts.maxBytes ?? 300_000;
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
    try {
      switch (cmd.commandId) {
        case 'web.navigate': {
          const url = str(cmd.args.url) ?? '';
          const page = await this.navigate(url);
          return ok(cmd, page.title, page.text, { links: page.links.slice(0, 25) });
        }
        case 'web.search': {
          const query = str(cmd.args.query) ?? '';
          const hits = await this.search(query);
          return ok(cmd, `search: ${query}`, hits.map((h) => `${h.title}\n${h.url}\n${h.snippet}`).join('\n\n'));
        }
        case 'web.click':
        case 'web.type':
        case 'web.state':
          return {
            invocationId: cmd.invocationId,
            ok: false,
            error: {
              code: 501,
              message: `${cmd.commandId} is actor-tier: it lands with the containerized browser worker (next milestone)`,
              retryable: false,
            },
          };
        default:
          throw new Error(`unknown web command: ${cmd.commandId}`);
      }
    } catch (err) {
      return {
        invocationId: cmd.invocationId,
        ok: false,
        error: { code: 500, message: (err as Error).message, retryable: true },
      };
    }
  }

  static specs(): CommandSpec[] {
    return SPECS;
  }

  /* ---------------- fetch + extraction ---------------- */

  private async navigate(rawUrl: string): Promise<{ title: string; text: string; links: string[] }> {
    const url = normalizeUrl(rawUrl);
    const html = await this.get(url);
    return extractPage(html, url);
  }

  async search(query: string): Promise<SearchHit[]> {
    const html = await this.get(this.searchEndpoint + encodeURIComponent(query));
    return extractResults(html);
  }

  private async get(url: string): Promise<string> {
    const res = await this.fetchFn(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; clickaa/0.1; +https://github.com/ranaalyan1/clickaa)',
        accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`request failed: ${res.status} ${url}`);
    const text = await res.text();
    if (text.length > this.maxBytes) return text.slice(0, this.maxBytes);
    return text;
  }
}

function ok(cmd: InvokeCommand, title: string, body: string, extra?: Record<string, unknown>): CommandResult {
  const limit = 6000;
  return {
    invocationId: cmd.invocationId,
    ok: true,
    data: {
      kind: 'string',
      value: JSON.stringify({ title, body: body.slice(0, limit), ...(extra ?? {}) }),
    },
  };
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    parsed = new URL('https://' + trimmed);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('only http/https URLs are allowed');
  }
  return parsed.toString();
}

/* ---------------- HTML → text (no deps) ---------------- */

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPage(html: string, url: string): { title: string; text: string; links: string[] } {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? url);
  const main = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const text = stripTags(main);
  const links: string[] = [];
  const linkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    try {
      links.push(new URL(decodeEntities(m[1]), url).toString());
    } catch {
      /* skip malformed hrefs */
    }
  }
  return { title, text, links };
}

/** Works for DuckDuckGo lite/html result listings (quote- and order-agnostic). */
function extractResults(html: string): SearchHit[] {
  const links: { url: string; title: string }[] = [];
  const snippets: string[] = [];
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const attrs = m[1] ?? '';
    if (!/class\s*=\s*["']result-link["']/i.test(attrs)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!href) continue;
    links.push({ url: cleanDdgUrl(decodeEntities(href)), title: stripTags(m[2] ?? '') });
  }
  const snipRe = /class\s*=\s*["']result-snippet["']\s*>([\s\S]*?)<\/td>/gi;
  while ((m = snipRe.exec(html)) !== null) {
    snippets.push(stripTags(m[1] ?? ''));
  }
  const hits: SearchHit[] = links.map((l, i) => ({ ...l, snippet: snippets[i] ?? '' }));
  return hits.slice(0, 8);
}

function cleanDdgUrl(href: string): string {
  const uddg = /uddg=([^&]+)/.exec(href)?.[1];
  if (uddg) return decodeURIComponent(uddg);
  return href.startsWith('//') ? 'https:' + href : href;
}

function str(v: Args[string] | undefined): string | undefined {
  return v?.kind === 'string' ? v.value : undefined;
}
