import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { fileURLToPath } from "url";
import { SecretEntry, SecretsStore } from "../types.js";
import { fileExists } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SECRETS_FILE = path.resolve(__dirname, "..", "secrets.json");
const KEY_FILE = path.resolve(__dirname, "..", ".secrets.key");
const SECRETS_SCHEMA_VERSION = 1;
const ALGORITHM = "aes-256-gcm";

let cachedKey: Buffer | null = null;



async function getOrCreateKey(): Promise<Buffer> {
    if (cachedKey) {
        return cachedKey;
    }

    if (await fileExists(KEY_FILE)) {
        const keyHex = await fs.readFile(KEY_FILE, "utf-8");
        cachedKey = Buffer.from(keyHex.trim(), "hex");
        return cachedKey;
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

export async function loadSecrets(): Promise<SecretsStore> {
    if (!await fileExists(SECRETS_FILE)) {
        return {
            version: SECRETS_SCHEMA_VERSION,
            secrets: {}
        };
    }

    try {
        const content = await fs.readFile(SECRETS_FILE, "utf-8");
        const data = JSON.parse(content) as SecretsStore;
        return {
            version: data.version || SECRETS_SCHEMA_VERSION,
            secrets: data.secrets || {}
        };
    } catch {
        return {
            version: SECRETS_SCHEMA_VERSION,
            secrets: {}
        };
    }
}

export async function saveSecrets(store: SecretsStore): Promise<void> {
    await fs.writeFile(SECRETS_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
}

export async function setSecret(name: string, value: string): Promise<void> {
    const key = await getOrCreateKey();
    const store = await loadSecrets();
    const { encrypted, iv } = encrypt(value, key);
    const now = new Date().toISOString();

    store.secrets[name] = {
        name,
        encryptedValue: encrypted,
        iv,
        createdAt: store.secrets[name]?.createdAt || now,
        updatedAt: now
    };

    await saveSecrets(store);
}

export async function getSecret(name: string): Promise<string | null> {
    const store = await loadSecrets();
    const entry = store.secrets[name];

    if (!entry) {
        return null;
    }

    try {
        const key = await getOrCreateKey();
        return decrypt(entry.encryptedValue, entry.iv, key);
    } catch {
        return null;
    }
}

export async function deleteSecret(name: string): Promise<boolean> {
    const store = await loadSecrets();

    if (!store.secrets[name]) {
        return false;
    }

    delete store.secrets[name];
    await saveSecrets(store);
    return true;
}

export async function listSecrets(): Promise<Array<{ name: string; createdAt: string; updatedAt: string }>> {
    const store = await loadSecrets();
    return Object.values(store.secrets).map(s => ({
        name: s.name,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt
    }));
}

export function createSecretsApi(): { get: (name: string) => Promise<string | null> } {
    return {
        get: getSecret
    };
}
