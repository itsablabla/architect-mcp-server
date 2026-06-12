import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { CustomTool, ToolSignature } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILE = path.resolve(__dirname, "..", "..", "data", ".signing.key");

let cachedPrivateKey: crypto.KeyObject | null = null;

async function getOrCreatePrivateKey(): Promise<crypto.KeyObject> {
    if (cachedPrivateKey) return cachedPrivateKey;

    await fs.mkdir(path.dirname(KEY_FILE), { recursive: true });

    try {
        const pem = await fs.readFile(KEY_FILE, "utf-8");
        cachedPrivateKey = crypto.createPrivateKey(pem);
        return cachedPrivateKey;
    } catch {
    }

    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    await fs.writeFile(KEY_FILE, pem, { mode: 0o600 });
    cachedPrivateKey = privateKey;
    return privateKey;
}

function canonicalToolPayload(tool: Pick<CustomTool, "name" | "code" | "schema" | "capabilities" | "imports" | "version">): Buffer {
    return Buffer.from(JSON.stringify({
        name: tool.name,
        code: tool.code,
        schema: tool.schema,
        capabilities: tool.capabilities ?? [],
        imports: tool.imports ?? [],
        version: tool.version
    }));
}

export async function signTool(tool: CustomTool): Promise<ToolSignature> {
    const privateKey = await getOrCreatePrivateKey();
    const publicKey = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" }) as string;
    const signature = crypto.sign(null, canonicalToolPayload(tool), privateKey);
    return {
        algorithm: "ed25519",
        publicKey,
        value: signature.toString("base64")
    };
}

export function verifyToolSignature(tool: CustomTool, signature: ToolSignature): boolean {
    if (signature.algorithm !== "ed25519") return false;
    try {
        const publicKey = crypto.createPublicKey(signature.publicKey);
        return crypto.verify(null, canonicalToolPayload(tool), publicKey, Buffer.from(signature.value, "base64"));
    } catch {
        return false;
    }
}

export async function getPublicKeyPem(): Promise<string> {
    const privateKey = await getOrCreatePrivateKey();
    return crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" }) as string;
}
