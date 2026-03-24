// ── Single-page application ───────────────────────────────────────────────────

export function renderUI(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Project Plan</title>
<style>
html{--bg:#0f0f10;--fg:#e2e2e5;--muted:#888;--muted-2:#666;--border:#2a2a30;--border-2:#3a3a42;--panel:#16161a;--panel-2:#1e1e24;--panel-hover:#2a2a30;--panel-hover-2:#333340;--panel-active:#1e2a4a;--text-strong:#d0d0da;--text-soft:#c8c8d0;--empty:#555;--input-focus:#5a7ef8;--error-bg:#2a0f0f;--error-border:#5a1a1a;--error-text:#f87171;--log-bg:#1e1e24;color-scheme:dark}
html[data-theme-mode="light"]{--bg:#f5f7fb;--fg:#1f2937;--muted:#64748b;--muted-2:#475569;--border:#dbe3ef;--border-2:#cbd5e1;--panel:#ffffff;--panel-2:#f8fafc;--panel-hover:#edf2f7;--panel-hover-2:#e2e8f0;--panel-active:#dbeafe;--text-strong:#0f172a;--text-soft:#1f2937;--empty:#64748b;--input-focus:#2563eb;--error-bg:#fef2f2;--error-border:#fecaca;--error-text:#b91c1c;--log-bg:#f1f5f9;color-scheme:light}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;font-size:14px;background:var(--bg);color:var(--fg);height:100vh;overflow:hidden}
#app{display:flex;flex-direction:column;height:100%;min-height:0}
button{cursor:pointer;font-size:13px;border:none;border-radius:6px;padding:6px 14px;transition:background .15s}
button.primary{background:#3b5ef0;color:#fff} button.primary:hover{background:#2f4fdf}
button.danger{background:#8b1a1a;color:#fff} button.danger:hover{background:#a02020}
button.secondary{background:var(--panel-hover);color:var(--text-soft);border:1px solid var(--border-2)} button.secondary:hover{background:var(--panel-hover-2)}
button.icon{background:none;padding:4px 8px;color:var(--muted);border-radius:4px;border:none} button.icon:hover{background:var(--panel-hover);color:var(--fg)}
button.ghost{background:none;color:#7c9ef8;border:1px solid var(--border-2);font-size:12px;padding:4px 10px} button.ghost:hover{background:var(--panel-active)}
button:disabled{opacity:.4;cursor:default}
input,select,textarea{background:var(--panel-2);color:var(--fg);border:1px solid var(--border-2);border-radius:6px;padding:7px 10px;font-size:13px;width:100%;outline:none}
input:focus,select:focus,textarea:focus{border-color:var(--input-focus)}
input[type=file]{padding:6px}
input[type=checkbox]{width:auto;padding:0;border-radius:4px}
input[type=password]{letter-spacing:.1em}
textarea{resize:vertical;min-height:80px}
label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}
.field{margin-bottom:14px}
.row{display:flex;gap:10px;align-items:flex-start}
.row .field{flex:1}
select option{background:var(--panel-2)}
.topbar{display:flex;align-items:center;gap:12px;padding:10px 20px;background:var(--panel);border-bottom:1px solid var(--border);flex-shrink:0}
.topbar h1{font-size:16px;font-weight:600}
.topbar .spacer{flex:1}
.main{display:flex;flex:1;overflow:hidden}
.sidebar{width:240px;border-right:1px solid var(--border);display:flex;flex-direction:column;flex-shrink:0}
.sidebar-header{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border);font-size:11px;color:var(--muted-2);text-transform:uppercase;letter-spacing:.05em}
.plan-list{flex:1;overflow-y:auto;padding:6px}
.plan-item{padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:2px;user-select:none}
.plan-item:hover{background:var(--panel-2)} .plan-item.active{background:var(--panel-active)}
.plan-item .name{font-size:13px;font-weight:500;color:var(--text-strong);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.plan-item .meta{font-size:11px;color:var(--muted-2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.running-dot{display:inline-block;width:7px;height:7px;background:#4ade80;border-radius:50%;margin-right:5px;animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.content{flex:1;overflow:hidden;padding:20px;display:flex;flex-direction:column;gap:14px;min-height:0}
.empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;color:var(--empty);gap:8px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:18px}
.card-title{font-size:11px;font-weight:600;color:var(--muted-2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:14px}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:16px}
.tab{padding:8px 14px;font-size:13px;color:var(--muted);border-bottom:2px solid transparent;cursor:pointer;user-select:none}
.tab:hover{color:var(--text-soft)} .tab.active{color:#7c9ef8;border-bottom-color:#7c9ef8}
.detail-shell{display:flex;flex-direction:column;flex:1;min-height:0}
.detail-fixed{flex-shrink:0}
.detail-fixed > *{margin-bottom:14px}
.detail-fixed > *:last-child{margin-bottom:0}
.tab-body{flex:1;min-height:0;overflow-y:auto;padding-right:2px}
.tab-body.items-tab{display:flex;flex-direction:column;overflow:hidden}
.tab-body.logs-tab{display:flex;flex-direction:column;overflow:hidden}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;text-transform:uppercase}
.badge-todo{background:var(--panel-hover);color:var(--muted)}
.badge-inprogress{background:#1a3a5c;color:#7cb9f8}
.badge-blocked{background:#3a2a10;color:#f8b84a}
.badge-done{background:#0f3020;color:#4ade80}
.badge-failed{background:#3a0f0f;color:#f87171}
.badge-cancelled{background:var(--panel-2);color:var(--empty)}
.provider-tag{display:inline-block;padding:1px 7px;border-radius:3px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.tag-github{background:#1a2a1a;color:#4ade80}
.tag-gitlab{background:#2a1a10;color:#f8944a}
.tag-jira{background:#1a2050;color:#7cb9f8}
.tag-azuredevops{background:#102040;color:#7cb9f8}
.tag-local{background:var(--panel-hover);color:var(--muted)}
.item-table{width:100%;border-collapse:collapse}
.item-table th{text-align:left;font-size:11px;color:var(--muted-2);padding:5px 8px;border-bottom:1px solid var(--border);text-transform:uppercase;white-space:nowrap}
.item-table td{padding:7px 8px;border-bottom:1px solid var(--panel-2);vertical-align:middle}
.item-table tr:hover td{background:var(--panel-2)}
.item-table-wrap{flex:1;min-height:0;overflow:auto}
.item-tree{display:flex;align-items:flex-start;gap:8px}
.item-tree-prefix{font-size:11px;font-weight:700;letter-spacing:.08em;color:#7c9ef8;min-width:66px;flex-shrink:0}
.item-title-wrap{display:flex;flex-direction:column;gap:4px;min-width:0}
.item-title{font-size:13px;color:var(--text-soft);word-break:break-word}
.item-desc{font-size:12px;color:var(--muted-2);line-height:1.45}
.item-type-tag{font-size:10px;color:var(--muted-2);text-transform:uppercase;margin-right:5px;font-weight:600}
.item-actions{display:flex;gap:2px;opacity:0}
tr:hover .item-actions{opacity:1}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}
.kpi{background:var(--panel-2);border-radius:8px;padding:12px}
.kpi .klabel{font-size:10px;color:var(--muted-2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
.kpi .kval{font-size:22px;font-weight:700}
.prog-bar{height:5px;background:var(--panel-hover);border-radius:3px;overflow:hidden;margin-top:6px}
.prog-fill{height:100%;background:#3b5ef0;border-radius:3px;transition:width .4s}
.log-card{display:flex;flex-direction:column;flex:1;min-height:0}
.log-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap}
.log-toolbar-title{font-size:12px;color:var(--muted)}
.log-toolbar-actions{display:flex;gap:6px;flex-wrap:wrap}
.log-list{font-family:monospace;font-size:12px;display:flex;flex-direction:column;gap:2px;flex:1;min-height:0;overflow-y:auto}
.log-entry{display:flex;gap:8px;padding:3px 6px;border-radius:3px}
.log-entry:hover{background:var(--log-bg)}
.log-ts{color:var(--muted-2);flex-shrink:0} .log-lv-info{color:#5a7ef8} .log-lv-warn{color:#f8b84a} .log-lv-error{color:#f87171}
.log-msg{color:var(--text-soft);word-break:break-word}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:100;padding:16px}
.modal{background:var(--panel);border:1px solid var(--border-2);border-radius:12px;padding:22px;width:100%;max-width:500px;max-height:90vh;overflow-y:auto}
.modal.wide{max-width:680px}
.modal h2{font-size:15px;font-weight:600;margin-bottom:18px}
.modal-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
.error-banner{background:var(--error-bg);border:1px solid var(--error-border);color:var(--error-text);padding:9px 14px;border-radius:7px;font-size:12px;display:flex;align-items:center;justify-content:space-between;gap:10px}
.spinner{display:inline-block;width:13px;height:13px;border:2px solid #333;border-top-color:#7c9ef8;border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;margin-right:5px}
@keyframes spin{to{transform:rotate(360deg)}}
.hidden{display:none!important}
.chat-panel{display:flex;flex-direction:column;border-top:1px solid var(--border);height:280px;flex-shrink:0;background:var(--panel)}
.chat-messages{flex:1;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:6px}
.chat-msg{padding:6px 10px;border-radius:6px;font-size:13px;line-height:1.5;max-width:85%;word-break:break-word;white-space:pre-wrap}
.chat-msg.user{background:var(--panel-active);color:var(--text-strong);align-self:flex-end}
.chat-msg.assistant{background:var(--panel-2);color:var(--text-soft);align-self:flex-start}
.chat-msg.thinking{color:var(--muted);font-style:italic}
.chat-input-row{display:flex;gap:8px;padding:8px 14px;border-top:1px solid var(--border);align-items:flex-end}
.chat-input-row textarea{flex:1;min-height:36px;max-height:100px;resize:none;font-size:13px;padding:8px 10px}
.chat-input-row button{flex-shrink:0;height:36px}
.detail-header{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.detail-title{font-size:17px;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.action-bar{display:flex;gap:7px;flex-wrap:wrap;align-items:center}
/* Accounts list */
.account-group{margin-bottom:18px}
.account-group-title{font-size:11px;color:var(--muted-2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;display:flex;align-items:center;gap:8px}
.account-row{display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--panel-2);border-radius:7px;margin-bottom:5px}
.account-row .acc-name{flex:1;font-size:13px;color:var(--text-soft)}
.account-row .acc-status{font-size:11px;color:#4ade80}
.account-row .acc-status.no-token{color:var(--muted-2)}
hr.divider{border:none;border-top:1px solid var(--border);margin:4px 0}
.session-toggle{background:none;border:none;color:#7c9ef8;cursor:pointer;font-size:11px;padding:2px 6px;border-radius:3px}
.session-toggle:hover{background:var(--panel-hover)}
.session-output{background:var(--log-bg);border:1px solid var(--border);border-radius:6px;margin:6px 0 2px;padding:8px;max-height:320px;overflow-y:auto;font-family:monospace;font-size:11px}
.session-msg{padding:3px 0;border-bottom:1px solid var(--panel-2)}
.session-msg:last-child{border-bottom:none}
.session-msg .s-role{font-weight:600;margin-right:6px;text-transform:uppercase;font-size:10px}
.session-msg .s-role-assistant{color:#7c9ef8}
.session-msg .s-role-tool{color:#f8b84a}
.session-msg .s-role-system{color:#888}
.session-msg .s-content{color:var(--text-soft);white-space:pre-wrap;word-break:break-word}
.session-msg .s-tool-name{color:var(--muted-2);font-size:10px;margin-left:4px}
</style>
</head>
<body>
<div id="app">
  <div class="topbar">
    <h1>Project Plan</h1>
    <div class="spacer"></div>
    <button class="secondary" id="btn-open-accounts">🔗 Connected Accounts</button>
  </div>
  <div class="main">
    <div class="sidebar">
      <div class="sidebar-header">
        Plans
        <button class="icon" id="btn-new-plan" title="New plan">＋</button>
      </div>
      <div class="plan-list" id="plan-list"></div>
    </div>
    <div class="content" id="content">
      <div class="empty-state"><p style="color:#555">Select a plan or create a new one.</p></div>
    </div>
  </div>
</div>

<!-- New Plan Modal -->
<div class="overlay hidden" id="modal-new">
  <div class="modal">
    <h2>New Plan</h2>
    <div class="field"><label>Name *</label><input id="new-name" placeholder="My Project" autofocus/></div>
    <div class="field"><label>Description</label><textarea id="new-desc" rows="2"></textarea></div>
    <div class="modal-footer">
      <button class="secondary" id="btn-cancel-new">Cancel</button>
      <button class="primary" id="btn-create">Create</button>
    </div>
  </div>
</div>

<!-- Item Form Modal -->
<div class="overlay hidden" id="modal-item">
  <div class="modal">
    <h2 id="item-modal-title">Add Item</h2>
    <div class="row">
      <div class="field" style="flex:2"><label>Title *</label><input id="it-title"/></div>
      <div class="field"><label>Type</label>
        <select id="it-type">
          <option value="epic">Epic</option>
          <option value="task" selected>Task</option>
          <option value="subtask">Subtask</option>
        </select>
      </div>
      <div class="field"><label>Status</label>
        <select id="it-status">
          <option value="to do">To Do</option>
          <option value="in progress">In Progress</option>
          <option value="blocked">Blocked</option>
          <option value="done">Done</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
    </div>
    <div class="field"><label>Description</label><textarea id="it-desc" rows="3"></textarea></div>
    <div class="field"><label>Parent item ID (optional)</label><input id="it-parent" placeholder="Leave blank for top-level"/></div>
    <div class="field"><label>Assigned Agent ID</label><input id="it-agent" placeholder="e.g. main"/></div>
    <input type="hidden" id="it-edit-id"/>
    <div class="modal-footer">
      <button class="secondary" id="btn-item-cancel">Cancel</button>
      <button class="primary" id="btn-item-save">Save</button>
    </div>
  </div>
</div>

<!-- Upload Modal -->
<div class="overlay hidden" id="modal-upload">
  <div class="modal">
    <h2>Import Items</h2>
    <div style="font-size:12px;color:#666;margin-bottom:14px;line-height:1.6">
      Supports <strong style="color:#888">JSON, CSV, Markdown, TXT</strong>.
      Files that are not already in Project Plan format are normalized using the primary AI model.
    </div>
    <div class="field">
      <label>Select file (.json / .csv / .md / .txt)</label>
      <input type="file" id="up-file" accept=".json,.csv,.md,.txt,.markdown,text/*,application/json"/>
    </div>
    <div class="field">
      <label>— or paste content —</label>
      <textarea id="up-json" rows="7" placeholder='{"items":[{"title":"Epic 1","type":"epic","children":[{"title":"Task 1","type":"task"}]}]}'></textarea>
    </div>
    <div id="up-preview" style="font-size:11px;color:#666;margin-top:-8px"></div>
    <div class="modal-footer">
      <button class="secondary" id="btn-up-cancel">Cancel</button>
      <button class="primary" id="btn-up-confirm">Import</button>
    </div>
  </div>
</div>

<!-- Accounts Modal -->
<div class="overlay hidden" id="modal-accounts">
  <div class="modal wide">
    <h2>Connected Accounts</h2>
    <div id="accounts-list"></div>
    <hr class="divider" style="margin:14px 0"/>
    <div>
      <div class="card-title">Add New Account</div>
      <div class="row">
        <div class="field"><label>Provider</label>
          <select id="acc-provider">
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
            <option value="jira">Jira</option>
            <option value="azuredevops">Azure DevOps</option>
          </select>
        </div>
        <div class="field" style="flex:2"><label>Account Name *</label><input id="acc-name" placeholder="e.g. Work Account"/></div>
      </div>
      <div id="acc-provider-fields"></div>
      <div class="field"><label>Token / PAT *</label><input type="password" id="acc-token" placeholder="Personal Access Token or API Key"/></div>
      <button class="primary" id="btn-acc-add">Add Account</button>
    </div>
    <div class="modal-footer">
      <button class="secondary" id="btn-acc-close">Close</button>
    </div>
  </div>
</div>

<!-- FS Browse Modal -->
<div class="overlay hidden" id="modal-fsbrowse">
  <div class="modal">
    <h2>Browse Directory</h2>
    <div id="fb-path" style="font-family:monospace;font-size:12px;color:#888;margin-bottom:10px;word-break:break-all;min-height:18px"></div>
    <div id="fb-entries" style="max-height:320px;overflow-y:auto;border:1px solid #2a2a30;border-radius:6px;margin-bottom:14px"></div>
    <div class="modal-footer">
      <button class="secondary" id="btn-fb-cancel">Cancel</button>
      <button class="primary" id="btn-fb-select">Select This Directory</button>
    </div>
  </div>
</div>

<script>
const API = '/plugins/project-plan/api';

function resolveThemeMode() {
  const html = document.documentElement;
  const explicit = String(html.dataset.themeMode || '').toLowerCase();
  if (explicit === 'light' || explicit === 'dark') {
    return explicit;
  }

  try {
    const raw = globalThis.localStorage?.getItem('openclaw.control.settings.v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      const mode = String(parsed?.themeMode || '').toLowerCase();
      if (mode === 'light' || mode === 'dark') {
        return mode;
      }
      if (mode === 'system') {
        return globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      }
    }
  } catch {
    // Ignore malformed localStorage payloads.
  }

  return globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyThemeMode(mode) {
  const normalized = mode === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.themeMode = normalized;
}

applyThemeMode(resolveThemeMode());

try {
  const media = globalThis.matchMedia?.('(prefers-color-scheme: light)');
  media?.addEventListener?.('change', () => applyThemeMode(resolveThemeMode()));
  globalThis.addEventListener('storage', (event) => {
    if (event.key === 'openclaw.control.settings.v1') {
      applyThemeMode(resolveThemeMode());
    }
  });
} catch {
  // Theme listeners are best-effort only.
}

// ── State ────────────────────────────────────────────────────────────────────
let state = {
  plans: [], selectedId: null, detail: null, tab: 'items',
  availableAccounts: [], // [{accountId, label, provider}]
  availableAgents: [],   // [{id, name?}]
  allAccounts: [],       // public account list from /api/accounts
  refreshTimer: null,
  settingsDirty: false,
  expandedItemId: null,
  sessionCache: {},      // { [itemId]: messages[] }
  listRetryTimer: null,
  listRetryDelayMs: 3000,
};

// ── API ──────────────────────────────────────────────────────────────────────
async function apiFetch(method, path, body) {
  const opts = { method, headers: {'Content-Type':'application/json'} };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const BADGE_MAP = {
  'to do':['badge-todo','To Do'], 'in progress':['badge-inprogress','In Progress'],
  'blocked':['badge-blocked','Blocked'], 'done':['badge-done','Done'],
  'failed':['badge-failed','Failed'], 'cancelled':['badge-cancelled','Cancelled'],
};
function badge(s) {
  const [cls,lbl] = BADGE_MAP[s] || ['badge-todo',s];
  return \`<span class="badge \${cls}">\${lbl}</span>\`;
}
function providerTag(p) {
  const labels = {github:'GitHub',gitlab:'GitLab',jira:'Jira',azuredevops:'Azure DevOps',local:'Local'};
  return \`<span class="provider-tag tag-\${p}">\${labels[p]||p}</span>\`;
}
function fmtDur(ms) {
  if (!ms) return '—'; const s = Math.floor(ms/1000);
  return s < 60 ? s+'s' : Math.floor(s/60)+'m '+(s%60)+'s';
}
function formatLogSignature(plan) {
  const logs = Array.isArray(plan?.logs) ? plan.logs : [];
  const last = logs[logs.length - 1];
  return [
    logs.length,
    last?.ts || '',
    last?.level || '',
    last?.message || '',
  ].join('|');
}
function el(id) { return document.getElementById(id); }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
let _errTimer;
function showErr(msg) {
  clearTimeout(_errTimer);
  const c = el('content');
  let b = c.querySelector('.error-banner');
  if (!msg) { b?.remove(); return; }
  if (!b) {
    b = document.createElement('div'); b.className = 'error-banner';
    c.insertBefore(b, c.firstChild);
  }
  b.innerHTML = \`<span>\${msg}</span><button class="icon" onclick="showErr(null)">✕</button>\`;
  _errTimer = setTimeout(() => showErr(null), 8000);
}

// ── Load ─────────────────────────────────────────────────────────────────────
async function loadPlans() {
  try {
    const data = await apiFetch('GET', '/plans');
    if (state.listRetryTimer) {
      clearTimeout(state.listRetryTimer);
      state.listRetryTimer = null;
    }
    state.listRetryDelayMs = 3000;
    state.plans = data.plans || [];
    if (data.availableAccounts) state.availableAccounts = data.availableAccounts;
    if (data.availableAgents) state.availableAgents = data.availableAgents;
    renderSidebar();
    if (state.selectedId) {
      if (!state.plans.find(p => p.id === state.selectedId)) {
        state.selectedId = null; state.detail = null; renderContent();
      } else { await loadDetail(state.selectedId, 0, { source: 'auto' }); }
    }
    scheduleRefresh();
  } catch(e) {
    showErr(String(e));
    if (!state.listRetryTimer) {
      const delay = state.listRetryDelayMs;
      state.listRetryTimer = setTimeout(() => {
        state.listRetryTimer = null;
        loadPlans();
      }, delay);
      state.listRetryDelayMs = Math.min(state.listRetryDelayMs * 2, 15000);
    }
  }
}

async function loadDetail(planId, attempt = 0, options = {}) {
  const source = options.source || 'manual';
  try {
    const prevDetail = state.detail;
    const samePlan = prevDetail?.plan?.id === planId;
    const prevTab = state.tab;
    const prevTabBody = el('tab-body');
    const prevItemTableWrap = prevTabBody?.querySelector('.item-table-wrap');
    const prevTabScrollTop = prevTabBody?.scrollTop || 0;
    const prevItemScrollTop = prevItemTableWrap?.scrollTop || 0;
    const prevRunning = !!prevDetail?.dashboard?.running;
    const prevLogSig = formatLogSignature(prevDetail?.plan);

    const data = await apiFetch('GET', '/plans/' + planId);
    state.selectedId = planId; state.detail = data;
    if (data.availableAccounts) state.availableAccounts = data.availableAccounts;
    if (data.availableAgents) state.availableAgents = data.availableAgents;

    if (!samePlan) {
      state.settingsDirty = false;
    }

    renderSidebar();

    const nextRunning = !!data?.dashboard?.running;
    const nextLogSig = formatLogSignature(data?.plan);
    const canPartialRefresh =
      source === 'auto' &&
      samePlan &&
      !state.settingsDirty &&
      prevTabBody &&
      prevRunning === nextRunning;

    // Avoid resetting unsaved form fields while user is editing settings.
    if (source === 'auto' && samePlan && state.tab === 'settings' && state.settingsDirty) {
      scheduleRefresh();
      return;
    }

    // Avoid rerender churn on logs tab when nothing changed.
    if (
      source === 'auto' &&
      samePlan &&
      state.tab === 'logs' &&
      prevRunning === nextRunning &&
      prevLogSig === nextLogSig
    ) {
      scheduleRefresh();
      return;
    }

    if (canPartialRefresh) {
      renderTab();
      const nextTabBody = el('tab-body');
      if (nextTabBody && prevTab === state.tab) {
        nextTabBody.scrollTop = prevTabScrollTop;
        const nextItemTableWrap = nextTabBody.querySelector('.item-table-wrap');
        if (nextItemTableWrap) nextItemTableWrap.scrollTop = prevItemScrollTop;
      }
    } else {
      renderContent();
      const nextTabBody = el('tab-body');
      if (source === 'auto' && nextTabBody && prevTab === state.tab) {
        nextTabBody.scrollTop = prevTabScrollTop;
        const nextItemTableWrap = nextTabBody.querySelector('.item-table-wrap');
        if (nextItemTableWrap) nextItemTableWrap.scrollTop = prevItemScrollTop;
      }
    }

    scheduleRefresh();
  } catch(e) {
    const msg = String(e);
    const isNotFound = /plan not found|not found|404/i.test(msg);
    if (isNotFound && attempt === 0) {
      try {
        // Refresh list once and retry detail in case of transient stale state.
        const listData = await apiFetch('GET', '/plans');
        state.plans = listData.plans || [];
        if (listData.availableAccounts) state.availableAccounts = listData.availableAccounts;
        if (listData.availableAgents) state.availableAgents = listData.availableAgents;
        renderSidebar();
        if (state.plans.find(p => p.id === planId)) {
          await loadDetail(planId, 1);
          return;
        }
        state.selectedId = null;
        state.detail = null;
        renderContent();
        showErr('Plan bulunamadi. Liste yenilendi.');
        return;
      } catch {
        // Fall through to generic error display.
      }
    }
    showErr(msg);
  }
}

function scheduleRefresh() {
  clearTimeout(state.refreshTimer);
  const running = state.plans.some(p => p.running) || state.detail?.dashboard?.running;
  if (running) state.refreshTimer = setTimeout(() => {
    if (state.selectedId) loadDetail(state.selectedId, 0, { source: 'auto' }); else loadPlans();
  }, 3000);
}

// ── Sidebar ──────────────────────────────────────────────────────────────────
function renderSidebar() {
  const list = el('plan-list');
  if (!state.plans.length) {
    list.innerHTML = '<div style="padding:18px;text-align:center;color:#444;font-size:12px">No plans yet</div>';
    return;
  }
  list.innerHTML = state.plans.map(p => {
    const src = p.source === 'local' ? 'Local' : (state.availableAccounts.find(a=>a.provider===p.source)?.label || p.source);
    return \`<div class="plan-item \${p.id===state.selectedId?'active':''}" data-id="\${p.id}">
      <div class="name">\${p.running?'<span class="running-dot"></span>':''}\${p.name}</div>
      <div class="meta">\${p.source} · \${badge(p.status)}</div>
    </div>\`;
  }).join('');
  list.querySelectorAll('.plan-item').forEach(e => {
    e.addEventListener('click', () => loadDetail(e.dataset.id));
  });
}

// ── Content ──────────────────────────────────────────────────────────────────
function renderContent() {
  const c = el('content');
  if (!state.detail) {
    c.innerHTML = '<div class="empty-state"><p style="color:#555">Select a plan or create a new one.</p></div>';
    updateChatVisibility();
    return;
  }
  const { plan, dashboard } = state.detail;
  const isLocal = plan.settings.source === 'local';
  c.innerHTML = \`
    <div class="detail-shell">
      <div class="detail-fixed">
        <div class="detail-header">
          <span class="detail-title">\${plan.name}</span>
          \${providerTag(plan.settings.source)}
          \${badge(plan.status)}
        </div>
        \${plan.description ? \`<div style="color:#666;font-size:13px">\${plan.description}</div>\` : ''}
        <div class="action-bar">
          \${dashboard.running
            ? '<button class="danger" id="btn-stop"><span class="spinner"></span>Stop</button>'
            : '<button class="primary" id="btn-start">▶ Run</button>'
          }
          \${!dashboard.running ? '<button class="secondary" id="btn-retry">↺ Retry Failed</button>' : ''}
          \${!isLocal ? '<button class="secondary" id="btn-sync">↻ Sync</button>' : ''}
          \${isLocal  ? '<button class="secondary" id="btn-upload">↑ Import File</button>' : ''}
          <button class="secondary" id="btn-add-item">＋ Add Item</button>
          <button class="icon" id="btn-del-plan" title="Delete plan" style="margin-left:auto;color:#8b1a1a">🗑</button>
        </div>
        <div class="tabs">
          \${['items','settings','logs','dashboard'].map(t =>
            \`<div class="tab \${state.tab===t?'active':''}" data-tab="\${t}">\${t.charAt(0).toUpperCase()+t.slice(1)}</div>\`
          ).join('')}
        </div>
      </div>
      <div id="tab-body" class="tab-body"></div>
    </div>
  \`;

  c.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { state.tab = t.dataset.tab; renderTab(); }));
  el('btn-start')?.addEventListener('click', () => planAction('start'));
  el('btn-stop')?.addEventListener('click',  () => planAction('stop'));
  el('btn-retry')?.addEventListener('click', () => planAction('retry'));
  el('btn-sync')?.addEventListener('click',  () => planAction('sync'));
  el('btn-upload')?.addEventListener('click', () => { el('up-json').value=''; el('up-file').value=''; showModal('modal-upload'); });
  el('btn-add-item')?.addEventListener('click', () => openItemForm());
  el('btn-del-plan')?.addEventListener('click', async () => {
    if (!confirm('Delete this plan and all its items?')) return;
    await apiFetch('DELETE', '/plans/' + plan.id).catch(e => showErr(String(e)));
    state.selectedId = null; state.detail = null;
    await loadPlans(); renderContent();
  });
  renderTab();
  updateChatVisibility();
}

function renderTab() {
  const tb = el('tab-body'); if (!tb || !state.detail) return;
  tb.classList.toggle('items-tab', state.tab === 'items');
  tb.classList.toggle('logs-tab', state.tab === 'logs');
  syncTabClasses();
  const { plan, dashboard } = state.detail;
  if (state.tab === 'items')     { tb.innerHTML = renderItems(plan); bindItemActions(plan); }
  if (state.tab === 'settings')  { tb.innerHTML = renderSettings(plan); bindSettings(plan); }
  if (state.tab === 'logs')      { tb.innerHTML = renderLogs(plan); bindLogs(plan); }
  if (state.tab === 'dashboard') { tb.innerHTML = renderDashboard(dashboard); }
}

function syncTabClasses() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === state.tab);
  });
}

// ── Items tab ─────────────────────────────────────────────────────────────────
function renderItems(plan) {
  const ordered = buildItemTreeRows(plan.items);
  if (!ordered.length) return '<div class="empty-state" style="padding:30px;color:#555">No items yet. Add one or import a file.</div>';
  const rows = ordered.map(({ item, depth }) => {
    const prefix = item.type.toUpperCase();
    const hasSession = item.sessionOutput && item.sessionOutput.length > 0;
    const isExpanded = state.expandedItemId === item.id;
    const toggleBtn = hasSession
      ? \`<button class="session-toggle btn-session-toggle" data-id="\${item.id}">\${isExpanded ? '▼ Hide Output' : '▶ Show Output'}</button>\`
      : '';
    let sessionHtml = '';
    if (isExpanded && state.sessionCache[item.id]) {
      const msgs = state.sessionCache[item.id];
      sessionHtml = \`<div class="session-output">\${msgs.map(m =>
        \`<div class="session-msg"><span class="s-role s-role-\${m.role}">\${m.role}</span>\${m.toolName ? \`<span class="s-tool-name">(\${escHtml(m.toolName)})</span>\` : ''}<div class="s-content">\${escHtml(m.content)}</div></div>\`
      ).join('')}</div>\`;
    }
    return \`<tr data-id="\${item.id}">
      <td>
        <div class="item-tree" style="padding-left:\${depth*24}px">
          <span class="item-tree-prefix">\${prefix}:</span>
          <div class="item-title-wrap">
            <span class="item-title">\${item.title}</span>
            \${item.description ? \`<span class="item-desc">\${item.description}</span>\` : ''}
            \${toggleBtn}
            \${sessionHtml}
          </div>
        </div>
      </td>
      <td style="white-space:nowrap">\${badge(item.status)}</td>
      <td style="color:#666;font-size:12px;white-space:nowrap">\${item.assignedAgentId||'—'}</td>
      <td>
        <div class="item-actions">
          <button class="icon btn-it-edit" data-id="\${item.id}" title="Edit">✎</button>
          <button class="icon btn-it-done" data-id="\${item.id}" title="Mark done" style="color:#4ade80">✓</button>
          <button class="icon btn-it-cancel" data-id="\${item.id}" title="Cancel" style="color:#555">⊘</button>
          <button class="icon btn-it-del" data-id="\${item.id}" title="Delete" style="color:#8b1a1a">🗑</button>
        </div>
      </td>
    </tr>\`;
  }).join('');
  return \`<div class="card" style="padding:0;display:flex;flex-direction:column;flex:1;min-height:0">
    <div class="item-table-wrap">
      <table class="item-table">
        <thead><tr><th>Title</th><th>Status</th><th>Agent</th><th></th></tr></thead>
        <tbody>\${rows}</tbody>
      </table>
    </div>
  </div>\`;
}

function buildItemTreeRows(items) {
  const byParent = new Map();
  const seen = new Set();

  for (const item of items) {
    const key = item.parentId || '__root__';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(item);
  }

  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.order - b.order);
  }

  const rows = [];
  function walk(parentId, depth) {
    const key = parentId || '__root__';
    for (const item of byParent.get(key) || []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      rows.push({ item, depth });
      walk(item.id, depth + 1);
    }
  }

  walk(undefined, 0);

  for (const item of [...items].sort((a, b) => a.order - b.order)) {
    if (seen.has(item.id)) continue;
    rows.push({ item, depth: 0 });
    walk(item.id, 1);
  }

  return rows;
}

function bindItemActions(plan) {
  document.querySelectorAll('.btn-it-edit').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    openItemForm(plan.items.find(i => i.id === b.dataset.id));
  }));
  document.querySelectorAll('.btn-it-done').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation();
    await apiFetch('PUT', '/plans/'+plan.id+'/items/'+b.dataset.id+'/status', {status:'done'}).catch(e=>showErr(String(e)));
    await loadDetail(plan.id);
  }));
  document.querySelectorAll('.btn-it-cancel').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation();
    await apiFetch('PUT', '/plans/'+plan.id+'/items/'+b.dataset.id+'/status', {status:'cancelled'}).catch(e=>showErr(String(e)));
    await loadDetail(plan.id);
  }));
  document.querySelectorAll('.btn-it-del').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm('Delete item?')) return;
    await apiFetch('DELETE', '/plans/'+plan.id+'/items/'+b.dataset.id).catch(e=>showErr(String(e)));
    await loadDetail(plan.id);
  }));
  document.querySelectorAll('.btn-session-toggle').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation();
    const itemId = b.dataset.id;
    if (state.expandedItemId === itemId) {
      state.expandedItemId = null;
    } else {
      state.expandedItemId = itemId;
      if (!state.sessionCache[itemId]) {
        try {
          const data = await apiFetch('GET', '/plans/'+plan.id+'/items/'+itemId+'/session');
          state.sessionCache[itemId] = data.messages || [];
        } catch(err) { showErr(String(err)); return; }
      }
    }
    const wrap = el('tab-body')?.querySelector('.item-table-wrap');
    const scrollBefore = wrap?.scrollTop || 0;
    renderTab();
    const wrapAfter = el('tab-body')?.querySelector('.item-table-wrap');
    if (wrapAfter) wrapAfter.scrollTop = scrollBefore;
  }));
}

// ── Settings tab ──────────────────────────────────────────────────────────────
function renderSettings(plan) {
  const s = plan.settings;
  // Build source options: Local + accounts
  const srcOpts = [
    \`<option value="local" \${s.source==='local'?'selected':''}>Local (no sync)</option>\`
  ];
  for (const acc of state.availableAccounts) {
    const sel = s.accountId === acc.accountId ? 'selected' : '';
    srcOpts.push(\`<option value="\${acc.accountId}" data-provider="\${acc.provider}" \${sel}>\${acc.label}</option>\`);
  }

  const knownAgents = Array.isArray(state.availableAgents) ? state.availableAgents : [];
  const selectedAgentId = s.defaultAgentId || 'main';
  const agentMap = new Map();
  knownAgents.forEach((a) => {
    if (a?.id) agentMap.set(a.id, a);
  });
  if (!agentMap.has(selectedAgentId)) {
    agentMap.set(selectedAgentId, { id: selectedAgentId });
  }
  if (!agentMap.has('main')) {
    agentMap.set('main', { id: 'main' });
  }
  const agentOptions = [...agentMap.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((a) => {
      const label = a.name ? (a.id + ' - ' + a.name) : a.id;
      return '<option value="' + a.id + '" ' + (a.id===selectedAgentId?'selected':'') + '>' + label + '</option>';
    })
    .join('');

  const providerFields = renderProviderFields(s);

  return \`<div class="card">
    <div class="card-title">Plan Settings</div>
    <div class="field">
      <label>Source / Account</label>
      <select id="s-source-sel">\${srcOpts.join('')}</select>
      \${state.availableAccounts.length===0 ? '<div style="font-size:11px;color:#555;margin-top:4px">No accounts connected yet. Click "Connected Accounts" to add one.</div>' : ''}
    </div>
    <div id="s-provider-fields">\${providerFields}</div>
    <div class="field">
      <label>Project Directory (working dir for agents)</label>
      <div class="row" style="gap:6px">
        <input id="s-proj-path" value="\${s.projectPath||''}" placeholder="/home/user/myproject" style="flex:1"/>
        <button class="secondary" id="btn-browse" style="flex-shrink:0;white-space:nowrap">Browse…</button>
      </div>
    </div>
    <div class="field"><label>Default Agent ID</label>
      <select id="s-agent">\${agentOptions}</select>
    </div>
    <div class="field">
      <label style="display:flex;align-items:center;gap:8px;color:#c8c8d0;margin-bottom:6px">
        <input id="s-item-sessions" type="checkbox" \${s.itemScopedSessions===false?'':'checked'}/>
        Use separate AI session per plan item
      </label>
      <div style="font-size:11px;color:#666;line-height:1.4">
        Recommended for long plans to prevent context-window overflows.
      </div>
    </div>
    <button class="primary" id="btn-save-settings">Save Settings</button>
  </div>\`;
}

function renderProviderFields(s) {
  // Determine active provider
  const acc = state.availableAccounts.find(a => a.accountId === s.accountId);
  const provider = acc?.provider || (s.source !== 'local' ? s.source : null);
  if (!provider || provider === 'local') return '';

  const fields = {
    github: \`<div class="field"><label>Repository (owner/repo)</label>
      <input id="s-proj-id" value="\${s.providerProjectId||''}" placeholder="myorg/myrepo"/></div>\`,
    gitlab: \`<div class="field"><label>Project path (namespace/project)</label>
      <input id="s-proj-id" value="\${s.providerProjectId||''}" placeholder="mygroup/myproject"/></div>\`,
    jira: \`<div class="field"><label>Project key</label>
      <input id="s-proj-id" value="\${s.providerProjectId||''}" placeholder="MYPROJECT"/></div>
      <div class="field"><label>Plan / Sprint ID (optional)</label>
      <input id="s-plan-id" value="\${s.providerPlanId||''}" placeholder="Sprint ID or board ID"/></div>\`,
    azuredevops: \`<div class="field"><label>Project name</label>
      <input id="s-proj-id" value="\${s.providerProjectId||''}" placeholder="MyProject"/></div>
      <div class="field"><label>Area / Iteration path (optional)</label>
      <input id="s-plan-id" value="\${s.providerPlanId||''}" placeholder="MyProject\\\\Sprint 1"/></div>\`,
  };
  return fields[provider] || '';
}

function bindSettings(plan) {
  attachSettingsDirtyListeners();

  // Source change → re-render provider fields
  el('s-source-sel')?.addEventListener('change', () => {
    const sel = el('s-source-sel');
    const opt = sel.options[sel.selectedIndex];
    const provider = opt.dataset.provider || (opt.value === 'local' ? 'local' : null);
    // Update draft settings preview
    const mockSettings = {
      ...plan.settings,
      accountId: opt.value !== 'local' ? opt.value : undefined,
      source: provider || 'local',
    };
    el('s-provider-fields').innerHTML = renderProviderFields(mockSettings);
    attachSettingsDirtyListeners();
  });

  el('btn-browse')?.addEventListener('click', () => browsePath(el('s-proj-path').value || ''));

  el('btn-save-settings')?.addEventListener('click', async () => {
    const sel = el('s-source-sel');
    const opt = sel.options[sel.selectedIndex];
    const isLocal = opt.value === 'local';
    const accountId = isLocal ? undefined : opt.value;
    const provider = opt.dataset.provider || (isLocal ? 'local' : opt.value);
    const settings = {
      source: provider || 'local',
      accountId,
      projectPath: el('s-proj-path')?.value || undefined,
      defaultAgentId: el('s-agent')?.value || 'main',
      itemScopedSessions: el('s-item-sessions')?.checked ?? true,
      providerProjectId: el('s-proj-id')?.value || undefined,
      providerPlanId: el('s-plan-id')?.value || undefined,
      syncMode: plan.settings.syncMode || 'manual',
    };
    state.settingsDirty = false;
    await apiFetch('PUT', '/plans/'+plan.id+'/settings', {settings}).catch(e => showErr(String(e)));
    await loadDetail(plan.id);
  });
}

function attachSettingsDirtyListeners() {
  const markDirty = () => { state.settingsDirty = true; };
  document.querySelectorAll('#tab-body input, #tab-body select, #tab-body textarea').forEach((node) => {
    if (node.dataset.ppDirtyBound === '1') return;
    node.dataset.ppDirtyBound = '1';
    node.addEventListener('input', markDirty);
    node.addEventListener('change', markDirty);
  });
}

// ── Logs tab ──────────────────────────────────────────────────────────────────
function renderLogs(plan) {
  const allLogs = Array.isArray(plan.logs) ? plan.logs : [];
  const logs = [...allLogs].reverse();
  const rows = logs.length
    ? logs.map(l =>
      '<div class="log-entry">'
      + '<span class="log-ts">' + escHtml(new Date(l.ts).toLocaleTimeString()) + '</span>'
      + '<span class="log-lv-' + escHtml(l.level) + '">' + escHtml(String(l.level || '').toUpperCase()) + '</span>'
      + '<span class="log-msg">' + escHtml(l.message) + '</span>'
      + '</div>'
    ).join('')
    : '<div style="color:#555;padding:20px;text-align:center;font-size:13px">No log entries yet.</div>';
  return '<div class="card log-card">'
    + '<div class="log-toolbar">'
    + '<div class="log-toolbar-title">' + allLogs.length + ' log entries</div>'
    + '<div class="log-toolbar-actions">'
    + '<button class="secondary" data-export-logs="100">Export Last 100</button>'
    + '<button class="secondary" data-export-logs="1000">Export Last 1000</button>'
    + '<button class="secondary" data-export-logs="2000">Export Last 2000</button>'
    + '<button class="secondary" data-export-logs="full">Export Full</button>'
    + '</div>'
    + '</div>'
    + '<div class="log-list">' + rows + '</div>'
    + '</div>';
}

function sanitizeFilenamePart(input) {
  const cleaned = String(input || 'project-plan')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'project-plan';
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportLogs(plan, mode) {
  const logs = Array.isArray(plan.logs) ? plan.logs : [];
  const limitMap = { '100': 100, '1000': 1000, '2000': 2000, full: null };
  const limit = Object.prototype.hasOwnProperty.call(limitMap, mode) ? limitMap[mode] : 100;
  const selectedLogs = limit == null ? logs : logs.slice(Math.max(0, logs.length - limit));
  const header = [
    'Project Plan Logs Export',
    'Plan: ' + (plan.name || 'Untitled'),
    'Mode: ' + (limit == null ? 'full' : ('last-' + limit)),
    'Entries: ' + selectedLogs.length,
    'Generated: ' + new Date().toISOString(),
    '',
  ];
  const lines = selectedLogs.map((entry) => {
    const ts = new Date(entry.ts).toISOString();
    const level = String(entry.level || 'info').toUpperCase();
    const message = String(entry.message || '').replace(/\\r?\\n/g, '\\\\n');
    return '[' + ts + '] [' + level + '] ' + message;
  });
  const suffix = limit == null ? 'full' : ('last-' + limit);
  const filename = sanitizeFilenamePart(plan.name) + '-logs-' + suffix + '.txt';
  downloadTextFile(filename, [...header, ...lines].join('\n'));
}

function bindLogs(plan) {
  document.querySelectorAll('[data-export-logs]').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.exportLogs || '100';
      exportLogs(plan, mode);
    });
  });
}

// ── Dashboard tab ─────────────────────────────────────────────────────────────
function renderDashboard(db) {
  const pct = Math.round((db.completionRatio||0)*100);
  const c = db.counts || {};
  return \`
    <div class="kpi-grid">
      <div class="kpi"><div class="klabel">Total</div><div class="kval">\${db.totalItems}</div></div>
      <div class="kpi"><div class="klabel">Done</div><div class="kval" style="color:#4ade80">\${c.done||0}</div></div>
      <div class="kpi"><div class="klabel">In Progress</div><div class="kval" style="color:#7cb9f8">\${c['in progress']||0}</div></div>
      <div class="kpi"><div class="klabel">Blocked</div><div class="kval" style="color:#f8b84a">\${c.blocked||0}</div></div>
      <div class="kpi"><div class="klabel">Failed</div><div class="kval" style="color:#f87171">\${c.failed||0}</div></div>
      <div class="kpi"><div class="klabel">Run Count</div><div class="kval">\${db.runCount}</div></div>
      <div class="kpi"><div class="klabel">Duration</div><div class="kval" style="font-size:16px">\${fmtDur(db.durationMs)}</div></div>
    </div>
    <div class="card" style="margin-top:12px">
      <div class="card-title">Completion — \${pct}%</div>
      <div class="prog-bar"><div class="prog-fill" style="width:\${pct}%"></div></div>
    </div>
  \`;
}

// ── Plan actions ──────────────────────────────────────────────────────────────
async function planAction(action) {
  if (!state.selectedId) return;
  try {
    await apiFetch('POST', '/plans/'+state.selectedId+'/'+action);
    await loadDetail(state.selectedId);
  } catch(e) { showErr(String(e)); }
}

// ── Item form ─────────────────────────────────────────────────────────────────
function openItemForm(item) {
  el('item-modal-title').textContent = item ? 'Edit Item' : 'Add Item';
  el('it-title').value   = item?.title || '';
  el('it-type').value    = item?.type  || 'task';
  el('it-status').value  = item?.status || 'to do';
  el('it-desc').value    = item?.description || '';
  el('it-parent').value  = item?.parentId || '';
  el('it-agent').value   = item?.assignedAgentId || '';
  el('it-edit-id').value = item?.id || '';
  showModal('modal-item');
  setTimeout(() => el('it-title').focus(), 50);
}
el('btn-item-cancel').addEventListener('click', () => hideModal('modal-item'));
el('btn-item-save').addEventListener('click', async () => {
  const planId = state.selectedId; if (!planId) return;
  const title = el('it-title').value.trim();
  if (!title) { el('it-title').focus(); return; }
  const editId = el('it-edit-id').value;
  const body = { title, type: el('it-type').value,
    status: editId ? el('it-status').value : undefined,
    description: el('it-desc').value || undefined,
    parentId: el('it-parent').value || undefined,
    assignedAgentId: el('it-agent').value || undefined };
  try {
    if (editId) await apiFetch('PUT', '/plans/'+planId+'/items/'+editId, body);
    else        await apiFetch('POST', '/plans/'+planId+'/items', body);
    hideModal('modal-item');
    await loadDetail(planId);
  } catch(e) { showErr(String(e)); }
});

// ── New plan modal ────────────────────────────────────────────────────────────
el('btn-new-plan').addEventListener('click', () => {
  el('new-name').value = ''; el('new-desc').value = '';
  showModal('modal-new'); setTimeout(() => el('new-name').focus(), 50);
});
el('btn-cancel-new').addEventListener('click', () => hideModal('modal-new'));
el('btn-create').addEventListener('click', async () => {
  const name = el('new-name').value.trim();
  if (!name) { el('new-name').focus(); return; }
  try {
    const res = await apiFetch('POST', '/plans', {name, description: el('new-desc').value.trim()||undefined});
    hideModal('modal-new');
    await loadPlans();
    if (res.plan?.id) await loadDetail(res.plan.id);
  } catch(e) { showErr(String(e)); }
});

// ── Upload modal ──────────────────────────────────────────────────────────────
let upFilename = 'paste.json';

el('up-file').addEventListener('change', e => {
  const f = e.target.files?.[0]; if (!f) return;
  upFilename = f.name;
  const ext = f.name.split('.').pop()?.toLowerCase();
  const preview = el('up-preview');
  if (ext !== 'json') {
    preview.textContent = \`⚡ "\${f.name}" will be converted by the AI model automatically.\`;
    preview.style.color = '#7cb9f8';
  } else {
    preview.textContent = 'JSON files that do not already match Project Plan format will be normalized automatically.';
    preview.style.color = '#7cb9f8';
  }
  const r = new FileReader();
  r.onload = ev => { el('up-json').value = ev.target?.result || ''; };
  r.readAsText(f);
});

el('btn-up-cancel').addEventListener('click', () => { hideModal('modal-upload'); el('up-preview').textContent=''; });

el('btn-up-confirm').addEventListener('click', async () => {
  const planId = state.selectedId; if (!planId) return;
  const payload = el('up-json').value.trim();
  if (!payload) { showErr('Paste content or select a file.'); return; }

  const filename = upFilename || 'paste.json';

  // Show loading state
  const btn = el('btn-up-confirm');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Analyzing import…';

  try {
    const res = await apiFetch('POST', '/plans/'+planId+'/upload', {payload, filename});
    hideModal('modal-upload');
    el('up-json').value = ''; el('up-file').value = ''; el('up-preview').textContent = '';
    upFilename = 'paste.json';
    showErr(null);
    await loadDetail(planId);
    const count = res.count ?? '?';
    const via = res.method && res.method !== 'direct' ? \` via \${res.method}\` : '';
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#0f3020;border:1px solid #4ade80;color:#4ade80;padding:10px 16px;border-radius:8px;font-size:13px;z-index:200;max-width:300px';
    toast.textContent = \`✓ Imported \${count} item\${count===1?'':'s'}\${via}\`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  } catch(e) { showErr(String(e)); }
  finally { btn.disabled = false; btn.textContent = 'Import'; }
});

// ── Accounts modal ────────────────────────────────────────────────────────────
const PROVIDER_EXTRA = {
  github:      [],
  gitlab:      [{id:'hostUrl', label:'Host URL (blank = gitlab.com)', placeholder:'https://gitlab.mycompany.com'}],
  jira:        [{id:'hostUrl', label:'Host URL *', placeholder:'https://mycompany.atlassian.net'},
                {id:'usernameOrEmail', label:'Username / Email *', placeholder:'me@company.com'}],
  azuredevops: [{id:'organization', label:'Organization *', placeholder:'myorg'}],
};

function renderProviderExtraFields(provider) {
  return (PROVIDER_EXTRA[provider]||[]).map(f =>
    \`<div class="field"><label>\${f.label}</label>
     <input id="acc-extra-\${f.id}" placeholder="\${f.placeholder||''}"/></div>\`
  ).join('');
}

el('btn-open-accounts').addEventListener('click', async () => {
  await refreshAccounts();
  showModal('modal-accounts');
});
el('btn-acc-close').addEventListener('click', () => hideModal('modal-accounts'));

el('acc-provider').addEventListener('change', () => {
  el('acc-provider-fields').innerHTML = renderProviderExtraFields(el('acc-provider').value);
});
// Initialize provider fields
el('acc-provider-fields').innerHTML = renderProviderExtraFields('github');

async function refreshAccounts() {
  try {
    const data = await apiFetch('GET', '/accounts');
    state.allAccounts = data.accounts || [];
    renderAccountsList();
  } catch(e) { showErr(String(e)); }
}

function renderAccountsList() {
  const list = el('accounts-list');
  if (!state.allAccounts.length) {
    list.innerHTML = '<div style="color:#555;font-size:13px;padding:8px 0 14px">No accounts connected yet.</div>';
    return;
  }
  const byProvider = {};
  const ORDER = ['github','gitlab','jira','azuredevops'];
  for (const a of state.allAccounts) {
    (byProvider[a.provider] = byProvider[a.provider]||[]).push(a);
  }
  const provLabels = {github:'GitHub',gitlab:'GitLab',jira:'Jira',azuredevops:'Azure DevOps'};
  let html = '';
  for (const p of ORDER) {
    const accs = byProvider[p]; if (!accs?.length) continue;
    html += \`<div class="account-group">
      <div class="account-group-title">\${providerTag(p)} \${provLabels[p]||p}</div>
      \${accs.map(a => \`<div class="account-row">
        <span class="acc-name">\${a.name}</span>
        <span class="acc-status \${a.enabled?'':'no-token'}">\${a.enabled?'● Connected':'○ Disabled'}</span>
        <button class="icon btn-acc-toggle" data-id="\${a.id}" data-enabled="\${a.enabled}" title="\${a.enabled?'Disable':'Enable'}">
          \${a.enabled?'⏸':'▶'}
        </button>
        <button class="icon btn-acc-del" data-id="\${a.id}" title="Remove" style="color:#8b1a1a">🗑</button>
      </div>\`).join('')}
    </div>\`;
  }
  list.innerHTML = html;

  list.querySelectorAll('.btn-acc-del').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Remove this account?')) return;
    await apiFetch('DELETE', '/accounts/'+b.dataset.id).catch(e => showErr(String(e)));
    await refreshAccounts();
    await loadPlans(); // refresh available accounts
  }));
  list.querySelectorAll('.btn-acc-toggle').forEach(b => b.addEventListener('click', async () => {
    const acc = state.allAccounts.find(a => a.id === b.dataset.id);
    if (!acc) return;
    await apiFetch('PUT', '/accounts/'+b.dataset.id, {...acc, settings:{...acc.settings}, enabled:!acc.enabled})
      .catch(e => showErr(String(e)));
    await refreshAccounts();
    await loadPlans();
  }));
}

el('btn-acc-add').addEventListener('click', async () => {
  const provider = el('acc-provider').value;
  const name = el('acc-name').value.trim();
  const token = el('acc-token').value.trim();
  if (!name) { el('acc-name').focus(); showErr('Account name is required.'); return; }
  if (!token) { el('acc-token').focus(); showErr('Token is required.'); return; }
  const settings = { token };
  for (const f of (PROVIDER_EXTRA[provider]||[])) {
    const v = el('acc-extra-'+f.id)?.value?.trim();
    if (v) settings[f.id] = v;
  }
  try {
    await apiFetch('POST', '/accounts', { name, provider, enabled: true, settings });
    el('acc-name').value = ''; el('acc-token').value = '';
    document.querySelectorAll('[id^="acc-extra-"]').forEach(i => i.value = '');
    showErr(null);
    await refreshAccounts();
    await loadPlans(); // refresh available accounts in source dropdown
  } catch(e) { showErr(String(e)); }
});

// ── FS Browse ─────────────────────────────────────────────────────────────────
let fbState = {path:'', parent:null, entries:[], sep:'/'};
async function browsePath(p) {
  try {
    const qs = p ? '?path='+encodeURIComponent(p) : '';
    fbState = await apiFetch('GET', '/fs/browse'+qs);
    renderFsBrowse();
    el('modal-fsbrowse').classList.remove('hidden');
  } catch(e) { showErr(String(e)); }
}
function renderFsBrowse() {
  el('fb-path').textContent = fbState.path;
  let html = '';
  if (fbState.parent !== null) {
    html += \`<div class="fb-row" data-path="\${fbState.parent}" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #1e1e24;color:#7c9ef8">📁 ..</div>\`;
  }
  for (const e of fbState.entries) {
    if (!e.isDir) continue;
    html += \`<div class="fb-row" data-path="\${fbState.path+fbState.sep+e.name}" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #1e1e24">\${e.name}/</div>\`;
  }
  el('fb-entries').innerHTML = html || '<div style="padding:12px;color:#555">No subdirectories</div>';
  el('fb-entries').querySelectorAll('.fb-row').forEach(r => {
    r.addEventListener('click', () => browsePath(r.dataset.path));
    r.addEventListener('mouseenter', () => r.style.background='#1e1e24');
    r.addEventListener('mouseleave', () => r.style.background='');
  });
}
el('btn-fb-cancel').addEventListener('click', () => el('modal-fsbrowse').classList.add('hidden'));
el('btn-fb-select').addEventListener('click', () => {
  if (el('s-proj-path')) el('s-proj-path').value = fbState.path;
  el('modal-fsbrowse').classList.add('hidden');
});

// ── Chat ──────────────────────────────────────────────────────────────────────
let chatMessages = [];

function updateChatVisibility() {
  const panel = el('chat-panel');
  if (!panel) return;
  if (state.selectedId) panel.classList.remove('hidden');
  else panel.classList.add('hidden');
}

function renderChatMessages() {
  const container = el('chat-messages');
  if (!container) return;
  container.innerHTML = chatMessages.map(m =>
    \`<div class="chat-msg \${m.role}">\${escHtml(m.content)}</div>\`
  ).join('');
  container.scrollTop = container.scrollHeight;
}

function addChatMessage(role, content) {
  chatMessages.push({role, content});
  renderChatMessages();
}

async function sendChatMessage() {
  const input = el('chat-input');
  if (!input) return;
  const msg = input.value.trim();
  if (!msg || !state.selectedId) return;

  input.value = '';
  input.style.height = 'auto';
  addChatMessage('user', msg);

  const thinkingIdx = chatMessages.length;
  chatMessages.push({role:'assistant thinking', content:'Thinking…'});
  renderChatMessages();

  const btn = el('btn-chat-send');
  if (btn) btn.disabled = true;

  try {
    const data = await apiFetch('POST', '/plans/' + state.selectedId + '/ask', { message: msg });
    chatMessages.splice(thinkingIdx, 1);
    addChatMessage('assistant', data.reply || '(No response)');
  } catch(e) {
    chatMessages.splice(thinkingIdx, 1);
    addChatMessage('assistant', 'Error: ' + String(e));
  } finally {
    if (btn) btn.disabled = false;
    el('chat-input')?.focus();
  }
}

el('btn-chat-send')?.addEventListener('click', sendChatMessage);
el('chat-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});

el('chat-input')?.addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 100) + 'px';
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'e' || e.key === 'E') {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!state.selectedId) return;
    e.preventDefault();
    el('chat-input')?.focus();
  }
});

// ── Modal helpers ─────────────────────────────────────────────────────────────
function showModal(id) { el(id).classList.remove('hidden'); }
function hideModal(id) { el(id).classList.add('hidden'); }
document.querySelectorAll('.overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) o.classList.add('hidden'); });
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadPlans();
</script>
</body>
</html>`;
}
