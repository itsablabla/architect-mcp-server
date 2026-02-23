import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "..", "..", "data", "architect.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
    if (!_db) {
        fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
        _db = new Database(DB_PATH);
        _db.pragma("journal_mode = WAL");
        _db.pragma("foreign_keys = ON");
        _db.pragma("synchronous = NORMAL");
        initializeSchema(_db);
    }
    return _db;
}

export function closeDb(): void {
    if (_db) {
        _db.close();
        _db = null;
    }
}

function initializeSchema(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS tools (
            name TEXT PRIMARY KEY,
            description TEXT NOT NULL,
            code TEXT NOT NULL,
            schema TEXT NOT NULL,
            capabilities TEXT NOT NULL DEFAULT '[]',
            category TEXT DEFAULT 'other',
            tags TEXT DEFAULT '[]',
            dependencies TEXT DEFAULT '[]',
            version INTEGER DEFAULT 1,
            author TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deprecated INTEGER DEFAULT 0,
            failing_since TEXT,
            rate_limit TEXT,
            cache_config TEXT,
            retry_config TEXT,
            tests TEXT,
            imports TEXT DEFAULT '[]',
            returns_schema TEXT,
            timeout_ms INTEGER
        );

        CREATE TABLE IF NOT EXISTS execution_stats (
            tool_name TEXT PRIMARY KEY,
            total_calls INTEGER DEFAULT 0,
            successful_calls INTEGER DEFAULT 0,
            failed_calls INTEGER DEFAULT 0,
            total_duration_ms INTEGER DEFAULT 0,
            average_duration_ms INTEGER DEFAULT 0,
            last_executed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS rate_limit_state (
            tool_name TEXT PRIMARY KEY,
            minute_calls TEXT DEFAULT '[]',
            hour_calls TEXT DEFAULT '[]'
        );

        CREATE TABLE IF NOT EXISTS tool_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tool_name TEXT NOT NULL,
            version INTEGER NOT NULL,
            tool_snapshot TEXT NOT NULL,
            saved_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            action TEXT NOT NULL,
            tool_name TEXT NOT NULL,
            details TEXT,
            duration_ms INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_audit_tool ON audit_log(tool_name);
        CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
        CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);

        CREATE TABLE IF NOT EXISTS permissions (
            tool_name TEXT PRIMARY KEY,
            tool_version INTEGER NOT NULL,
            approved_capabilities TEXT NOT NULL,
            approved_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS secrets (
            name TEXT PRIMARY KEY,
            encrypted_value TEXT NOT NULL,
            iv TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS cache_entries (
            cache_key TEXT PRIMARY KEY,
            tool_name TEXT NOT NULL,
            result TEXT NOT NULL,
            cached_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cache_tool ON cache_entries(tool_name);
        CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache_entries(expires_at);

        CREATE TABLE IF NOT EXISTS cache_stats (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            hits INTEGER DEFAULT 0,
            misses INTEGER DEFAULT 0
        );
        INSERT OR IGNORE INTO cache_stats (id, hits, misses) VALUES (1, 0, 0);

        CREATE TABLE IF NOT EXISTS memory (
            store_key TEXT PRIMARY KEY,
            namespace TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            expires_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_memory_namespace ON memory(namespace);

        CREATE TABLE IF NOT EXISTS schedules (
            id TEXT PRIMARY KEY,
            tool_name TEXT NOT NULL,
            cron TEXT NOT NULL,
            params TEXT DEFAULT '{}',
            enabled INTEGER DEFAULT 1,
            last_run TEXT,
            next_run TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS webhooks (
            id TEXT PRIMARY KEY,
            tool_name TEXT NOT NULL,
            path TEXT NOT NULL,
            method TEXT NOT NULL,
            secret TEXT,
            enabled INTEGER DEFAULT 1,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS pipelines (
            name TEXT PRIMARY KEY,
            description TEXT NOT NULL,
            steps TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS aliases (
            alias TEXT PRIMARY KEY,
            target_tool TEXT NOT NULL,
            preset_params TEXT DEFAULT '{}',
            description TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS anomaly_baselines (
            tool_name TEXT PRIMARY KEY,
            avg_duration_ms REAL NOT NULL,
            fail_rate REAL NOT NULL,
            sampled_at TEXT NOT NULL,
            total_calls_at_sample INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS anomaly_records (
            tool_name TEXT PRIMARY KEY,
            detected_at TEXT NOT NULL,
            reasons TEXT NOT NULL,
            baseline_avg_duration_ms REAL,
            current_avg_duration_ms REAL,
            baseline_fail_rate REAL,
            current_fail_rate REAL
        );

        CREATE TABLE IF NOT EXISTS personas (
            name TEXT PRIMARY KEY,
            description TEXT NOT NULL,
            tools TEXT NOT NULL DEFAULT '[]',
            system_prompt TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS resources (
            uri TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS prompts (
            name TEXT PRIMARY KEY,
            description TEXT NOT NULL,
            arguments TEXT NOT NULL DEFAULT '[]',
            template TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS marketplace_local (
            id TEXT PRIMARY KEY,
            tool_name TEXT NOT NULL,
            description TEXT,
            author TEXT,
            version TEXT,
            category TEXT,
            tags TEXT DEFAULT '[]',
            exported_tool TEXT NOT NULL,
            exported_at TEXT NOT NULL,
            installs INTEGER DEFAULT 0,
            failure_reports INTEGER DEFAULT 0,
            success_rate REAL DEFAULT 100
        );

        CREATE TABLE IF NOT EXISTS marketplace_remote_cache (
            tool_name TEXT PRIMARY KEY,
            entry_json TEXT NOT NULL,
            cached_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS knowledge_cache (
            cache_key TEXT PRIMARY KEY,
            query TEXT NOT NULL,
            result TEXT NOT NULL,
            cached_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS marketplace_peers (
            url TEXT PRIMARY KEY,
            label TEXT,
            added_at TEXT NOT NULL
        );
    `);
}

export function dbExists(): boolean {
    return fs.existsSync(DB_PATH);
}
