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
            content.innerHTML = '<div class="empty-state"><div class="empty-state-icon">❌</div><div class="empty-state-text">Failed to load data</div></div>';
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
                    <div class="stat-value info">${data.totalTools || 0}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Active Tools</div>
                    <div class="stat-value success">${data.activeTools || 0}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Total Executions</div>
                    <div class="stat-value">${data.totalCalls || 0}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Success Rate</div>
                    <div class="stat-value success">${successRate}%</div>
                    <div class="progress-bar"><div class="progress-fill" style="width:${successRate}%;background:var(--success)"></div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Failed</div>
                    <div class="stat-value danger">${data.totalFailed || 0}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Cache Hit Rate</div>
                    <div class="stat-value info">${data.cacheHitRate || 0}%</div>
                    <div class="progress-bar"><div class="progress-fill" style="width:${data.cacheHitRate || 0}%;background:var(--info)"></div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Schedules</div>
                    <div class="stat-value warning">${data.schedulesCount || 0}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Webhooks</div>
                    <div class="stat-value info">${data.webhooksCount || 0}</div>
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
                audit.map(log => `<tr><td>${new Date(log.timestamp).toLocaleString()}</td><td><span class="badge badge-info">${log.action}</span></td><td>${log.toolName}</td></tr>`).join("") +
                '</tbody></table></div>';
        }
    },

    async renderTools(el) {
        const tools = await this.fetchApi("tools");
        if (tools.length === 0) {
            el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔧</div><div class="empty-state-text">No tools created yet</div></div>';
            return;
        }

        el.innerHTML = '<div class="tool-grid">' + tools.map(tool => `
            <div class="tool-card">
                <div class="tool-card-header">
                    <span class="tool-name">${tool.name}</span>
                    <span class="badge ${tool.active ? 'badge-success' : 'badge-neutral'}">${tool.active ? 'Active' : 'Inactive'}</span>
                </div>
                <div class="tool-desc">${tool.description}</div>
                <div class="tool-meta">
                    <span class="badge badge-info">v${tool.version}</span>
                    ${tool.category ? `<span class="badge badge-warning">${tool.category}</span>` : ''}
                    ${(tool.tags || []).map(t => `<span class="tag">#${t}</span>`).join('')}
                </div>
            </div>
        `).join("") + '</div>';
    },

    async renderAudit(el) {
        const logs = await this.fetchApi("audit?limit=100");
        if (logs.length === 0) {
            el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">No audit logs</div></div>';
            return;
        }

        el.innerHTML = '<div class="card"><div class="card-body"><div class="table-wrap"><table><thead><tr><th>Timestamp</th><th>Action</th><th>Tool</th><th>Details</th></tr></thead><tbody>' +
            logs.map(log => `<tr><td>${new Date(log.timestamp).toLocaleString()}</td><td><span class="badge badge-info">${log.action}</span></td><td>${log.toolName}</td><td>${log.duration ? log.duration + 'ms' : ''} ${log.details ? JSON.stringify(log.details) : ''}</td></tr>`).join("") +
            '</tbody></table></div></div></div>';
    },

    async renderPermissions(el) {
        const perms = await this.fetchApi("permissions");
        if (perms.length === 0) {
            el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔒</div><div class="empty-state-text">No permissions configured</div></div>';
            return;
        }

        el.innerHTML = '<div class="card"><div class="card-body"><div class="table-wrap"><table><thead><tr><th>Tool</th><th>Version</th><th>Capabilities</th><th>Approved At</th></tr></thead><tbody>' +
            perms.map(p => `<tr><td>${p.toolName}</td><td>v${p.toolVersion}</td><td>${p.approvedCapabilities.map(c => `<span class="badge badge-warning">${c.type}</span>`).join(' ')}</td><td>${new Date(p.approvedAt).toLocaleString()}</td></tr>`).join("") +
            '</tbody></table></div></div></div>';
    },

    async renderSchedules(el) {
        const schedules = await this.fetchApi("schedules");
        if (schedules.length === 0) {
            el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏰</div><div class="empty-state-text">No schedules configured</div></div>';
            return;
        }

        el.innerHTML = '<div class="card"><div class="card-body"><div class="table-wrap"><table><thead><tr><th>ID</th><th>Tool</th><th>Cron</th><th>Status</th><th>Last Run</th><th>Next Run</th></tr></thead><tbody>' +
            schedules.map(s => `<tr><td>${s.id}</td><td>${s.toolName}</td><td><code>${s.cron}</code></td><td><span class="badge ${s.enabled ? 'badge-success' : 'badge-neutral'}">${s.enabled ? 'Enabled' : 'Disabled'}</span></td><td>${s.lastRun ? new Date(s.lastRun).toLocaleString() : 'Never'}</td><td>${s.nextRun ? new Date(s.nextRun).toLocaleString() : 'N/A'}</td></tr>`).join("") +
            '</tbody></table></div></div></div>';
    },

    async renderWebhooks(el) {
        const webhooks = await this.fetchApi("webhooks");
        if (webhooks.length === 0) {
            el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔗</div><div class="empty-state-text">No webhooks configured</div></div>';
            return;
        }

        el.innerHTML = '<div class="card"><div class="card-body"><div class="table-wrap"><table><thead><tr><th>ID</th><th>Tool</th><th>Path</th><th>Method</th><th>Status</th><th>Secret</th></tr></thead><tbody>' +
            webhooks.map(w => `<tr><td>${w.id}</td><td>${w.toolName}</td><td><code>/webhook${w.path}</code></td><td><span class="badge badge-info">${w.method}</span></td><td><span class="badge ${w.enabled ? 'badge-success' : 'badge-neutral'}">${w.enabled ? 'Enabled' : 'Disabled'}</span></td><td>${w.secret ? '✓' : '—'}</td></tr>`).join("") +
            '</tbody></table></div></div></div>';
    },

    async renderPipelines(el) {
        const pipelines = await this.fetchApi("pipelines");
        if (pipelines.length === 0) {
            el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔀</div><div class="empty-state-text">No pipelines defined</div></div>';
            return;
        }

        el.innerHTML = '<div class="tool-grid">' + pipelines.map(p => `
            <div class="tool-card">
                <div class="tool-card-header">
                    <span class="tool-name">${p.name}</span>
                    <span class="badge badge-info">${p.steps.length} steps</span>
                </div>
                <div class="tool-desc">${p.description}</div>
                <div class="tool-meta">
                    ${p.steps.map(s => `<span class="tag">${s.tool}</span>`).join('')}
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
                    <div class="stat-value info">${stats.totalEntries || 0}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Cache Hits</div>
                    <div class="stat-value success">${stats.hits || 0}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Cache Misses</div>
                    <div class="stat-value warning">${stats.misses || 0}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Hit Rate</div>
                    <div class="stat-value success">${stats.hitRate || 0}%</div>
                    <div class="progress-bar"><div class="progress-fill" style="width:${stats.hitRate || 0}%;background:var(--success)"></div></div>
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
                Object.entries(stats.entriesByTool || {}).map(([tool, count]) => `<tr><td>${tool}</td><td>${count}</td></tr>`).join("") +
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
            el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔐</div><div class="empty-state-text">No secrets stored</div></div>';
            return;
        }

        el.innerHTML = '<div class="card"><div class="card-header"><h3>Stored Secrets</h3></div><div class="card-body"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Created</th><th>Updated</th></tr></thead><tbody>' +
            secrets.map(s => `<tr><td>${s.name}</td><td>${new Date(s.createdAt).toLocaleString()}</td><td>${new Date(s.updatedAt).toLocaleString()}</td></tr>`).join("") +
            '</tbody></table></div></div></div>';
    },

    async renderAliases(el) {
        const aliases = await this.fetchApi("aliases");
        if (aliases.length === 0) {
            el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🏷️</div><div class="empty-state-text">No aliases defined</div></div>';
            return;
        }

        el.innerHTML = '<div class="card"><div class="card-body"><div class="table-wrap"><table><thead><tr><th>Alias</th><th>Target Tool</th><th>Preset Params</th><th>Created</th></tr></thead><tbody>' +
            aliases.map(a => `<tr><td><strong>${a.alias}</strong></td><td>${a.targetTool}</td><td><code>${JSON.stringify(a.presetParams)}</code></td><td>${new Date(a.createdAt).toLocaleString()}</td></tr>`).join("") +
            '</tbody></table></div></div></div>';
    },

    async renderMarketplace(el) {
        const entries = await this.fetchApi("marketplace");
        if (entries.length === 0) {
            el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🏪</div><div class="empty-state-text">Marketplace is empty</div></div>';
            return;
        }

        el.innerHTML = '<div class="tool-grid">' + entries.map(e => `
            <div class="tool-card">
                <div class="tool-card-header">
                    <span class="tool-name">${e.name}</span>
                    <span class="badge badge-info">v${e.version}</span>
                </div>
                <div class="tool-desc">${e.description}</div>
                <div class="tool-meta">
                    <span class="badge badge-neutral">${e.author}</span>
                    <span class="badge badge-warning">${e.category}</span>
                    ${(e.tags || []).map(t => `<span class="tag">#${t}</span>`).join('')}
                </div>
            </div>
        `).join("") + '</div>';
    },

    async renderResources(el) {
        const resources = await this.fetchApi("resources");
        if (resources.length === 0) {
            el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📦</div><div class="empty-state-text">No resources defined</div></div>';
            return;
        }

        el.innerHTML = '<div class="card"><div class="card-body"><div class="table-wrap"><table><thead><tr><th>Name</th><th>URI</th><th>Type</th><th>Size</th></tr></thead><tbody>' +
            resources.map(r => `<tr><td>${r.name}</td><td><code>${r.uri}</code></td><td><span class="badge badge-info">${r.mimeType}</span></td><td>${r.content.length} chars</td></tr>`).join("") +
            '</tbody></table></div></div></div>';
    },

    async renderPrompts(el) {
        const prompts = await this.fetchApi("prompts");
        if (prompts.length === 0) {
            el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💬</div><div class="empty-state-text">No prompts defined</div></div>';
            return;
        }

        el.innerHTML = '<div class="tool-grid">' + prompts.map(p => `
            <div class="tool-card">
                <div class="tool-card-header">
                    <span class="tool-name">${p.name}</span>
                    <span class="badge badge-info">${p.arguments.length} args</span>
                </div>
                <div class="tool-desc">${p.description}</div>
                <div class="code-block">${p.template}</div>
            </div>
        `).join("") + '</div>';
    }
};

document.addEventListener("DOMContentLoaded", () => app.init());
