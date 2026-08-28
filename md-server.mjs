#!/usr/bin/env node

/**
 * md-server.mjs - Live Markdown Documentation Server
 * Real-time Markdown rendering with text annotation & AI Agent streaming integration.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { marked } from 'marked';

// --- 1. Load .env Configuration ---
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(envPath);
      return;
    }
  } catch {}

  // Fallback simple .env parser
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    }
  } catch {}
}

loadEnv();

// --- 2. CLI Arguments & Settings ---
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
md-live-server - Live Markdown Documentation Server

Usage:
  node md-server.mjs [docs_dir] [options]

Options:
  -p, --port <number>      Port to run server on (default: 3456 or $PORT)
  -H, --host <host>        Host to bind server to (default: localhost or $HOST)
  -d, --dir <path>         Path to markdown documents directory (default: ./_workspace, ./docs, or .)
  --no-agent               Disable AI Agent integration
  --agent-cmd <command>    Command to invoke AI Agent (default: "agy --continue --print" or $AGENT_COMMAND)
  -h, --help               Show this help message

Environment Variables (.env):
  PORT, HOST, DOCS_DIR, NOTES_DIR, AGENT_ENABLED, AGENT_COMMAND
`);
  process.exit(0);
}

function getArgValue(flags, defaultVal) {
  for (const flag of flags) {
    const idx = args.indexOf(flag);
    if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('-')) {
      return args[idx + 1];
    }
  }
  return defaultVal;
}

const ROOT = process.cwd();

// Resolve default docs directory
function resolveDocsDir() {
  const cliDir = getArgValue(['--dir', '-d'], null) || args.find(a => !a.startsWith('-'));
  if (cliDir) return path.resolve(ROOT, cliDir);

  if (process.env.DOCS_DIR) return path.resolve(ROOT, process.env.DOCS_DIR);
  if (fs.existsSync(path.join(ROOT, 'sample'))) return path.join(ROOT, 'sample');
  if (fs.existsSync(path.join(ROOT, 'samples'))) return path.join(ROOT, 'samples');
  if (fs.existsSync(path.join(ROOT, 'docs'))) return path.join(ROOT, 'docs');
  if (fs.existsSync(path.join(ROOT, '_workspace'))) return path.join(ROOT, '_workspace');
  return ROOT;
}

const SRC = resolveDocsDir();
const PORT = parseInt(getArgValue(['--port', '-p'], process.env.PORT || '3456'), 10);
const HOST = getArgValue(['--host', '-H'], process.env.HOST || 'localhost');
const AGENT_ENABLED = !args.includes('--no-agent') && process.env.AGENT_ENABLED !== 'false';
const AGENT_COMMAND = getArgValue(['--agent-cmd'], process.env.AGENT_COMMAND || 'agy --continue --print');
const NOTES_DIR = process.env.NOTES_DIR ? path.resolve(ROOT, process.env.NOTES_DIR) : path.join(SRC, '.notes');

// --- 3. Helpers ---
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.notes' || e.name.startsWith('.')) continue;
        walk(p, out);
      } else if (e.name.endsWith('.md')) {
        out.push(p);
      }
    }
  } catch (err) {
    console.error(`[walk error] ${dir}:`, err.message);
  }
  return out;
}

function safePath(rel) {
  const abs = path.resolve(path.join(SRC, rel));
  if (!abs.startsWith(SRC)) return null;
  return abs;
}

// --- 4. HTML Shell & UI ---
function shell(title, body) {
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #24292f;
      display: flex;
      height: 100vh;
      overflow: hidden;
      background: #ffffff;
    }
    #sidebar {
      width: 320px;
      border-right: 1px solid #d0d7de;
      overflow: auto;
      background: #f6f8fa;
      padding: 14px;
      display: flex;
      flex-direction: column;
    }
    .sidebar-header {
      font-size: 14px;
      font-weight: 700;
      color: #24292f;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .sidebar-badge {
      font-size: 11px;
      background: #0969da;
      color: #fff;
      padding: 2px 6px;
      border-radius: 10px;
    }
    #main {
      flex: 1;
      overflow: auto;
      padding: 32px 48px;
      max-width: 960px;
      margin: 0 auto;
      line-height: 1.6;
    }
    a { color: #0969da; text-decoration: none; }
    a:hover { text-decoration: underline; }
    pre {
      background: #f6f8fa;
      padding: 16px;
      overflow: auto;
      border-radius: 6px;
      border: 1px solid #e1e4e8;
    }
    code {
      font-size: 13px;
      background: rgba(175,184,193,0.2);
      padding: .2em .4em;
      border-radius: 6px;
      font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace;
    }
    pre code { background: none; padding: 0; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    th, td { border: 1px solid #d0d7de; padding: 8px 12px; }
    th { background: #f6f8fa; }
    blockquote {
      border-left: 4px solid #0969da;
      margin: 0;
      padding: 0 1em;
      color: #57606a;
      background: #f8fafc;
      border-radius: 0 4px 4px 0;
    }
    #search {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid #d0d7de;
      border-radius: 6px;
      margin-bottom: 12px;
      font-size: 13px;
      outline: none;
    }
    #search:focus { border-color: #0969da; box-shadow: 0 0 0 3px rgba(9,105,218,0.15); }
    .tree { flex: 1; overflow-y: auto; }
    .tree a {
      display: block;
      padding: 5px 8px;
      border-radius: 6px;
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #24292f;
    }
    .tree a:hover { background: #eaeef2; }
    .tree a.active { background: #ddf4ff; color: #0969da; font-weight: 600; }
    .tree .dir { font-weight: 600; font-size: 11px; color: #656d76; margin-top: 12px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
    
    /* Text Annotation Popup */
    #note-popup {
      position: fixed;
      display: none;
      background: #fff;
      border: 1px solid #d0d7de;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,.15);
      padding: 12px;
      width: 320px;
      z-index: 99;
    }
    #note-popup textarea {
      width: 100%;
      height: 75px;
      border: 1px solid #d0d7de;
      border-radius: 6px;
      padding: 8px;
      font-size: 13px;
      outline: none;
      resize: vertical;
    }
    #note-popup textarea:focus { border-color: #0969da; }
    #note-popup button {
      background: #0969da;
      color: #fff;
      border: none;
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }
    #note-popup button:hover { background: #0550ae; }
    
    /* AI Chatbot Floating Panel */
    #chat-panel {
      position: fixed;
      right: 20px;
      bottom: 20px;
      width: 400px;
      height: 520px;
      background: #fff;
      border: 1px solid #d0d7de;
      border-radius: 12px;
      box-shadow: 0 12px 32px rgba(0,0,0,.2);
      display: none;
      flex-direction: column;
      z-index: 100;
      overflow: hidden;
    }
    #chat-panel.open { display: flex; }
    #chat-header {
      padding: 12px 16px;
      background: #0f172a;
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    #chat-header button { background: transparent; border: none; color: #fff; cursor: pointer; font-size: 16px; }
    #chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: #f8fafc;
    }
    .msg {
      max-width: 88%;
      padding: 8px 12px;
      border-radius: 10px;
      font-size: 13px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .msg.user { align-self: flex-end; background: #0969da; color: #fff; border-bottom-right-radius: 2px; }
    .msg.agent { align-self: flex-start; background: #fff; border: 1px solid #d0d7de; border-bottom-left-radius: 2px; }
    .msg.system { align-self: center; background: #fef3c7; color: #92400e; font-size: 12px; border: 1px solid #fde68a; }
    #chat-input {
      border-top: 1px solid #d0d7de;
      padding: 10px;
      display: flex;
      gap: 8px;
      background: #fff;
    }
    #chat-input textarea {
      flex: 1;
      border: 1px solid #d0d7de;
      border-radius: 8px;
      padding: 8px;
      font-size: 13px;
      resize: none;
      height: 40px;
      outline: none;
    }
    #chat-input textarea:focus { border-color: #0969da; }
    #chat-input button {
      background: #0969da;
      color: #fff;
      border: none;
      padding: 0 16px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 500;
    }
    #chat-fab {
      position: fixed;
      right: 20px;
      bottom: 20px;
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background: #0969da;
      color: #fff;
      border: none;
      box-shadow: 0 8px 24px rgba(0,0,0,.25);
      cursor: pointer;
      font-size: 22px;
      z-index: 99;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #chat-fab.hidden { display: none; }
  </style>
</head>
<body>
  ${body}
  <script>
    let selectedText = '';
    let chatOpen = false;

    function openChat() {
      document.getElementById('chat-panel').classList.add('open');
      document.getElementById('chat-fab').classList.add('hidden');
      chatOpen = true;
    }

    function closeChat() {
      document.getElementById('chat-panel').classList.remove('open');
      document.getElementById('chat-fab').classList.remove('hidden');
      chatOpen = false;
    }

    function toggleChat() {
      chatOpen ? closeChat() : openChat();
    }

    function addMsg(role, text) {
      const m = document.createElement('div');
      m.className = 'msg ' + role;
      m.textContent = text;
      document.getElementById('chat-messages').appendChild(m);
      m.scrollIntoView({ behavior: 'smooth' });
      return m;
    }

    document.addEventListener('mouseup', () => {
      const sel = window.getSelection().toString().trim();
      if (sel.length > 3) {
        selectedText = sel;
        const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
        const p = document.getElementById('note-popup');
        p.style.display = 'block';
        p.style.left = Math.min(r.left, window.innerWidth - 340) + 'px';
        p.style.top = (r.bottom + 8 + window.scrollY) + 'px';
        document.getElementById('note-text').focus();
        document.getElementById('sel-preview').textContent = sel.slice(0, 200);
      }
    });

    function closePopup() {
      document.getElementById('note-popup').style.display = 'none';
      document.getElementById('note-text').value = '';
    }

    async function sendToAgent() {
      const note = document.getElementById('note-text').value.trim();
      if (!note && !selectedText) return;
      const path = new URLSearchParams(location.search).get('path') || '';
      const userText = (selectedText ? ('> ' + selectedText + '\\n\\n') : '') + note;
      closePopup();
      openChat();
      addMsg('user', userText);
      const agentEl = addMsg('agent', '⏳ Agent đang xử lý...');

      try {
        const res = await fetch('/api/note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, selection: selectedText, note })
        });

        if (!res.body || !res.headers.get('content-type')?.includes('text/event-stream')) {
          const j = await res.json().catch(() => ({}));
          agentEl.textContent = j.message || 'Đã gửi note thành công!';
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let full = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\\n\\n')) !== -1) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            if (chunk.startsWith('data: ')) {
              try {
                const j = JSON.parse(chunk.slice(6));
                if (j.chunk) {
                  full += j.chunk;
                  agentEl.textContent = full.slice(-6000);
                  agentEl.scrollIntoView({ behavior: 'smooth' });
                }
                if (j.done) {
                  if (!full) agentEl.textContent = '✅ Đã lưu note vào file.';
                }
                if (j.error) agentEl.textContent = '❌ Lỗi Agent: ' + j.error;
              } catch {}
            }
          }
        }
      } catch (e) {
        agentEl.textContent = '❌ Lỗi kết nối: ' + e.message;
      }
    }

    async function sendChatInput() {
      const el = document.getElementById('chat-input-text');
      const text = el.value.trim();
      if (!text) return;
      el.value = '';
      addMsg('user', text);
      const agentEl = addMsg('agent', '⏳ ...');
      const path = new URLSearchParams(location.search).get('path') || '';

      try {
        const res = await fetch('/api/note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, selection: '', note: text })
        });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '', full = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\\n\\n')) !== -1) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            if (chunk.startsWith('data: ')) {
              try {
                const j = JSON.parse(chunk.slice(6));
                if (j.chunk) {
                  full += j.chunk;
                  agentEl.textContent = full.slice(-6000);
                  agentEl.scrollIntoView({ behavior: 'smooth' });
                }
                if (j.error) agentEl.textContent = '❌ ' + j.error;
              } catch {}
            }
          }
        }
      } catch (e) {
        agentEl.textContent = '❌ Lỗi: ' + e.message;
      }
    }

    // Search filter
    document.addEventListener('input', (e) => {
      if (e.target.id === 'search') {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll('.tree a').forEach(a => {
          a.style.display = a.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePopup();
    });
  </script>

  ${AGENT_ENABLED ? `
  <button id="chat-fab" onclick="toggleChat()" title="Mở chat với Agent">💬</button>
  <div id="chat-panel">
    <div id="chat-header">
      <span>AI Agent Assistant</span>
      <button onclick="closeChat()">✕</button>
    </div>
    <div id="chat-messages">
      <div class="msg system">💡 Bôi đen đoạn văn bản bất kỳ để tạo ghi chú và chuyển trực tiếp cho AI Agent xử lý.</div>
    </div>
    <div id="chat-input">
      <textarea id="chat-input-text" placeholder="Nhập câu hỏi hoặc yêu cầu cho AI Agent..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChatInput();}"></textarea>
      <button onclick="sendChatInput()">Gửi</button>
    </div>
  </div>
  ` : ''}

  <div id="note-popup">
    <div style="font-size:12px;font-weight:600;color:#656d76;margin-bottom:6px">Gửi ghi chú đến AI Agent:</div>
    <div id="sel-preview" style="font-size:12px;background:#f6f8fa;padding:6px;border-radius:6px;margin-bottom:8px;max-height:60px;overflow:auto;color:#57606a"></div>
    <textarea id="note-text" placeholder="Nhập ghi chú hoặc chỉ thị cho Agent..."></textarea>
    <div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end">
      <button onclick="closePopup()" style="background:#f6f8fa;color:#24292f;border:1px solid #d0d7de">Đóng</button>
      <button onclick="sendToAgent()">Gửi Agent</button>
    </div>
  </div>
</body>
</html>`;
}

function fileTreeHtml(files, currentRel) {
  const byDir = {};
  for (const f of files) {
    const rel = path.relative(SRC, f);
    const dir = path.dirname(rel) === '.' ? 'Root' : path.dirname(rel);
    if (!byDir[dir]) byDir[dir] = [];
    byDir[dir].push(rel);
  }

  let html = '<div class="sidebar-header"><span>📑 MARKDOWN DOCS</span><span class="sidebar-badge">' + files.length + '</span></div>';
  html += '<input id="search" placeholder="🔍 Tìm kiếm file...">';
  html += '<div class="tree">';
  for (const dir of Object.keys(byDir).sort()) {
    html += `<div class="dir">${dir}</div>`;
    for (const rel of byDir[dir].sort()) {
      const name = path.basename(rel);
      const activeClass = (rel === currentRel) ? 'active' : '';
      html += `<a href="/?path=${encodeURIComponent(rel)}" class="${activeClass}" data-path="${rel}">${name}</a>`;
    }
  }
  html += '</div>';
  return html;
}

// --- 5. HTTP Server ---
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  // API: List files
  if (url.pathname === '/api/files') {
    const files = walk(SRC).map(f => path.relative(SRC, f));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(files));
    return;
  }

  // API: Get file content
  if (url.pathname === '/api/file') {
    const rel = url.searchParams.get('path') || '';
    const abs = safePath(rel);
    if (!abs || !fs.existsSync(abs)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found' }));
      return;
    }
    const md = fs.readFileSync(abs, 'utf8');
    const html = marked.parse(md);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ rel, html, md }));
    return;
  }

  // API: Note -> Agent integration
  if (url.pathname === '/api/note' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { path: rel, selection, note } = JSON.parse(body);
        const prompt = `[WEB NOTE] File: ${rel || '(no file)'}\nSelection:\n> ${selection || '(empty)'}\nNote:\n${note || '(empty)'}`;

        // 1) Save note to disk
        fs.mkdirSync(NOTES_DIR, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const noteFile = path.join(NOTES_DIR, `${ts}.md`);
        fs.writeFileSync(noteFile, `# Note from Web Viewer\n\n${prompt}\n\n- Time: ${new Date().toLocaleString('vi-VN')}\n`);
        console.log(`[note] Created note: ${path.relative(ROOT, noteFile)}`);

        // 2) Trigger Agent if enabled
        const useAgent = AGENT_ENABLED && url.searchParams.get('agent') !== '0';
        if (!useAgent) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, message: `Đã lưu note vào: ${path.relative(ROOT, noteFile)}` }));
          return;
        }

        // SSE Streaming response
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        const [cmd, ...cmdArgs] = AGENT_COMMAND.split(' ');
        const finalArgs = [...cmdArgs, prompt];
        console.log(`[agent] Executing: ${cmd} ${finalArgs.join(' ').slice(0, 80)}...`);

        const child = spawn(cmd, finalArgs, {
          cwd: ROOT,
          env: process.env,
          shell: true,
        });

        let fullOutput = '';
        child.stdout.on('data', d => {
          const chunk = d.toString();
          fullOutput += chunk;
          res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
        });

        child.stderr.on('data', d => {
          const chunk = d.toString();
          res.write(`data: ${JSON.stringify({ chunk, stderr: true })}\n\n`);
        });

        child.on('close', code => {
          try {
            fs.appendFileSync(noteFile, `\n---\n## Agent Response (Exit Code: ${code})\n\n${fullOutput}\n`);
          } catch {}
          try {
            res.write(`data: ${JSON.stringify({ done: true, code, file: path.relative(ROOT, noteFile) })}\n\n`);
            res.end();
          } catch {}
        });

        child.on('error', err => {
          console.error(`[agent error] ${err.message}`);
          try {
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            res.end();
          } catch {}
        });
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: e.message }));
      }
    });
    return;
  }

  // Page: Viewer
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const files = walk(SRC);
    const rel = url.searchParams.get('path');
    let mainHtml = `
      <div style="color:#656d76;padding:60px 20px;text-align:center">
        <h3 style="color:#24292f;margin-bottom:8px">📖 Live Markdown Viewer</h3>
        <p>Chọn một file tài liệu từ danh sách bên trái để đọc nội dung.</p>
        <p style="font-size:13px;color:#8c959f">Tip: Bôi đen bất kỳ đoạn văn bản nào để tạo chú thích và gửi chỉ thị cho AI Agent.</p>
      </div>`;
    let title = 'Live Markdown Docs';

    if (rel) {
      const abs = safePath(rel);
      if (abs && fs.existsSync(abs)) {
        const md = fs.readFileSync(abs, 'utf8');
        const body = marked.parse(md);
        title = path.basename(rel);
        mainHtml = `
          <div style="margin-bottom: 24px; padding-bottom: 12px; border-bottom: 1px solid #d0d7de;">
            <h1 style="margin: 0 0 8px 0; font-size: 24px;">${title}</h1>
            <div style="font-size: 12px; color: #656d76; font-family: monospace;">${rel}</div>
          </div>
          <article>${body}</article>
        `;
      } else {
        mainHtml = '<p style="color:#cf222e;">⚠️ File không tồn tại hoặc ngoài phạm vi thư mục tài liệu.</p>';
      }
    }

    const html = shell(title, `<div id="sidebar">${fileTreeHtml(files, rel)}</div><div id="main">${mainHtml}</div>`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
});

server.listen(PORT, HOST, () => {
  console.log(`\n🚀 MD Live Server is running at: http://${HOST}:${PORT}`);
  console.log(`📁 Serving documents from:      ${SRC}`);
  console.log(`🤖 AI Agent Integration:        ${AGENT_ENABLED ? `Enabled (${AGENT_COMMAND})` : 'Disabled'}`);
  console.log(`📝 Notes saved to:              ${NOTES_DIR}\n`);
});
