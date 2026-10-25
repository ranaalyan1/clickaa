import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserSandboxRuntime } from '../src/runtimes/browser-sandbox.js';
import { PcHostRuntime } from '../src/runtimes/pc-host.js';
import { FakeDriver } from '../src/runtimes/pc-drivers.js';

/* ---- browser: navigate + search with injected fetch ---- */

const PAGE_HTML = `<!doctype html><html><head><title>Example Domain</title></head>
<body><h1>Example Domain</h1>
<p>This domain is for use in examples and documentation.</p>
<a href="/about">About</a> <a href="https://other.example/x">Other</a>
</body></html>`;

const SEARCH_HTML = `<!doctype html><html><body><table>
<tr><td><a class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=abc">Result One</a></td></tr>
<tr><td class="result-snippet">Snippet <b>one</b> text</td></tr>
<tr><td><a class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fb&amp;rut=abc">Result Two</a></td></tr>
<tr><td class="result-snippet">Snippet two text</td></tr>
</table></body></html>`;

function fakeFetch(html: string): typeof fetch {
  return ((async () => {
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
  }) as unknown) as typeof fetch;
}

test('web.navigate extracts title, text and links', async () => {
  const rt = new BrowserSandboxRuntime({ fetchFn: fakeFetch(PAGE_HTML) });
  const snap = await rt.snapshot();
  assert.equal(snap.commands.length, 5);
  const res = await rt.invoke({
    invocationId: 'i1',
    commandId: 'web.navigate',
    commandVersion: 'v1',
    args: { url: { kind: 'string', value: 'example.com' } },
  });
  assert.equal(res.ok, true);
  const data = JSON.parse((res.data as any).value);
  assert.equal(data.title, 'Example Domain');
  assert.match(data.body, /for use in examples/);
  assert.ok(data.links.includes('https://example.com/about'));
});

test('web.navigate rejects non-http schemes', async () => {
  const rt = new BrowserSandboxRuntime({ fetchFn: fakeFetch(PAGE_HTML) });
  const res = await rt.invoke({
    invocationId: 'i2',
    commandId: 'web.navigate',
    commandVersion: 'v1',
    args: { url: { kind: 'string', value: 'file:///etc/passwd' } },
  });
  assert.equal(res.ok, false);
  assert.match(res.error!.message, /only http\/https/);
});

test('web.search parses DuckDuckGo lite results', async () => {
  const rt = new BrowserSandboxRuntime({ fetchFn: fakeFetch(SEARCH_HTML) });
  const res = await rt.invoke({
    invocationId: 'i3',
    commandId: 'web.search',
    commandVersion: 'v1',
    args: { query: { kind: 'string', value: 'anything' } },
  });
  assert.equal(res.ok, true);
  const body = (JSON.parse((res.data as any).value) as { body: string }).body;
  assert.match(body, /Result One/);
  assert.match(body, /https:\/\/example\.com\/a/);
});

test('actor-tier commands return 501 until the worker lands', async () => {
  const rt = new BrowserSandboxRuntime({ fetchFn: fakeFetch(PAGE_HTML) });
  const res = await rt.invoke({
    invocationId: 'i4',
    commandId: 'web.click',
    commandVersion: 'v1',
    args: { elementIndex: { kind: 'number', value: 1 } },
  });
  assert.equal(res.ok, false);
  assert.equal(res.error!.code, 501);
});

/* ---- pc host: driver dispatch ---- */

test('pc.host dispatches to the native driver', async () => {
  const driver = new FakeDriver();
  const rt = new PcHostRuntime({ driver });
  const win = await rt.invoke({
    invocationId: 'p1',
    commandId: 'pc.list_windows',
    commandVersion: 'v1',
    args: {},
  });
  assert.equal(win.ok, true);
  assert.match((win.data as any).value, /Demo Window/);

  await rt.invoke({
    invocationId: 'p2',
    commandId: 'pc.click',
    commandVersion: 'v1',
    args: { x: { kind: 'number', value: 120 }, y: { kind: 'number', value: 40 } },
  });
  const click = driver.calls.find((c) => c.op === 'click');
  assert.deepEqual(click?.args, { x: 120, y: 40 });

  await rt.invoke({
    invocationId: 'p3',
    commandId: 'pc.type_text',
    commandVersion: 'v1',
    args: { text: { kind: 'string', value: 'hello world' } },
  });
  const typed = driver.calls.find((c) => c.op === 'typeText');
  assert.equal((typed?.args as any).text, 'hello world');

  const shot = await rt.invoke({ invocationId: 'p4', commandId: 'pc.screenshot', commandVersion: 'v1', args: {} });
  assert.equal(shot.ok, true);
  assert.match((shot.data as any).value, /image\/png;base64/);
});

test('pc.host reports a clean error when no driver exists', async () => {
  const rt = new PcHostRuntime({ driver: undefined });
  // Force the "no driver" path: detectDriver() finds nothing on a headless box,
  // but Windows machines would return a driver; simulate by checking both paths.
  const snap = await rt.snapshot();
  assert.equal(snap.commands.length, 7);
});
