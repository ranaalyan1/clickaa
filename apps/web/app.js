/* Clickaa panel logic — SSE-driven chat + click-to-approve HITL cards. */

const els = {
  status: document.getElementById('status'),
  dot: document.querySelector('.dot'),
  chat: document.getElementById('chat'),
  approvals: document.getElementById('approvals'),
  input: document.getElementById('input'),
  send: document.getElementById('send'),
  collapse: document.getElementById('btn-collapse'),
  pin: document.getElementById('btn-pin'),
};

function addMsg(kind, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + kind;
  div.textContent = text;
  els.chat.appendChild(div);
  els.chat.scrollTop = els.chat.scrollHeight;
  return div;
}

let typingEl = null;
function setTyping(on) {
  if (on && !typingEl) {
    typingEl = document.createElement('div');
    typingEl.className = 'msg assistant typing';
    typingEl.innerHTML = '<i></i><i></i><i></i>';
    els.chat.appendChild(typingEl);
    els.chat.scrollTop = els.chat.scrollHeight;
  } else if (!on && typingEl) {
    typingEl.remove();
    typingEl = null;
  }
}

function setStatus(text, live) {
  els.status.textContent = text;
  els.dot.classList.toggle('live', !!live);
}

function approvalCard(req) {
  const card = document.createElement('div');
  card.className = 'approval';
  card.dataset.requestId = req.requestId;

  const title = document.createElement('div');
  title.className = 'a-title';
  title.textContent = 'Approve: ' + (req.summary || req.commandId);

  const args = document.createElement('div');
  args.className = 'a-args';
  for (const a of req.argSummaries || []) {
    const row = document.createElement('div');
    row.textContent = `${a.name} = ${a.preview}`;
    args.appendChild(row);
  }
  if (!req.argSummaries?.length) args.textContent = '(no arguments)';

  const actions = document.createElement('div');
  actions.className = 'a-actions';

  const mk = (label, cls, body) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = cls;
    b.onclick = () => decide(req, body, card);
    actions.appendChild(b);
  };
  mk('Yes', 'yes', { approved: true, scope: 'once' });
  mk('Always', 'always', { approved: true, scope: 'always' });
  mk('No', 'no', { approved: false, scope: 'once' });

  card.append(title, args, actions);
  els.approvals.appendChild(card);
}

async function decide(req, body, card) {
  card.remove();
  addMsg('action', `${req.summary} — ${body.approved ? 'approved' : 'declined'}`);
  try {
    await fetch(`/api/approvals/${req.requestId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    addMsg('action fail', 'approval delivery failed: ' + err.message);
  }
}

async function send() {
  const text = els.input.value.trim();
  if (!text) return;
  els.input.value = '';
  els.input.style.height = 'auto';
  addMsg('user', text);
  els.send.disabled = true;
  setTyping(true);
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (data.reply) addMsg('assistant', data.reply);
    else if (data.error) addMsg('action fail', data.error);
  } catch (err) {
    addMsg('action fail', 'request failed: ' + err.message);
  } finally {
    setTyping(false);
    els.send.disabled = false;
    els.input.focus();
  }
}

els.send.onclick = send;
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
els.input.addEventListener('input', () => {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 110) + 'px';
});

els.collapse.onclick = () => document.body.classList.toggle('collapsed');
els.pin.onclick = () => els.pin.classList.toggle('pinned');

// --- SSE wiring ---
const es = new EventSource('/api/events');
es.addEventListener('hello', () => setStatus('ready', true));
es.addEventListener('capabilities', () => setStatus('ready', true));
es.addEventListener('assistant', (e) => {
  const { content } = JSON.parse(e.data);
  if (content) addMsg('assistant', content);
});
es.addEventListener('result', (e) => {
  const { ok, summary } = JSON.parse(e.data);
  addMsg('action ' + (ok ? 'ok' : 'fail'), (ok ? '✓ ' : '✗ ') + summary);
});
es.addEventListener('approval', (e) => {
  approvalCard(JSON.parse(e.data));
});
es.addEventListener('approval:resolved', (e) => {
  const { requestId } = JSON.parse(e.data);
  document.querySelector(`[data-request-id="${requestId}"]`)?.remove();
});
es.onerror = () => setStatus('disconnected', false);

addMsg('assistant', 'Clickaa is starting. Ask me to do something on your PC, the web, or a connected device.');
