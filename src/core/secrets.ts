import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { getDb } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILE = path.resolve(__dirname, "..", "..", "data", ".secrets.key");
const LEGACY_KEY_FILE = path.resolve(__dirname, "..", ".secrets.key");
const ALGORITHM = "aes-256-gcm";

let cachedKey: Buffer | null = null;

async function getOrCreateKey(): Promise<Buffer> {
    if (cachedKey) {
        return cachedKey;
    }

    await fs.mkdir(path.dirname(KEY_FILE), { recursive: true });

    try {
        const keyHex = await fs.readFile(KEY_FILE, "utf-8");
        cachedKey = Buffer.from(keyHex.trim(), "hex");
        return cachedKey;
    } catch {
    }

    try {
        const legacyHex = await fs.readFile(LEGACY_KEY_FILE, "utf-8");
        cachedKey = Buffer.from(legacyHex.trim(), "hex");
        await fs.writeFile(KEY_FILE, legacyHex.trim(), { mode: 0o600 });
        await fs.unlink(LEGACY_KEY_FILE).catch(() => { });
        return cachedKey;
    } catch {
    }

    cachedKey = crypto.randomBytes(32);
    await fs.writeFile(KEY_FILE, cachedKey.toString("hex"), { mode: 0o600 });
    return cachedKey;
}

function encrypt(text: string, key: Buffer): { encrypted: string; iv: string } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag();
    return {
        encrypted: encrypted + ":" + authTag.toString("hex"),
        iv: iv.toString("hex")
    };
}

function decrypt(encryptedData: string, iv: string, key: Buffer): string {
    const [encrypted, authTagHex] = encryptedData.split(":");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}

export async function setSecret(name: string, value: string): Promise<void> {
    const key = await getOrCreateKey();
    const { encrypted, iv } = encrypt(value, key);
    const now = new Date().toISOString();
    const db = getDb();

    const existing = db.prepare("SELECT created_at FROM secrets WHERE name = ?").get(name) as any;
    const createdAt = existing?.created_at || now;

    db.prepare(
        `INSERT OR REPLACE INTO secrets (name, encrypted_value, iv, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
    ).run(name, encrypted, iv, createdAt, now);
}

export async function getSecret(name: string): Promise<string | null> {
    const db = getDb();
    const row = db.prepare("SELECT * FROM secrets WHERE name = ?").get(name) as any;
    if (!row) return null;

    try {
        const key = await getOrCreateKey();
        return decrypt(row.encrypted_value, row.iv, key);
    } catch {
        return null;
    }
}

export async function deleteSecret(name: string): Promise<boolean> {
    const db = getDb();
    const result = db.prepare("DELETE FROM secrets WHERE name = ?").run(name);
    return result.changes > 0;
}

export async function listSecrets(): Promise<Array<{ name: string; createdAt: string; updatedAt: string }>> {
    const db = getDb();
    const rows = db.prepare("SELECT name, created_at, updated_at FROM secrets").all() as any[];
    return rows.map(row => ({
        name: row.name,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }));
}

export function createSecretsApi(): { get: (name: string) => Promise<string | null> } {
    return {
        get: getSecret
    };
}

export async function redactSecrets(text: string): Promise<string> {
    if (!text) return text;
    const db = getDb();
    const rows = db.prepare("SELECT * FROM secrets").all() as any[];
    if (rows.length === 0) return text;

    const key = await getOrCreateKey();
    let out = text;
    for (const row of rows) {
        let value: string;
        try {
            value = decrypt(row.encrypted_value, row.iv, key);
        } catch {
            continue;
        }
        if (value && value.length >= 4 && out.includes(value)) {
            out = out.split(value).join(`[REDACTED:${row.name}]`);
        }
    }
    return out;
}
