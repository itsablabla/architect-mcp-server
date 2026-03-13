function escHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const app = {
    currentSection: "overview",

    async init() {
        this.bindNavigation();
        await this.loadSection("overview");
    },

    bindNavigation() {
        document.querySelectorAll(".nav-link").forEach(link => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                const section = link.dataset.section;
                document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
                link.classList.add("active");
                this.loadSection(section);
            });
        });
    },

    async refresh() {
        await this.loadSection(this.currentSection);
    },

    async loadSection(section) {
        this.currentSection = section;
        const title = document.getElementById("page-title");
        const content = document.getElementById("main-content");
        title.textContent = section.charAt(0).toUpperCase() + section.slice(1);
        content.innerHTML = '<div class="loader"><div class="spinner"></div></div>';

        try {
            switch (section) {
                case "overview": await this.renderOverview(content); break;
                case "tools": await this.renderTools(content); break;
                case "audit": await this.renderAudit(content); break;
                case "permissions": await this.renderPermissions(content); break;
                case "schedules": await this.renderSchedules(content); break;
                case "webhooks": await this.renderWebhooks(content); break;
                case "pipelines": await this.renderPipelines(content); break;
                case "cache": await this.renderCache(content); break;
                case "secrets": await this.renderSecrets(content); break;
                case "aliases": await this.renderAliases(content); break;
                case "marketplace": await this.renderMarketplace(content); break;
                case "resources": await this.renderResources(content); break;
                case "prompts": await this.renderPrompts(content); break;
            }
        } catch (err) {
            content.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#10060;</div><div class="empty-state-text">Failed to load data</div></div>';
        }
    },

    async fetchApi(endpoint) {
        const res = await fetch(`/api/${endpoint}`);
        return res.json();
    },

    async renderOverview(el) {
        const data = await this.fetchApi("overview");
        const successRate = data.totalCalls > 0 ? ((data.totalSuccess / data.totalCalls) * 100).toFixed(1) : "0.0";

        el.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-label">Total Tools</div>
                    <div class="stat-value info">${escHtml(data.totalTools || 0)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Active Tools</div>
                    <div class="stat-value success">${escHtml(data.activeTools || 0)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Total Executions</div>
                    <div class="stat-value">${escHtml(data.totalCalls || 0)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Success Rate</div>
                    <div class="stat-value success">${escHtml(successRate)}%</div>
                    <div class="progress-bar"><div class="progress-fill" style="width:${escHtml(successRate)}%;background:var(--success)"></div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Failed</div>
                    <div class="stat-value danger">${escHtml(data.totalFailed || 0)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Cache Hit Rate</div>
                    <div class="stat-value info">${escHtml(data.cacheHitRate || 0)}%</div>
                    <div class="progress-bar"><div class="progress-fill" style="width:${escHtml(data.cacheHitRate || 0)}%;background:var(--info)"></div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Schedules</div>
                    <div class="stat-value warning">${escHtml(data.schedulesCount || 0)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Webhooks</div>
                    <div class="stat-value info">${escHtml(data.webhooksCount || 0)}</div>
                </div>
            </div>
            <div class="card">
                <div class="card-header"><h3>Recent Audit Activity</h3></div>
                <div class="card-body" id="recent-audit"></div>
            </div>
        `;

        const audit = await this.fetchApi("audit?limit=10");
        const auditEl = document.getElementById("recent-audit");
        if (audit.length === 0) {
            auditEl.innerHTML = '<div class="empty-state"><div class="empty-state-text">No activity yet</div></div>';
        } else {
            auditEl.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Time</th><th>Action</th><th>Tool</th></tr></thead><tbody>' +
                audit.map(log => `<tr><td>${escHtml(new Date(log.timestamp).toLocaleString())}</td><td><span class="badge badge-info">${escHtml(log.action)}</span></td><td>${escHtml(log.toolName)}</td></tr>`).join("") +
                '</tbody></table></div>';
        }
    },

    async renderTools(el) {
        const tools = await this.fetchApi("tools");
        if (tools.length === 0) {
            el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#128296;</div><div class="empty-state-text">No tools created yet</div></div>';
            return;
        }

        el.innerHTML = '<div class="tool-grid">' + tools.map(tool => `
            <div class="tool-card">
                <div class="tool-card-header">
                    <span class="tool-name">${escHtml(tool.name)}</span>
                    <span class="badge ${tool.active ? 'badge-success' : 'badge-neutral'}">${tool.active ? 'Active' : 'Inactive'}</span>
                </div>
                <div class="tool-desc">${escHtml(tool.description)}</div>
                <div class="tool-meta">
                    <span class="badge badge-info">v${escHtml(tool.version)}</span>
                    ${tool.category ? `<span class="badge badge-warning">${escHtml(tool.category)}</span>` : ''}
                    ${(tool.tags || []).map(t => `<span class="tag">#${escHtml(t)}</span>`).join('')}
                </div>
                <div class="tool-actions">
                    <button class="btn btn-sm tool-run-btn" data-tool="${escHtml(tool.name)}" style="background:var(--primary);color:#fff;border:none;padding:5px 10px;border-radius:4px;cursor:pointer;">Run</button>
                    <button class="btn btn-sm tool-edit-btn" data-tool="${escHtml(tool.name)}" style="background:var(--secondary);color:#fff;border:none;padding:5px 10px;border-radius:4px;cursor:pointer;">Edit Code</button>
                    ${!tool.active ? `<button class="btn btn-sm tool-approve-btn" data-tool="${escHtml(tool.name)}" style="background:var(--warning);color:#000;border:none;padding:5px 10px;border-radius:4px;cursor:pointer;">Approve</button>` : ''}
                </div>
            </div>
        `).join("") + '</div>';

        el.querySelectorAll('.tool-run-btn').forEach(btn => btn.addEventListener('click', () => app.runTool(btn.dataset.tool)));
        el.querySelectorAll('.tool-edit-btn').forEach(btn => btn.addEventListener('click', () => app.editTool(btn.dataset.tool)));
        el.querySelectorAll('.tool-approve-btn').forEach(btn => btn.addEventListener('click', () => app.approveTool(btn.dataset.tool)));
    },

    async renderAudit(el) {
        const logs = await this.fetchApi("audit?limit=100");
        if (logs.length === 0) {
            el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#128203;</div><div class="empty-state-text">No audit logs</div></div>';
            return;
        }

        el.innerHTML = '<div class="card"><div class="card-body"><div class="table-wrap"><table><thead><tr><th>Timestamp</th><th>Action</th><th>Tool</th><th>Details</th></tr></thead><tbody>' +
            logs.map(log => `<tr><td>${escHtml(new Date(log.timestamp).toLocaleString())}</td><td><span class="badge badge-info">${escHtml(log.action)}</span></td><td>${escHtml(log.toolName)}</td><td>${log.duration ? escHtml(log.duration) + 'ms' : ''} ${log.details ? escHtml(JSON.stringify(log.details)) : ''}</td></tr>`).join("") +
            '</tbody></table></div></div></div>';
    },

    async renderPermissions(el) {
        const perms = await this.fetchApi("permissions");
        if (perms.length === 0) {
            el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#128274;</div><div class="empty-state-text">No permissions configured</div></div>';
            return;
        }

        el.innerHTML = '<div class="card"><div class="card-body"><div class="table-wrap"><table><thead><tr><th>Tool</th><th>Version</th><th>Capabilities</th><th>Approved At</th></tr></thead><tbody>' +
            perms.map(p => `<tr><td>${escHtml(p.toolName)}</td><td>v${escHtml(p.toolVersion)}</td><td>${p.approvedCapabilities.map(c => `<span class="badge badge-warning">${escHtml(c.type)}</span>`).join(' ')}</td><td>${escHtml(new Date(p.approvedAt).toLocaleString())}</td></tr>`).join("") +
            '</tbody></table></div></div></div>';
    },

    async renderSchedules(el) {
        const schedules = await this.fetchApi("schedules");
        if (schedules.length === 0) {
            el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#9200;</div><div class="empty-state-text">No schedules configured</div></div>';
            return;
        }

        el.innerHTML = '<div class="card"><div class="card-body"><div class="table-wrap"><table><thead><tr><th>ID</th><th>Tool</th><th>Cron</th><th>Status</th><th>Last Run</th><th>Next Run</th></tr></thead><tbody>' +
            schedules.map(s => `<tr><td>${escHtml(s.id)}</td><td>${escHtml(s.toolName)}</td><td><code>${escHtml(s.cron)}</code></td><td><span class="badge ${s.enabled ? 'badge-success' : 'badge-neutral'}">${s.enabled ? 'Enabled' : 'Disabled'}</span></td><td>${s.lastRun ? escHtml(new Date(s.lastRun).toLocaleString()) : 'Never'}</td><td>${s.nextRun ? escHtml(new Date(s.nextRun).toLocaleString()) : 'N/A'}</td></tr>`).join("") +
            '</tbody></table></div></div></div>';
    },

    async renderWebhooks(el) {
        const webhooks = await this.fetchApi("webhooks");
        if (webhooks.length === 0) {
            el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#128279;</div><div class="empty-state-text">No webhooks configured</div></div>';
            return;
        }

        el.innerHTML = '<div class="card"><div class="card-body"><div class="table-wrap"><table><thead><tr><th>ID</th><th>Tool</th><th>Path</th><th>Method</th><th>Status</th><th>Secret</th></tr></thead><tbody>' +
            webhooks.map(w => `<tr><td>${escHtml(w.id)}</td><td>${escHtml(w.toolName)}</td><td><code>/webhook${escHtml(w.path)}</code></td><td><span class="badge badge-info">${escHtml(w.method)}</span></td><td><span class="badge ${w.enabled ? 'badge-success' : 'badge-neutral'}">${w.enabled ? 'Enabled' : 'Disabled'}</span></td><td>${w.secret ? '&#10003;' : '&mdash;'}</td></tr>`).join("") +
            '</tbody></table></div></div></div>';
    },

    async renderPipelines(el) {
        const pipelines = await this.fetchApi("pipelines");
        if (pipelines.length === 0) {
            el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#128256;</div><div class="empty-state-text">No pipelines defined</div></div>';
            return;
        }

        el.innerHTML = '<div class="tool-grid">' + pipelines.map(p => `
            <div class="tool-card">
                <div class="tool-card-header">
                    <span class="tool-name">${escHtml(p.name)}</span>
                    <span class="badge badge-info">${escHtml(p.steps.length)} steps</span>
                </div>
                <div class="tool-desc">${escHtml(p.description)}</div>
                <div class="tool-meta">
                    ${p.steps.map(s => `<span class="tag">${escHtml(s.tool)}</span>`).join('')}
                </div>
            </div>
        `).join("") + '</div>';
    },

    async renderCache(el) {
        const stats = await this.fetchApi("cache");

        el.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-label">Cached Entries</div>
                    <div class="stat-value info">${escHtml(stats.totalEntries || 0)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Cache Hits</div>
                    <div class="stat-value success">${escHtml(stats.hits || 0)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Cache Misses</div>
                    <div class="stat-value warning">${escHtml(stats.misses || 0)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Hit Rate</div>
                    <div class="stat-value success">${escHtml(stats.hitRate || 0)}%</div>
                    <div class="progress-bar"><div class="progress-fill" style="width:${escHtml(stats.hitRate || 0)}%;background:var(--success)"></div></div>
                </div>
            </div>
            <div class="card">
                <div class="card-header">
                    <h3>Entries by Tool</h3>
                    <button class="btn btn-danger btn-sm" onclick="app.clearCache()">Clear All</button>
                </div>
                <div class="card-body">
                    ${Object.keys(stats.entriesByTool || {}).length === 0 ? '<div class="empty-state"><div class="empty-state-text">No cached entries</div></div>' :
                '<div class="table-wrap"><table><thead><tr><th>Tool</th><th>Entries</th></tr></thead><tbody>' +
                Object.entries(stats.entriesByTool || {}).map(([tool, count]) => `<tr><td>${escHtml(tool)}</td><td>${escHtml(count)}</td></tr>`).join("") +
                '</tbody></table></div>'}
                </div>
            </div>
        `;
    },

    async clearCache() {
        await fetch("/api/cache", { method: "DELETE" });
        await this.renderCache(document.getElementById("main-content"));
    },

    async renderSecrets(el) {
        const secrets = await this.fetchApi("secrets");
        if (secrets.length === 0) {
            el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#128272;</div><div class="empty-state-text">No secrets stored</div></div>';
            return;
        }

        el.innerHTML = '<div class="card"><div class="card-header"><h3>Stored Secrets</h3></div><div class="card-body"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Created</th><th>Updated</th></tr></thead><tbody>' +
            secrets.map(s => `<tr><td>${escHtml(s.name)}</td><td>${escHtml(new Date(s.createdAt).toLocaleString())}</td><td>${escHtml(new Date(s.updatedAt).toLocaleString())}</td></tr>`).join("") +
            '</tbody></table></div></div></div>';
    },

    async renderAliases(el) {
        const aliases = await this.fetchApi("aliases");
        if (aliases.length === 0) {
            el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#127991;&#65039;</div><div class="empty-state-text">No aliases defined</div></div>';
            return;
        }

        el.innerHTML = '<div class="card"><div class="card-body"><div class="table-wrap"><table><thead><tr><th>Alias</th><th>Target Tool</th><th>Preset Params</th><th>Created</th></tr></thead><tbody>' +
            aliases.map(a => `<tr><td><strong>${escHtml(a.alias)}</strong></td><td>${escHtml(a.targetTool)}</td><td><code>${escHtml(JSON.stringify(a.presetParams))}</code></td><td>${escHtml(new Date(a.createdAt).toLocaleString())}</td></tr>`).join("") +
            '</tbody></table></div></div></div>';
    },

    async renderMarketplace(el) {
        const entries = await this.fetchApi("marketplace");
        if (entries.length === 0) {
            el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#127978;</div><div class="empty-state-text">Marketplace is empty</div></div>';
            return;
        }

        el.innerHTML = '<div class="tool-grid">' + entries.map(e => `
            <div class="tool-card">
                <div class="tool-card-header">
                    <span class="tool-name">${escHtml(e.name)}</span>
                    <span class="badge badge-info">v${escHtml(e.version)}</span>
                </div>
                <div class="tool-desc">${escHtml(e.description)}</div>
                <div class="tool-meta">
                    <span class="badge badge-neutral">${escHtml(e.author)}</span>
                    <span class="badge badge-warning">${escHtml(e.category)}</span>
                    ${(e.tags || []).map(t => `<span class="tag">#${escHtml(t)}</span>`).join('')}
                </div>
            </div>
        `).join("") + '</div>';
    },

    async renderResources(el) {
        const resources = await this.fetchApi("resources");
        if (resources.length === 0) {
            el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#128230;</div><div class="empty-state-text">No resources defined</div></div>';
            return;
        }

        el.innerHTML = '<div class="card"><div class="card-body"><div class="table-wrap"><table><thead><tr><th>Name</th><th>URI</th><th>Type</th><th>Size</th></tr></thead><tbody>' +
            resources.map(r => `<tr><td>${escHtml(r.name)}</td><td><code>${escHtml(r.uri)}</code></td><td><span class="badge badge-info">${escHtml(r.mimeType)}</span></td><td>${escHtml(r.content.length)} chars</td></tr>`).join("") +
            '</tbody></table></div></div></div>';
    },

    async renderPrompts(el) {
        const prompts = await this.fetchApi("prompts");
        if (prompts.length === 0) {
            el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#128172;</div><div class="empty-state-text">No prompts defined</div></div>';
            return;
        }

        el.innerHTML = '<div class="tool-grid">' + prompts.map(p => `
            <div class="tool-card">
                <div class="tool-card-header">
                    <span class="tool-name">${escHtml(p.name)}</span>
                    <span class="badge badge-info">${escHtml(p.arguments.length)} args</span>
                </div>
                <div class="tool-desc">${escHtml(p.description)}</div>
                <div class="code-block">${escHtml(p.template)}</div>
            </div>
        `).join("") + '</div>';
    },

    currentTool: null,
    editor: null,

    async approveTool(name) {
        if (!confirm(`Approve capabilities for tool '${name}'?`)) return;
        try {
            await fetch(`/api/tools/${encodeURIComponent(name)}/approve`, { method: "POST" });
            app.refresh();
        } catch (e) {
            alert("Approval failed: " + e.message);
        }
    },

    async runTool(name) {
        this.currentTool = name;
        document.getElementById("run-modal-title").textContent = `Run ${name}`;
        document.getElementById("run-params").value = "{\n  \n}";
        document.getElementById("run-response").style.display = "none";
        document.getElementById("run-response").textContent = "";
        document.getElementById("run-modal").classList.add("active");
    },

    closeRunModal() {
        document.getElementById("run-modal").classList.remove("active");
        this.currentTool = null;
    },

    async executeTool() {
        if (!this.currentTool) return;
        const paramsStr = document.getElementById("run-params").value;
        let params = {};
        if (paramsStr.trim()) {
            try {
                params = JSON.parse(paramsStr);
            } catch (e) {
                alert("Invalid JSON parameters");
                return;
            }
        }

        const respEl = document.getElementById("run-response");
        respEl.style.display = "block";
        respEl.textContent = "Executing...";

        try {
            const res = await fetch(`/api/tools/${encodeURIComponent(this.currentTool)}/run`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ params })
            });
            const data = await res.json();
            if (data.success) {
                respEl.textContent = "Success (" + data.durationMs + "ms):\n" + JSON.stringify(data.result, null, 2);
                respEl.style.color = "var(--success)";
            } else {
                respEl.textContent = "Error (" + data.durationMs + "ms):\n" + data.error;
                respEl.style.color = "var(--danger)";
            }
        } catch (e) {
            respEl.textContent = "Request Failed:\n" + e.message;
            respEl.style.color = "var(--danger)";
        }
    },

    async editTool(name) {
        this.currentTool = name;
        document.getElementById("edit-modal-title").textContent = `Edit ${name}`;
        document.getElementById("edit-modal").classList.add("active");

        try {
            const tools = await this.fetchApi("tools");
            const tool = tools.find(t => t.name === name);
            const code = tool ? tool.code : "// tool not found";

            if (!this.editor) {
                this.editor = CodeMirror.fromTextArea(document.getElementById("edit-code-editor"), {
                    mode: "javascript",
                    theme: "dracula",
                    lineNumbers: true,
                    matchBrackets: true
                });
            }
            this.editor.setValue(code);
            setTimeout(() => this.editor.refresh(), 50);
        } catch (e) {
            alert("Failed to load tool code");
            this.closeEditModal();
        }
    },

    closeEditModal() {
        document.getElementById("edit-modal").classList.remove("active");
        this.currentTool = null;
    },

    async saveCode() {
        if (!this.currentTool || !this.editor) return;
        const code = this.editor.getValue();

        try {
            const res = await fetch(`/api/tools/${encodeURIComponent(this.currentTool)}/code`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code })
            });
            const data = await res.json();
            if (data.success) {
                this.closeEditModal();
                app.refresh();
            } else {
                alert("Failed to save: " + data.error);
            }
        } catch (e) {
            alert("Failed to save: " + e.message);
        }
    }
};

document.addEventListener("DOMContentLoaded", () => app.init());
