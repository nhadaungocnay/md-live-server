#!/usr/bin/env node

/**
 * md-server.mjs - Live Markdown Documentation Server (Local App Edition)
 * Real-time Markdown rendering, native folder/file picker, Drag & Drop,
 * persistent recent workspaces, Live Reload (SSE) & AI Agent integration.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { spawn, execFile } from 'child_process';
import { marked } from 'marked';

const __filename = fileURLToPath(import.meta.url);
const APP_ROOT = path.dirname(__filename);
const CLI_CWD = process.cwd();

// --- 1. Load .env Configuration (Optional fallback) ---
function loadEnv() {
  const candidates = [
    path.resolve(CLI_CWD, '.env'),
    path.resolve(APP_ROOT, '.env'),
  ];
  const envPath = candidates.find(p => fs.existsSync(p));
  if (!envPath) return;

  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(envPath);
      return;
    }
  } catch {}

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
  -d, --dir <path>         Path to markdown documents directory
  -o, --open               Automatically open browser when server starts
  --no-agent               Disable AI Agent integration
  --agent-cmd <command>    Command to invoke AI Agent (default: "agy --continue --print" or $AGENT_COMMAND)
  -h, --help               Show this help message

Environment Variables (.env - optional):
  PORT, HOST, DOCS_DIR, NOTES_DIR, AGENT_ENABLED, AGENT_COMMAND, AUTO_OPEN
`);
  process.exit(0);
}

const VALUE_FLAGS = new Set(['--port', '-p', '--host', '-H', '--dir', '-d', '--agent-cmd']);

function getArgValue(flags, defaultVal) {
  for (const flag of flags) {
    const idx = args.indexOf(flag);
    if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('-')) {
      return args[idx + 1];
    }
  }
  return defaultVal;
}

function getPositionalDirArg() {
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (VALUE_FLAGS.has(token)) {
      i++;
      continue;
    }
    if (!token.startsWith('-')) return token;
  }
  return null;
}

const PORT = parseInt(getArgValue(['--port', '-p'], process.env.PORT || '3456'), 10);
const HOST = getArgValue(['--host', '-H'], process.env.HOST || 'localhost');
const AUTO_OPEN = args.includes('--open') || args.includes('-o') || process.env.AUTO_OPEN === 'true';
const FORCE_BROWSER = args.includes('--browser');
const AGENT_ENABLED = !args.includes('--no-agent') && process.env.AGENT_ENABLED !== 'false';
const AGENT_COMMAND = getArgValue(['--agent-cmd'], process.env.AGENT_COMMAND || 'agy --continue --print');

// --- 3. Persistent Workspace Configuration (.md-server-config.json) ---
const CONFIG_FILE = path.join(APP_ROOT, '.md-server-config.json');
const DROPPED_DIR = path.join(APP_ROOT, '.dropped');
const MAX_RECENT_DIRS = 12;
const MAX_DROP_BYTES = 50 * 1024 * 1024; // 50 MB

function isExistingDir(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') return false;
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      const recentDirs = Array.isArray(parsed.recentDirs)
        ? parsed.recentDirs
            .filter(d => typeof d === 'string' && d !== DROPPED_DIR && isExistingDir(d))
            .slice(0, MAX_RECENT_DIRS)
        : [];
      const currentDir =
        typeof parsed.currentDir === 'string' && parsed.currentDir !== DROPPED_DIR && isExistingDir(parsed.currentDir)
          ? parsed.currentDir
          : null;
      return { currentDir, recentDirs };
    }
  } catch (err) {
    console.error('[config read error]', err.message);
  }
  return { currentDir: null, recentDirs: [] };
}

function saveConfig(cfg) {
  try {
    const clean = {
      currentDir: cfg.currentDir,
      recentDirs: (cfg.recentDirs || [])
        .filter(d => typeof d === 'string' && d !== DROPPED_DIR && isExistingDir(d))
        .slice(0, MAX_RECENT_DIRS),
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(clean, null, 2), 'utf8');
  } catch (err) {
    console.error('[config write error]', err.message);
  }
}

const config = loadConfig();

function resolveInitialDocsDir() {
  const cliDir = getArgValue(['--dir', '-d'], null) || getPositionalDirArg();
  if (cliDir) {
    const resolved = path.resolve(CLI_CWD, expandHome(cliDir));
    if (isExistingDir(resolved)) return resolved;
  }

  if (config.currentDir && isExistingDir(config.currentDir)) {
    return config.currentDir;
  }

  if (process.env.DOCS_DIR) {
    const envDir = path.resolve(APP_ROOT, expandHome(process.env.DOCS_DIR));
    if (isExistingDir(envDir)) return envDir;
  }

  for (const name of ['sample', 'samples', 'docs', '_workspace']) {
    const candidate = path.join(APP_ROOT, name);
    if (isExistingDir(candidate)) return candidate;
  }

  return APP_ROOT;
}

let currentDir = resolveInitialDocsDir();
let droppedLabel = null;
let activePort = PORT;

if (!config.currentDir && currentDir !== DROPPED_DIR) {
  config.currentDir = currentDir;
  if (!config.recentDirs.includes(currentDir)) {
    config.recentDirs = [currentDir, ...config.recentDirs].slice(0, MAX_RECENT_DIRS);
  }
  saveConfig(config);
}

function getNotesDir() {
  return process.env.NOTES_DIR
    ? path.resolve(APP_ROOT, expandHome(process.env.NOTES_DIR))
    : path.join(currentDir, '.notes');
}

// --- 4. Live Reload Watcher & SSE Clients ---
const sseClients = new Set();
let fsWatcher = null;
let reloadTimer = null;

function broadcastEvent(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function restartWatcher() {
  if (fsWatcher) {
    try {
      fsWatcher.close();
    } catch {}
    fsWatcher = null;
  }

  if (!isExistingDir(currentDir)) return;

  const onFsEvent = (_eventType, filename) => {
    const fname = filename ? String(filename) : '';
    if (
      fname.includes('.notes') ||
      fname.includes('.git') ||
      fname.includes('node_modules') ||
      path.basename(fname).startsWith('._')
    ) {
      return;
    }
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      broadcastEvent('reload', { file: fname.replace(/\\/g, '/'), ts: Date.now() });
    }, 200);
  };

  try {
    fsWatcher = fs.watch(currentDir, { recursive: true }, onFsEvent);
    fsWatcher.on('error', () => {});
  } catch {
    try {
      fsWatcher = fs.watch(currentDir, onFsEvent);
      fsWatcher.on('error', () => {});
    } catch {}
  }
}

function setWorkspaceDir(newDir, { saveRecent = true, label = null } = {}) {
  const resolved = path.resolve(newDir);
  if (!isExistingDir(resolved)) {
    throw new Error(`Thư mục không tồn tại: ${resolved}`);
  }
  currentDir = resolved;
  droppedLabel = resolved === DROPPED_DIR ? (label || 'Tài liệu kéo thả') : null;

  if (saveRecent && resolved !== DROPPED_DIR) {
    config.currentDir = resolved;
    config.recentDirs = [resolved, ...config.recentDirs.filter(d => d !== resolved && isExistingDir(d))].slice(
      0,
      MAX_RECENT_DIRS
    );
    saveConfig(config);
  }

  restartWatcher();
  broadcastEvent('workspace', { currentDir, isDroppedWorkspace: currentDir === DROPPED_DIR });
  console.log(`[workspace] Switched to: ${currentDir}`);
  return currentDir;
}

// --- 5. Helpers ---
function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function isMarkdownFile(name) {
  if (!name) return false;
  const base = path.basename(name);
  if (base.startsWith('._') || base.startsWith('.')) return false;
  return /\.(md|markdown)$/i.test(base);
}

function walk(dir, out = []) {
  if (!isExistingDir(dir)) return out;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.notes') continue;
        walk(p, out);
      } else if (e.isFile() && isMarkdownFile(e.name)) {
        out.push(p);
      }
    }
  } catch (err) {
    console.error(`[walk error] ${dir}:`, err.message);
  }
  return out;
}

function safePath(rel) {
  if (!rel || typeof rel !== 'string' || rel.includes('\0')) return null;
  const base = path.resolve(currentDir);
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  return abs;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shortenPath(p) {
  if (!p) return '';
  const home = os.homedir();
  if (p === home) return '~';
  if (p.startsWith(home + path.sep)) {
    return '~' + p.slice(home.length);
  }
  return p;
}

function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let aborted = false;

    req.on('data', chunk => {
      if (aborted) return;
      total += chunk.length;
      if (total > maxBytes) {
        aborted = true;
        const err = new Error('Payload quá lớn');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        const err = new Error('Dữ liệu JSON không hợp lệ');
        err.statusCode = 400;
        reject(err);
      }
    });

    req.on('error', err => {
      if (!aborted) reject(err);
    });
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// --- 6. Native OS File/Folder Pickers ---
function runPickerCommand(cmd, cmdArgs) {
  return new Promise((resolve, reject) => {
    execFile(cmd, cmdArgs, { timeout: 120000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const combined = `${err.message || ''} ${stderr || ''}`;
        if (
          err.code === 1 ||
          err.code === 5 ||
          combined.includes('-128') ||
          combined.toLowerCase().includes('user canceled') ||
          combined.toLowerCase().includes('cancelled')
        ) {
          resolve({ cancelled: true, path: null });
          return;
        }
        reject(new Error(stderr?.trim() || err.message));
        return;
      }
      const trimmed = (stdout || '').trim();
      if (!trimmed) {
        resolve({ cancelled: true, path: null });
        return;
      }
      const normalized = trimmed.length > 1 && trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
      resolve({ cancelled: false, path: normalized });
    });
  });
}

async function pickFolderNative() {
  if (process.platform === 'darwin') {
    return runPickerCommand('osascript', [
      '-e',
      'POSIX path of (choose folder with prompt "Chọn thư mục chứa tài liệu Markdown (.md):")',
    ]);
  }
  if (process.platform === 'win32') {
    const ps = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      '$f = New-Object System.Windows.Forms.FolderBrowserDialog;',
      '$f.Description = "Chon thu muc chua tai lieu Markdown (.md)";',
      'if ($f.ShowDialog() -eq "OK") { Write-Output $f.SelectedPath }',
    ].join(' ');
    return runPickerCommand('powershell', ['-NoProfile', '-STA', '-Command', ps]);
  }
  try {
    return await runPickerCommand('zenity', [
      '--file-selection',
      '--directory',
      '--title=Chọn thư mục chứa tài liệu Markdown (.md)',
    ]);
  } catch {
    return runPickerCommand('kdialog', ['--getexistingdirectory', currentDir]);
  }
}

async function pickFileNative() {
  if (process.platform === 'darwin') {
    return runPickerCommand('osascript', [
      '-e',
      'POSIX path of (choose file with prompt "Chọn file Markdown (.md) để xem:")',
    ]);
  }
  if (process.platform === 'win32') {
    const ps = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      '$f = New-Object System.Windows.Forms.OpenFileDialog;',
      '$f.Filter = "Markdown files (*.md;*.markdown)|*.md;*.markdown|All files (*.*)|*.*";',
      'if ($f.ShowDialog() -eq "OK") { Write-Output $f.FileName }',
    ].join(' ');
    return runPickerCommand('powershell', ['-NoProfile', '-STA', '-Command', ps]);
  }
  try {
    return await runPickerCommand('zenity', [
      '--file-selection',
      '--title=Chọn file Markdown (.md)',
      '--file-filter=Markdown files | *.md *.markdown',
    ]);
  } catch {
    return runPickerCommand('kdialog', ['--getopenfilename', currentDir, '*.md *.markdown']);
  }
}

// --- 7. Browser & Port Helpers ---
function getDisplayUrl(port) {
  const displayHost = HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;
  return `http://${displayHost}:${port}`;
}

function openBrowser(targetUrl) {
  try {
    if (process.platform === 'darwin') {
      if (!FORCE_BROWSER) {
        const appCandidates = [
          '/Applications/MD Live Server.app',
          path.join(APP_ROOT, 'MD Live Server.app'),
        ];
        const appBundle = appCandidates.find(p => fs.existsSync(p));
        if (appBundle) {
          spawn('open', ['-a', appBundle], { detached: true, stdio: 'ignore' }).unref();
          return;
        }
      }
      spawn('open', [targetUrl], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', targetUrl], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [targetUrl], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (err) {
    console.error('[open browser error]', err.message);
  }
}

function isMdLiveServerRunning(port) {
  return new Promise(resolve => {
    const probeHost = HOST === '0.0.0.0' || HOST === '::' ? '127.0.0.1' : HOST;
    const req = http.get(
      { host: probeHost, port, path: '/api/workspace', timeout: 1500 },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed?.app === 'md-live-server');
          } catch {
            resolve(false);
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

// --- 8. HTML Shell & UI ---
function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function buildFileTree(files) {
  const root = { name: '', relPath: '', dirs: new Map(), files: [], totalFiles: 0 };
  for (const f of files) {
    const rel = path.relative(currentDir, f).replace(/\\/g, '/');
    const parts = rel.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    let cur = root;
    cur.totalFiles++;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (!cur.dirs.has(seg)) {
        const dirRelPath = cur.relPath ? `${cur.relPath}/${seg}` : seg;
        cur.dirs.set(seg, { name: seg, relPath: dirRelPath, dirs: new Map(), files: [], totalFiles: 0 });
      }
      cur = cur.dirs.get(seg);
      cur.totalFiles++;
    }
    cur.files.push({ name: parts[parts.length - 1], rel });
  }
  return root;
}

function renderTreeNode(node, currentRel, depth, expandTopDefault) {
  let html = '';

  const sortedDirs = Array.from(node.dirs.values()).sort((a, b) => naturalCompare(a.name, b.name));
  for (const dirNode of sortedDirs) {
    const isAncestorOfActive =
      Boolean(currentRel) &&
      (currentRel === dirNode.relPath || currentRel.startsWith(dirNode.relPath + '/'));
    const shouldOpen = isAncestorOfActive || (depth === 0 && expandTopDefault);

    html += `<details class="tree-folder" data-folder="${escapeHtml(dirNode.relPath)}"${shouldOpen ? ' open' : ''}>`;
    html += `<summary class="tree-folder-summary" title="${escapeHtml(dirNode.relPath)}">`;
    html += `<span class="folder-chevron">▶</span>`;
    html += `<span class="folder-icon" aria-hidden="true"></span>`;
    html += `<span class="folder-name">${escapeHtml(dirNode.name)}</span>`;
    html += `<span class="folder-count">${dirNode.totalFiles}</span>`;
    html += `</summary>`;
    html += `<div class="tree-children">`;
    html += renderTreeNode(dirNode, currentRel, depth + 1, expandTopDefault);
    html += `</div></details>`;
  }

  const sortedFiles = node.files.slice().sort((a, b) => naturalCompare(a.name, b.name));
  for (const file of sortedFiles) {
    const activeClass = file.rel === currentRel ? ' active' : '';
    html += `<a href="/?path=${encodeURIComponent(file.rel)}" class="tree-file${activeClass}" data-path="${escapeHtml(file.rel)}" title="${escapeHtml(file.rel)}">`;
    html += `<span class="file-icon" aria-hidden="true">📄</span>`;
    html += `<span class="file-name">${escapeHtml(file.name)}</span>`;
    html += `</a>`;
  }

  return html;
}

function fileTreeHtml(files, currentRel) {
  if (files.length === 0) {
    return `<div class="empty-tree">Không tìm thấy file <code>.md</code> nào trong thư mục này.<br><br>Hãy chọn thư mục khác hoặc kéo thả file <code>.md</code> vào đây.</div>`;
  }
  const tree = buildFileTree(files);
  const expandTopDefault = files.length <= 40;
  return renderTreeNode(tree, currentRel, 0, expandTopDefault);
}

function recentDirsHtml(recentDirs) {
  const others = recentDirs.filter(d => d !== currentDir);
  if (others.length === 0) {
    return '<div class="recent-empty">Chưa có thư mục gần đây khác</div>';
  }
  return others
    .map(d => {
      const name = path.basename(d) || d;
      const short = shortenPath(d);
      return `
        <div class="recent-item" data-dir="${escapeHtml(d)}">
          <button type="button" class="recent-open" onclick="openRecentDir(this.parentElement.dataset.dir)" title="${escapeHtml(d)}">
            <span class="recent-name">📁 ${escapeHtml(name)}</span>
            <span class="recent-path">${escapeHtml(short)}</span>
          </button>
          <button type="button" class="recent-del" onclick="removeRecentDir(event, this.parentElement.dataset.dir)" title="Xóa khỏi lịch sử">✕</button>
        </div>
      `;
    })
    .join('');
}

function sidebarHtml(files, currentRel) {
  const isDropped = currentDir === DROPPED_DIR;
  const folderTitle = isDropped ? (droppedLabel || 'Tài liệu kéo thả') : (path.basename(currentDir) || currentDir);
  const folderSub = isDropped ? 'Phiên kéo thả tạm thời (.dropped)' : shortenPath(currentDir);

  return `
    <div class="sidebar-header">
      <span>📑 MD LIVE SERVER</span>
      <span class="sidebar-badge" id="file-count-badge">${files.length}</span>
    </div>

    <div class="workspace-card">
      <div class="ws-current" title="${escapeHtml(currentDir)}">
        <div class="ws-label">${isDropped ? '📥 ĐANG XEM (KÉO THẢ)' : '📂 THƯ MỤC ĐANG MỞ'}</div>
        <div class="ws-name">${escapeHtml(folderTitle)}</div>
        <div class="ws-path">${escapeHtml(folderSub)}</div>
      </div>

      <div class="ws-actions">
        <button type="button" id="btn-pick-folder" class="btn-ws btn-primary" onclick="pickFolder()">📂 Chọn thư mục</button>
        <button type="button" id="btn-pick-file" class="btn-ws" onclick="pickFile()">📄 Chọn file</button>
      </div>
      <button type="button" class="btn-ws btn-full" onclick="togglePathInput()" style="margin-top:6px;">⌨️ Nhập đường dẫn thủ công</button>

      <div id="path-input-box" style="display:none;margin-top:8px;">
        <div style="display:flex;gap:6px;">
          <input id="manual-path-input" type="text" placeholder="/duong/dan/thu-muc hoặc ~/docs" onkeydown="if(event.key==='Enter')submitManualPath()">
          <button type="button" class="btn-ws btn-primary" onclick="submitManualPath()" style="flex:0 0 auto;padding:6px 10px;">Mở</button>
        </div>
      </div>

      <details class="recent-details" ${config.recentDirs.filter(d => d !== currentDir).length > 0 ? '' : ''}>
        <summary>🕒 Mở gần đây (${config.recentDirs.filter(d => d !== currentDir).length})</summary>
        <div class="recent-list" id="sidebar-recent-list">
          ${recentDirsHtml(config.recentDirs)}
        </div>
      </details>
    </div>

    <div class="tree-toolbar">
      <input id="search" placeholder="🔍 Tìm kiếm file .md...">
      <button type="button" class="btn-tree-tool" onclick="expandAllFolders()" title="Mở rộng tất cả thư mục">⊞</button>
      <button type="button" class="btn-tree-tool" onclick="collapseAllFolders()" title="Thu gọn tất cả thư mục">⊟</button>
    </div>
    <div class="tree" id="file-tree">
      ${fileTreeHtml(files, currentRel)}
    </div>

    <div class="sidebar-footer">
      <span id="live-status" class="live-pill" title="Tự động cập nhật khi file thay đổi">🟢 Live</span>
      <button type="button" class="btn-shutdown" onclick="shutdownServer()" title="Dừng MD Live Server đang chạy ngầm">🔌 Tắt Server</button>
    </div>
  `;
}

function welcomeMainHtml(files) {
  const recentCards = config.recentDirs
    .slice(0, 6)
    .map(d => {
      const name = path.basename(d) || d;
      const isCurrent = d === currentDir;
      return `
        <button type="button" class="welcome-recent-card ${isCurrent ? 'current' : ''}" data-dir="${escapeHtml(d)}" onclick="openRecentDir(this.dataset.dir)">
          <div class="wrc-title">📁 ${escapeHtml(name)} ${isCurrent ? '<span class="wrc-tag">Đang mở</span>' : ''}</div>
          <div class="wrc-path">${escapeHtml(shortenPath(d))}</div>
        </button>
      `;
    })
    .join('');

  return `
    <div class="welcome-wrap">
      <div class="welcome-hero">
        <h2>📖 MD Live Server</h2>
        <p>Xem tài liệu Markdown trực tiếp trên máy local — không cần cấu hình <code>.env</code>.</p>
      </div>

      <div id="welcome-dropzone" class="dropzone-box">
        <div class="dz-icon">📥</div>
        <div class="dz-title">Kéo &amp; thả file <code>.md</code> hoặc cả thư mục vào đây</div>
        <div class="dz-sub">Hỗ trợ thả 1 file lẻ, nhiều file cùng lúc hoặc nguyên thư mục có thư mục con.</div>
        <div class="dz-buttons">
          <button type="button" class="btn-hero primary" onclick="pickFolder()">📂 Chọn thư mục từ máy</button>
          <button type="button" class="btn-hero" onclick="pickFile()">📄 Chọn 1 file .md</button>
        </div>
      </div>

      ${
        recentCards
          ? `<div class="welcome-section">
              <h3>🕒 Thư mục mở gần đây</h3>
              <div class="welcome-recent-grid">${recentCards}</div>
            </div>`
          : ''
      }

      <div class="welcome-section">
        <h3>📄 Tài liệu trong thư mục hiện tại (${files.length})</h3>
        ${
          files.length > 0
            ? `<div class="welcome-file-list">${files
                .slice(0, 12)
                .map(f => {
                  const rel = path.relative(currentDir, f).replace(/\\/g, '/');
                  return `<a class="welcome-file-chip" href="/?path=${encodeURIComponent(rel)}">📝 ${escapeHtml(rel)}</a>`;
                })
                .join('')}${files.length > 12 ? `<span class="welcome-more">...và ${files.length - 12} file khác ở thanh bên trái</span>` : ''}</div>`
            : `<p style="color:#656d76;font-size:13px;">Thư mục <code>${escapeHtml(shortenPath(currentDir))}</code> hiện chưa có file <code>.md</code> nào.</p>`
        }
      </div>

      <p style="font-size:12px;color:#8c959f;margin-top:28px;">💡 Tip: Khi đang đọc bài, bôi đen bất kỳ đoạn văn bản nào để tạo ghi chú và gửi cho AI Agent.</p>
    </div>
  `;
}

function shell(title, sidebarContent, mainContent, currentRel) {
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="icon" href="/icon.png">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="apple-touch-icon" href="/icon.png">
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
      width: 330px;
      flex-shrink: 0;
      border-right: 1px solid #d0d7de;
      background: #f6f8fa;
      padding: 12px;
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    .sidebar-header {
      font-size: 13px;
      font-weight: 700;
      color: #24292f;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      letter-spacing: 0.3px;
    }
    .sidebar-badge {
      font-size: 11px;
      background: #0969da;
      color: #fff;
      padding: 2px 7px;
      border-radius: 10px;
      font-weight: 600;
    }
    .workspace-card {
      background: #ffffff;
      border: 1px solid #d0d7de;
      border-radius: 8px;
      padding: 10px;
      margin-bottom: 10px;
    }
    .ws-current { margin-bottom: 8px; }
    .ws-label {
      font-size: 10px;
      font-weight: 700;
      color: #656d76;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }
    .ws-name {
      font-size: 13px;
      font-weight: 600;
      color: #1f2328;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ws-path {
      font-size: 11px;
      color: #656d76;
      font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ws-actions {
      display: flex;
      gap: 6px;
    }
    .btn-ws {
      flex: 1;
      background: #f6f8fa;
      color: #24292f;
      border: 1px solid #d0d7de;
      border-radius: 6px;
      padding: 6px 8px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.12s, border-color 0.12s;
      white-space: nowrap;
    }
    .btn-ws:hover:not(:disabled) { background: #eaeef2; border-color: #afb8c1; }
    .btn-ws:disabled { opacity: 0.6; cursor: wait; }
    .btn-ws.btn-primary {
      background: #0969da;
      color: #ffffff;
      border-color: #0969da;
    }
    .btn-ws.btn-primary:hover:not(:disabled) { background: #0550ae; border-color: #0550ae; }
    .btn-ws.btn-full { width: 100%; display: block; }
    #manual-path-input {
      flex: 1;
      min-width: 0;
      padding: 5px 8px;
      border: 1px solid #d0d7de;
      border-radius: 6px;
      font-size: 12px;
      outline: none;
    }
    #manual-path-input:focus { border-color: #0969da; }

    .recent-details {
      margin-top: 8px;
      border-top: 1px solid #eaeef2;
      padding-top: 6px;
    }
    .recent-details summary {
      font-size: 12px;
      font-weight: 600;
      color: #57606a;
      cursor: pointer;
      user-select: none;
      list-style: none;
    }
    .recent-details summary::-webkit-details-marker { display: none; }
    .recent-list {
      margin-top: 6px;
      max-height: 140px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .recent-empty { font-size: 11px; color: #8c959f; padding: 4px 2px; }
    .recent-item {
      display: flex;
      align-items: center;
      gap: 4px;
      border-radius: 5px;
    }
    .recent-item:hover { background: #f6f8fa; }
    .recent-open {
      flex: 1;
      min-width: 0;
      text-align: left;
      background: transparent;
      border: none;
      padding: 4px 6px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
    }
    .recent-name {
      font-size: 12px;
      font-weight: 500;
      color: #24292f;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .recent-path {
      font-size: 10px;
      color: #656d76;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .recent-del {
      background: transparent;
      border: none;
      color: #8c959f;
      cursor: pointer;
      padding: 4px 6px;
      font-size: 11px;
      border-radius: 4px;
    }
    .recent-del:hover { color: #cf222e; background: #ffebe9; }

    .tree-toolbar {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-bottom: 8px;
    }
    #search {
      flex: 1;
      min-width: 0;
      padding: 6px 10px;
      border: 1px solid #d0d7de;
      border-radius: 6px;
      font-size: 13px;
      outline: none;
      background: #ffffff;
    }
    #search:focus { border-color: #0969da; box-shadow: 0 0 0 3px rgba(9,105,218,0.15); }
    .btn-tree-tool {
      flex: 0 0 auto;
      width: 28px;
      height: 30px;
      border: 1px solid #d0d7de;
      border-radius: 6px;
      background: #ffffff;
      color: #57606a;
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .btn-tree-tool:hover { background: #eaeef2; color: #24292f; }

    .tree {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      min-height: 60px;
      padding-right: 2px;
    }
    .tree-folder {
      margin: 1px 0;
    }
    .tree-folder-summary {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 4px 6px;
      border-radius: 6px;
      cursor: pointer;
      user-select: none;
      list-style: none;
      font-size: 13px;
      font-weight: 500;
      color: #1f2328;
    }
    .tree-folder-summary::-webkit-details-marker { display: none; }
    .tree-folder-summary:hover { background: #eaeef2; }
    .folder-chevron {
      font-size: 9px;
      color: #656d76;
      width: 12px;
      text-align: center;
      flex-shrink: 0;
      transition: transform 0.12s ease;
    }
    .tree-folder[open] > .tree-folder-summary .folder-chevron {
      transform: rotate(90deg);
    }
    .folder-icon {
      flex-shrink: 0;
      font-size: 13px;
      line-height: 1;
    }
    .folder-icon::before { content: "📁"; }
    .tree-folder[open] > .tree-folder-summary .folder-icon::before { content: "📂"; }
    .folder-name {
      flex: 1;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .folder-count {
      flex-shrink: 0;
      font-size: 10px;
      color: #656d76;
      background: #eaeef2;
      padding: 1px 6px;
      border-radius: 999px;
      font-weight: 600;
    }
    .tree-children {
      margin-left: 11px;
      padding-left: 8px;
      border-left: 1px solid #d8dee4;
    }
    .tree-file {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      margin: 1px 0;
      border-radius: 6px;
      font-size: 13px;
      color: #24292f;
      text-decoration: none;
    }
    .tree-file:hover { background: #eaeef2; text-decoration: none; }
    .tree-file.active { background: #ddf4ff; color: #0969da; font-weight: 600; }
    .file-icon {
      flex-shrink: 0;
      font-size: 12px;
      opacity: 0.78;
    }
    .file-name {
      flex: 1;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .empty-tree {
      font-size: 12px;
      color: #656d76;
      padding: 14px 8px;
      line-height: 1.5;
      text-align: center;
    }

    .sidebar-footer {
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px solid #d0d7de;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .live-pill {
      font-size: 11px;
      color: #1a7f37;
      background: #dafbe1;
      padding: 3px 8px;
      border-radius: 999px;
      font-weight: 600;
    }
    .live-pill.offline { color: #9a6700; background: #fff8c5; }
    .btn-shutdown {
      background: #ffffff;
      color: #cf222e;
      border: 1px solid #d0d7de;
      border-radius: 6px;
      padding: 4px 9px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-shutdown:hover { background: #ffebe9; border-color: #cf222e; }

    #main-scroll {
      flex: 1;
      overflow-y: auto;
      height: 100vh;
    }
    #main {
      padding: 32px 48px 64px;
      max-width: 960px;
      margin: 0 auto;
      line-height: 1.65;
    }
    a { color: #0969da; text-decoration: none; }
    a:hover { text-decoration: underline; }
    img { max-width: 100%; height: auto; }
    h1, h2, h3 { color: #1f2328; }
    article h1, article h2 { border-bottom: 1px solid #eaeef2; padding-bottom: 0.3em; }
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
      margin: 12px 0;
      padding: 4px 1em;
      color: #57606a;
      background: #f8fafc;
      border-radius: 0 4px 4px 0;
    }

    /* Welcome & Dropzone */
    .welcome-wrap { padding: 12px 0; }
    .welcome-hero h2 { margin: 0 0 6px; font-size: 26px; }
    .welcome-hero p { margin: 0 0 22px; color: #57606a; font-size: 15px; }
    .dropzone-box {
      border: 2px dashed #80b3ff;
      background: #f4f9ff;
      border-radius: 14px;
      padding: 36px 24px;
      text-align: center;
      transition: background 0.15s, border-color 0.15s, transform 0.15s;
    }
    .dropzone-box.drag-active {
      background: #ddf4ff;
      border-color: #0969da;
      transform: scale(1.01);
    }
    .dz-icon { font-size: 40px; margin-bottom: 8px; }
    .dz-title { font-size: 17px; font-weight: 600; color: #1f2328; margin-bottom: 6px; }
    .dz-sub { font-size: 13px; color: #57606a; margin-bottom: 18px; }
    .dz-buttons { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
    .btn-hero {
      padding: 9px 16px;
      border-radius: 8px;
      border: 1px solid #d0d7de;
      background: #ffffff;
      color: #24292f;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-hero:hover { background: #f6f8fa; }
    .btn-hero.primary { background: #0969da; color: #ffffff; border-color: #0969da; }
    .btn-hero.primary:hover { background: #0550ae; }

    .welcome-section { margin-top: 28px; }
    .welcome-section h3 { font-size: 15px; margin: 0 0 12px; color: #1f2328; }
    .welcome-recent-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 10px;
    }
    .welcome-recent-card {
      text-align: left;
      background: #ffffff;
      border: 1px solid #d0d7de;
      border-radius: 8px;
      padding: 10px 12px;
      cursor: pointer;
      transition: border-color 0.12s, box-shadow 0.12s;
    }
    .welcome-recent-card:hover { border-color: #0969da; box-shadow: 0 2px 8px rgba(9,105,218,0.1); }
    .welcome-recent-card.current { border-color: #0969da; background: #f4f9ff; }
    .wrc-title { font-size: 13px; font-weight: 600; color: #1f2328; margin-bottom: 4px; display: flex; align-items: center; gap: 6px; }
    .wrc-tag { font-size: 10px; background: #0969da; color: #fff; padding: 1px 6px; border-radius: 999px; }
    .wrc-path { font-size: 11px; color: #656d76; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .welcome-file-list { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .welcome-file-chip {
      display: inline-block;
      padding: 5px 10px;
      background: #f6f8fa;
      border: 1px solid #d0d7de;
      border-radius: 6px;
      font-size: 12px;
      color: #24292f;
    }
    .welcome-file-chip:hover { border-color: #0969da; color: #0969da; text-decoration: none; }
    .welcome-more { font-size: 12px; color: #656d76; }

    /* Global Drag & Drop Overlay */
    #drop-overlay {
      position: fixed;
      inset: 0;
      background: rgba(9, 105, 218, 0.14);
      backdrop-filter: blur(3px);
      z-index: 9999;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    #drop-overlay.open { display: flex; }
    .drop-overlay-card {
      background: #ffffff;
      border: 3px dashed #0969da;
      border-radius: 16px;
      padding: 40px 56px;
      text-align: center;
      box-shadow: 0 20px 50px rgba(0,0,0,0.18);
      max-width: 520px;
    }
    .drop-overlay-card h2 { margin: 8px 0 6px; font-size: 20px; }
    .drop-overlay-card p { margin: 0; color: #57606a; font-size: 14px; }

    /* Toast */
    #toast {
      position: fixed;
      top: 16px;
      right: 20px;
      background: #1f2328;
      color: #ffffff;
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
      z-index: 10000;
      display: none;
    }
    #toast.error { background: #cf222e; }

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
  <div id="sidebar">${sidebarContent}</div>
  <div id="main-scroll"><div id="main">${mainContent}</div></div>

  <div id="drop-overlay">
    <div class="drop-overlay-card">
      <div style="font-size:48px;">📥</div>
      <h2>Thả file .md hoặc thư mục vào đây</h2>
      <p>Hệ thống sẽ tự động quét các file Markdown và mở xem ngay lập tức.</p>
    </div>
  </div>

  <div id="toast"></div>

  <script>
    let selectedText = '';
    let chatOpen = false;
    let currentRel = ${JSON.stringify(currentRel || '')};
    let toastTimer = null;

    function showToast(msg, isError = false, duration = 3500) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.className = isError ? 'error' : '';
      el.style.display = 'block';
      clearTimeout(toastTimer);
      if (duration > 0) {
        toastTimer = setTimeout(() => { el.style.display = 'none'; }, duration);
      }
    }

    function openChat() {
      const p = document.getElementById('chat-panel');
      const f = document.getElementById('chat-fab');
      if (p) p.classList.add('open');
      if (f) f.classList.add('hidden');
      chatOpen = true;
    }

    function closeChat() {
      const p = document.getElementById('chat-panel');
      const f = document.getElementById('chat-fab');
      if (p) p.classList.remove('open');
      if (f) f.classList.remove('hidden');
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

    // --- Workspace Pickers ---
    async function pickFolder() {
      const btn = document.getElementById('btn-pick-folder');
      if (btn) btn.disabled = true;
      showToast('Đang mở hộp thoại chọn thư mục...', false, 0);
      try {
        const res = await fetch('/api/pick-folder', { method: 'POST' });
        const j = await res.json();
        document.getElementById('toast').style.display = 'none';
        if (j.cancelled) return;
        if (!j.ok) {
          showToast(j.error || 'Không thể chọn thư mục', true);
          return;
        }
        window.location.href = '/';
      } catch (e) {
        showToast('Lỗi chọn thư mục: ' + e.message, true);
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    async function pickFile() {
      const btn = document.getElementById('btn-pick-file');
      if (btn) btn.disabled = true;
      showToast('Đang mở hộp thoại chọn file...', false, 0);
      try {
        const res = await fetch('/api/pick-file', { method: 'POST' });
        const j = await res.json();
        document.getElementById('toast').style.display = 'none';
        if (j.cancelled) return;
        if (!j.ok) {
          showToast(j.error || 'Không thể chọn file', true);
          return;
        }
        window.location.href = j.openPath ? ('/?path=' + encodeURIComponent(j.openPath)) : '/';
      } catch (e) {
        showToast('Lỗi chọn file: ' + e.message, true);
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    function togglePathInput() {
      const box = document.getElementById('path-input-box');
      const isHidden = box.style.display === 'none';
      box.style.display = isHidden ? 'block' : 'none';
      if (isHidden) document.getElementById('manual-path-input').focus();
    }

    async function submitManualPath() {
      const input = document.getElementById('manual-path-input');
      const p = input.value.trim();
      if (!p) return;
      await switchWorkspacePath(p);
    }

    async function openRecentDir(dirPath) {
      await switchWorkspacePath(dirPath);
    }

    async function switchWorkspacePath(targetPath) {
      try {
        const res = await fetch('/api/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: targetPath })
        });
        const j = await res.json();
        if (!j.ok) {
          showToast(j.error || 'Đường dẫn không hợp lệ', true);
          return;
        }
        window.location.href = j.openPath ? ('/?path=' + encodeURIComponent(j.openPath)) : '/';
      } catch (e) {
        showToast('Lỗi chuyển thư mục: ' + e.message, true);
      }
    }

    async function removeRecentDir(event, dirPath) {
      event.stopPropagation();
      try {
        const res = await fetch('/api/workspace/recent', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: dirPath })
        });
        const j = await res.json();
        if (j.ok) {
          window.location.reload();
        }
      } catch {}
    }

    async function shutdownServer() {
      if (!confirm('Tắt MD Live Server đang chạy ngầm?')) return;
      try {
        await fetch('/api/shutdown', { method: 'POST' });
      } catch {}
      document.body.innerHTML = '<div style="margin:auto;text-align:center;font-family:sans-serif;padding:40px;"><h2>🔌 MD Live Server đã tắt</h2><p style="color:#656d76">Bạn có thể đóng tab trình duyệt này hoặc mở lại App bất cứ lúc nào.</p></div>';
    }

    // --- Drag & Drop (Single files, Multiple files, or Entire Folders) ---
    function readEntryFiles(entry, basePath = '') {
      return new Promise((resolve) => {
        if (!entry) return resolve([]);
        if (entry.isFile) {
          entry.file(file => {
            const relPath = basePath ? (basePath + '/' + file.name) : file.name;
            resolve([{ file, relPath }]);
          }, () => resolve([]));
        } else if (entry.isDirectory) {
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.notes') {
            return resolve([]);
          }
          const dirReader = entry.createReader();
          const allEntries = [];
          const readBatch = () => {
            dirReader.readEntries(async (entries) => {
              if (!entries.length) {
                const nested = await Promise.all(
                  allEntries.map(child => readEntryFiles(child, basePath ? (basePath + '/' + entry.name) : entry.name))
                );
                resolve(nested.flat());
              } else {
                allEntries.push(...entries);
                readBatch();
              }
            }, () => resolve([]));
          };
          readBatch();
        } else {
          resolve([]);
        }
      });
    }

    async function extractDroppedMarkdownFiles(dataTransfer) {
      let collected = [];
      const items = dataTransfer.items ? Array.from(dataTransfer.items) : [];
      const entries = items
        .map(it => (typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null))
        .filter(Boolean);

      if (entries.length > 0) {
        const nested = await Promise.all(entries.map(ent => readEntryFiles(ent, '')));
        collected = nested.flat();
      } else if (dataTransfer.files) {
        collected = Array.from(dataTransfer.files).map(file => ({
          file,
          relPath: file.webkitRelativePath || file.name
        }));
      }

      const mdEntries = collected.filter(({ file, relPath }) => {
        const name = file.name || '';
        if (name.startsWith('._') || name.startsWith('.')) return false;
        return /\\.(md|markdown)$/i.test(relPath);
      });

      const payloadFiles = await Promise.all(
        mdEntries.map(async ({ file, relPath }) => ({
          path: relPath,
          content: await file.text()
        }))
      );

      const label = entries.length === 1 && entries[0].isDirectory
        ? ('Thư mục: ' + entries[0].name)
        : (payloadFiles.length === 1 ? payloadFiles[0].path : (payloadFiles.length + ' file Markdown'));

      return { files: payloadFiles, label };
    }

    let dragCounter = 0;
    window.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      e.preventDefault();
      dragCounter++;
      document.getElementById('drop-overlay').classList.add('open');
      const dz = document.getElementById('welcome-dropzone');
      if (dz) dz.classList.add('drag-active');
    });

    window.addEventListener('dragover', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    window.addEventListener('dragleave', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) {
        document.getElementById('drop-overlay').classList.remove('open');
        const dz = document.getElementById('welcome-dropzone');
        if (dz) dz.classList.remove('drag-active');
      }
    });

    window.addEventListener('drop', async (e) => {
      if (!e.dataTransfer || (!e.dataTransfer.items?.length && !e.dataTransfer.files?.length)) return;
      e.preventDefault();
      dragCounter = 0;
      document.getElementById('drop-overlay').classList.remove('open');
      const dz = document.getElementById('welcome-dropzone');
      if (dz) dz.classList.remove('drag-active');

      showToast('Đang đọc file Markdown vừa thả...', false, 0);
      try {
        const { files, label } = await extractDroppedMarkdownFiles(e.dataTransfer);
        if (!files.length) {
          showToast('Không tìm thấy file .md hoặc .markdown hợp lệ!', true);
          return;
        }
        const res = await fetch('/api/drop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files, label })
        });
        const j = await res.json();
        if (!j.ok) {
          showToast(j.error || 'Không thể mở file kéo thả', true);
          return;
        }
        window.location.href = '/?path=' + encodeURIComponent(j.openPath);
      } catch (err) {
        showToast('Lỗi xử lý kéo thả: ' + err.message, true);
      }
    });

    // --- Live Reload (SSE) ---
    function connectLiveReload() {
      const pill = document.getElementById('live-status');
      const es = new EventSource('/api/events');
      es.onopen = () => {
        if (pill) { pill.textContent = '🟢 Live'; pill.classList.remove('offline'); }
      };
      es.addEventListener('reload', async () => {
        try {
          if (currentRel) {
            const res = await fetch('/api/file?path=' + encodeURIComponent(currentRel));
            if (res.ok) {
              const data = await res.json();
              const article = document.getElementById('doc-article');
              if (article && data.html !== undefined) {
                article.innerHTML = data.html;
              }
            }
          }
          const filesRes = await fetch('/api/files');
          if (filesRes.ok) {
            const files = await filesRes.json();
            const badge = document.getElementById('file-count-badge');
            if (badge) badge.textContent = files.length;
          }
        } catch {}
      });
      es.onerror = () => {
        if (pill) { pill.textContent = '🟡 Reconnecting'; pill.classList.add('offline'); }
      };
    }
    connectLiveReload();

    // --- Highlight-to-Note & AI Agent ---
    document.addEventListener('mouseup', (e) => {
      if (e.target.closest('#note-popup, #chat-panel, #sidebar, input, textarea, button')) return;
      const sel = window.getSelection().toString().trim();
      if (sel.length > 3) {
        selectedText = sel;
        const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
        const p = document.getElementById('note-popup');
        p.style.display = 'block';
        p.style.left = Math.max(12, Math.min(r.left, window.innerWidth - 340)) + 'px';
        p.style.top = Math.min(r.bottom + 8, window.innerHeight - 190) + 'px';
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
      const filePath = new URLSearchParams(location.search).get('path') || '';
      const userText = (selectedText ? ('> ' + selectedText + '\\n\\n') : '') + note;
      closePopup();
      openChat();
      addMsg('user', userText);
      const agentEl = addMsg('agent', '⏳ Agent đang xử lý...');

      try {
        const res = await fetch('/api/note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: filePath, selection: selectedText, note })
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
      const filePath = new URLSearchParams(location.search).get('path') || '';

      try {
        const res = await fetch('/api/note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: filePath, selection: '', note: text })
        });
        if (!res.body || !res.headers.get('content-type')?.includes('text/event-stream')) {
          const j = await res.json().catch(() => ({}));
          agentEl.textContent = j.message || 'Đã lưu ghi chú!';
          return;
        }
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

    // --- Hierarchical Folder Tree State & Search ---
    const TREE_STORAGE_KEY = 'mdLiveOpenFolders:' + ${JSON.stringify(currentDir)};

    function saveOpenFolders() {
      const searchEl = document.getElementById('search');
      if (searchEl && searchEl.value.trim() !== '') return;
      const openList = Array.from(document.querySelectorAll('#file-tree .tree-folder[open]'))
        .map(d => d.dataset.folder)
        .filter(Boolean);
      try {
        sessionStorage.setItem(TREE_STORAGE_KEY, JSON.stringify(openList));
      } catch {}
    }

    function restoreOpenFolders() {
      try {
        const raw = sessionStorage.getItem(TREE_STORAGE_KEY);
        if (raw) {
          const saved = new Set(JSON.parse(raw));
          document.querySelectorAll('#file-tree .tree-folder').forEach(folder => {
            const p = folder.dataset.folder;
            const isAncestor = Boolean(currentRel) && (currentRel === p || currentRel.startsWith(p + '/'));
            folder.open = isAncestor || saved.has(p);
          });
        }
      } catch {}

      const activeFile = document.querySelector('#file-tree .tree-file.active');
      if (activeFile) {
        activeFile.scrollIntoView({ block: 'nearest' });
      }
    }

    function expandAllFolders() {
      document.querySelectorAll('#file-tree .tree-folder').forEach(folder => {
        if (folder.style.display !== 'none') folder.open = true;
      });
      saveOpenFolders();
    }

    function collapseAllFolders() {
      document.querySelectorAll('#file-tree .tree-folder').forEach(folder => {
        folder.open = false;
      });
      saveOpenFolders();
    }

    restoreOpenFolders();

    const fileTreeEl = document.getElementById('file-tree');
    if (fileTreeEl) {
      fileTreeEl.addEventListener('toggle', (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('tree-folder')) {
          saveOpenFolders();
        }
      }, true);
    }

    // Search filter across hierarchical folder tree
    document.addEventListener('input', (e) => {
      if (e.target.id === 'search') {
        const q = e.target.value.trim().toLowerCase();
        const folders = document.querySelectorAll('#file-tree .tree-folder');
        const files = document.querySelectorAll('#file-tree .tree-file');

        if (q) {
          folders.forEach(folder => {
            if (folder.dataset.wasOpen === undefined) {
              folder.dataset.wasOpen = folder.open ? '1' : '0';
            }
          });
          files.forEach(a => {
            const target = (a.dataset.path || a.textContent).toLowerCase();
            a.style.display = target.includes(q) ? '' : 'none';
          });
          folders.forEach(folder => {
            const hasMatch = Array.from(folder.querySelectorAll('.tree-file')).some(a => a.style.display !== 'none');
            folder.style.display = hasMatch ? '' : 'none';
            folder.open = hasMatch;
          });
        } else {
          files.forEach(a => { a.style.display = ''; });
          folders.forEach(folder => {
            folder.style.display = '';
            if (folder.dataset.wasOpen !== undefined) {
              folder.open = folder.dataset.wasOpen === '1';
              delete folder.dataset.wasOpen;
            }
          });
        }
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

// --- 9. HTTP Server ---
const ICON_PATH = path.join(APP_ROOT, 'icon.png');
const MANIFEST_JSON = JSON.stringify({
  id: '/',
  name: 'MD Live Server',
  short_name: 'MD Live',
  start_url: '/',
  display: 'standalone',
  background_color: '#ffffff',
  theme_color: '#ffffff',
  icons: [{ src: '/icon.png', sizes: '512x512', type: 'image/png' }],
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${activePort}`);

  // Static: App Icon & PWA Manifest
  if (url.pathname === '/icon.png' && req.method === 'GET') {
    if (fs.existsSync(ICON_PATH)) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      fs.createReadStream(ICON_PATH).pipe(res);
    } else {
      res.writeHead(404);
      res.end();
    }
    return;
  }

  if (url.pathname === '/manifest.webmanifest' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8' });
    res.end(MANIFEST_JSON);
    return;
  }

  // API: Workspace metadata
  if (url.pathname === '/api/workspace' && req.method === 'GET') {
    const files = walk(currentDir);
    sendJson(res, 200, {
      app: 'md-live-server',
      currentDir,
      isDroppedWorkspace: currentDir === DROPPED_DIR,
      droppedLabel: currentDir === DROPPED_DIR ? droppedLabel : null,
      recentDirs: config.recentDirs,
      filesCount: files.length,
      port: activePort,
      host: HOST,
      agentEnabled: AGENT_ENABLED,
    });
    return;
  }

  // API: Switch workspace by path (folder or single .md file)
  if (url.pathname === '/api/workspace' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const rawPath = (body.path || '').trim();
      if (!rawPath) {
        sendJson(res, 400, { ok: false, error: 'Vui lòng nhập đường dẫn.' });
        return;
      }

      const expanded = expandHome(rawPath);
      const resolved = path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(currentDir, expanded);
      if (!fs.existsSync(resolved)) {
        sendJson(res, 404, { ok: false, error: `Đường dẫn không tồn tại: ${resolved}` });
        return;
      }

      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        setWorkspaceDir(resolved);
        sendJson(res, 200, { ok: true, currentDir, recentDirs: config.recentDirs });
        return;
      }
      if (stat.isFile()) {
        if (!isMarkdownFile(resolved)) {
          sendJson(res, 400, { ok: false, error: 'File được chọn không phải file Markdown (.md/.markdown).' });
          return;
        }
        setWorkspaceDir(path.dirname(resolved));
        sendJson(res, 200, {
          ok: true,
          currentDir,
          recentDirs: config.recentDirs,
          openPath: path.basename(resolved),
        });
        return;
      }

      sendJson(res, 400, { ok: false, error: 'Đường dẫn không hợp lệ.' });
    } catch (err) {
      sendJson(res, err.statusCode || 500, { ok: false, error: err.message });
    }
    return;
  }

  // API: Remove entry from recentDirs
  if (url.pathname === '/api/workspace/recent' && req.method === 'DELETE') {
    try {
      const body = await readJsonBody(req);
      const target = body.path;
      config.recentDirs = config.recentDirs.filter(d => d !== target);
      saveConfig(config);
      sendJson(res, 200, { ok: true, recentDirs: config.recentDirs });
    } catch (err) {
      sendJson(res, err.statusCode || 500, { ok: false, error: err.message });
    }
    return;
  }

  // API: Native OS Folder Picker
  if (url.pathname === '/api/pick-folder' && req.method === 'POST') {
    try {
      const result = await pickFolderNative();
      if (result.cancelled) {
        sendJson(res, 200, { ok: false, cancelled: true });
        return;
      }
      setWorkspaceDir(result.path);
      sendJson(res, 200, { ok: true, currentDir, recentDirs: config.recentDirs });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  // API: Native OS File Picker
  if (url.pathname === '/api/pick-file' && req.method === 'POST') {
    try {
      const result = await pickFileNative();
      if (result.cancelled) {
        sendJson(res, 200, { ok: false, cancelled: true });
        return;
      }
      const chosen = path.resolve(result.path);
      if (!fs.existsSync(chosen) || !fs.statSync(chosen).isFile()) {
        sendJson(res, 404, { ok: false, error: 'File không tồn tại.' });
        return;
      }
      if (!isMarkdownFile(chosen)) {
        sendJson(res, 400, { ok: false, error: 'Vui lòng chọn file có đuôi .md hoặc .markdown.' });
        return;
      }
      setWorkspaceDir(path.dirname(chosen));
      sendJson(res, 200, {
        ok: true,
        currentDir,
        recentDirs: config.recentDirs,
        openPath: path.basename(chosen),
      });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  // API: Drag & Drop files/folders from browser
  if (url.pathname === '/api/drop' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req, MAX_DROP_BYTES);
      const rawFiles = Array.isArray(body.files) ? body.files : [];
      const validEntries = [];

      for (const item of rawFiles) {
        if (!item || typeof item.path !== 'string') continue;
        const normalizedRel = item.path
          .replace(/\\/g, '/')
          .split('/')
          .filter(seg => seg && seg !== '.' && seg !== '..')
          .join('/');

        if (!normalizedRel || !isMarkdownFile(normalizedRel)) continue;
        validEntries.push({
          rel: normalizedRel,
          content: typeof item.content === 'string' ? item.content : '',
        });
      }

      if (validEntries.length === 0) {
        sendJson(res, 400, { ok: false, error: 'Không tìm thấy file .md hợp lệ trong dữ liệu vừa thả.' });
        return;
      }

      fs.rmSync(DROPPED_DIR, { recursive: true, force: true });
      fs.mkdirSync(DROPPED_DIR, { recursive: true });

      const savedPaths = [];
      for (const entry of validEntries) {
        const dest = path.resolve(DROPPED_DIR, entry.rel);
        if (dest !== DROPPED_DIR && !dest.startsWith(DROPPED_DIR + path.sep)) continue;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, entry.content, 'utf8');
        savedPaths.push(entry.rel);
      }

      setWorkspaceDir(DROPPED_DIR, {
        saveRecent: false,
        label: typeof body.label === 'string' && body.label.trim() ? body.label.trim() : null,
      });

      sendJson(res, 200, {
        ok: true,
        currentDir,
        openPath: savedPaths[0],
        count: savedPaths.length,
        files: savedPaths,
      });
    } catch (err) {
      sendJson(res, err.statusCode || 500, { ok: false, error: err.message });
    }
    return;
  }

  // API: SSE Live Reload stream
  if (url.pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    sseClients.add(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {}
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
    return;
  }

  // API: Shutdown background server
  if (url.pathname === '/api/shutdown' && req.method === 'POST') {
    sendJson(res, 200, { ok: true, message: 'Server đang tắt...' });
    setTimeout(() => {
      for (const client of sseClients) {
        try {
          client.end();
        } catch {}
      }
      if (fsWatcher) {
        try {
          fsWatcher.close();
        } catch {}
      }
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 500).unref();
    }, 80);
    return;
  }

  // API: List files
  if (url.pathname === '/api/files') {
    const files = walk(currentDir).map(f => path.relative(currentDir, f).replace(/\\/g, '/'));
    sendJson(res, 200, files);
    return;
  }

  // API: Get file content
  if (url.pathname === '/api/file') {
    const rel = url.searchParams.get('path') || '';
    const abs = safePath(rel);
    if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      sendJson(res, 404, { error: 'File not found' });
      return;
    }
    const md = fs.readFileSync(abs, 'utf8');
    const html = marked.parse(md);
    sendJson(res, 200, { rel, html, md });
    return;
  }

  // API: Note -> Agent integration
  if (url.pathname === '/api/note' && req.method === 'POST') {
    try {
      const { path: rel, selection, note } = await readJsonBody(req);
      const prompt = `[WEB NOTE] File: ${rel || '(no file)'}\nSelection:\n> ${selection || '(empty)'}\nNote:\n${note || '(empty)'}`;

      // 1) Save note to disk
      const notesDir = getNotesDir();
      fs.mkdirSync(notesDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const noteFile = path.join(notesDir, `${ts}.md`);
      fs.writeFileSync(
        noteFile,
        `# Note from Web Viewer\n\n${prompt}\n\n- Time: ${new Date().toLocaleString('vi-VN')}\n`
      );
      console.log(`[note] Created note: ${path.relative(currentDir, noteFile)}`);

      // 2) Trigger Agent if enabled
      const useAgent = AGENT_ENABLED && url.searchParams.get('agent') !== '0';
      if (!useAgent) {
        sendJson(res, 200, { ok: true, message: `Đã lưu note vào: ${noteFile}` });
        return;
      }

      // SSE Streaming response
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const [cmd, ...cmdArgs] = AGENT_COMMAND.trim().split(/\s+/);
      const finalArgs = [...cmdArgs, prompt];
      console.log(`[agent] Executing: ${cmd} ${cmdArgs.join(' ')} "<prompt: ${prompt.length} chars>"`);

      const child = spawn(cmd, finalArgs, {
        cwd: currentDir,
        env: process.env,
        shell: false,
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
          res.write(`data: ${JSON.stringify({ done: true, code, file: noteFile })}\n\n`);
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
      sendJson(res, e.statusCode || 500, { ok: false, message: e.message });
    }
    return;
  }

  // Page: Viewer
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const files = walk(currentDir);
    const rel = url.searchParams.get('path') || '';
    let mainHtml = welcomeMainHtml(files);
    let title = 'MD Live Server';

    if (rel) {
      const abs = safePath(rel);
      if (abs && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        const md = fs.readFileSync(abs, 'utf8');
        const body = marked.parse(md);
        title = path.basename(rel) + ' — MD Live Server';
        mainHtml = `
          <div style="margin-bottom: 24px; padding-bottom: 12px; border-bottom: 1px solid #d0d7de;">
            <h1 style="margin: 0 0 6px 0; font-size: 24px;">${escapeHtml(path.basename(rel))}</h1>
            <div style="font-size: 12px; color: #656d76; font-family: monospace;">${escapeHtml(rel)}</div>
          </div>
          <article id="doc-article">${body}</article>
        `;
      } else {
        mainHtml = `
          <div style="padding:20px 0;">
            <p style="color:#cf222e;font-weight:600;">⚠️ File không tồn tại hoặc ngoài phạm vi thư mục tài liệu hiện tại.</p>
            <p><a href="/">← Quay lại trang chính</a></p>
          </div>
        `;
      }
    }

    const html = shell(title, sidebarHtml(files, rel), mainHtml, rel);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
});

function startServer(portToTry, attempt = 0) {
  const onError = async err => {
    server.removeListener('listening', onListening);
    if (err.code === 'EADDRINUSE') {
      const isSelf = await isMdLiveServerRunning(portToTry);
      if (isSelf) {
        const url = getDisplayUrl(portToTry);
        console.log(`ℹ️  MD Live Server is already running at: ${url}`);
        if (AUTO_OPEN) {
          openBrowser(url);
          setTimeout(() => process.exit(0), 250);
          return;
        }
      }
      if (attempt < 10) {
        const nextPort = portToTry + 1;
        console.log(`⚠️  Port ${portToTry} in use, trying port ${nextPort}...`);
        startServer(nextPort, attempt + 1);
        return;
      }
    }
    console.error('❌ Failed to start server:', err.message);
    process.exit(1);
  };

  const onListening = () => {
    server.removeListener('error', onError);
    activePort = server.address().port;
    restartWatcher();
    const displayUrl = getDisplayUrl(activePort);
    console.log(`\n🚀 MD Live Server is running at: ${displayUrl}`);
    console.log(`📁 Serving documents from:      ${currentDir}`);
    console.log(`🤖 AI Agent Integration:        ${AGENT_ENABLED ? `Enabled (${AGENT_COMMAND})` : 'Disabled'}`);
    console.log(`📝 Notes saved to:              ${getNotesDir()}\n`);
    if (AUTO_OPEN) {
      openBrowser(displayUrl);
    }
  };

  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(portToTry, HOST);
}

startServer(PORT);
