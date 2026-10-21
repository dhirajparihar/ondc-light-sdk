/**
 * OndcCrypto.ts
 * Cryptographic Ed25519 signing and verification engine for ONDC Beckn Protocol.
 * Adheres to Blake2b hashing and Ed25519 digital signature specifications.
 */

import { createRequire } from 'node:module';
import type * as LibsodiumTypes from 'libsodium-wrappers';
import type {
  OndcAuthHeaderOptions,
  OndcVerifyHeaderOptions,
  OndcSignatureParts,
} from './types.js';

// Load libsodium via createRequire to reliably resolve in all Node ESM environments
const require = createRequire(import.meta.url);
const sodiumInstance: typeof LibsodiumTypes = require('libsodium-wrappers');

let sodiumReadyPromise: Promise<typeof LibsodiumTypes> | null = null;

/**
 * Ensures libsodium is initialized and ready before running cryptographic operations.
 */
export async function ensureSodiumReady(): Promise<typeof LibsodiumTypes> {
  if (!sodiumReadyPromise) {
    sodiumReadyPromise = sodiumInstance.ready.then(() => sodiumInstance);
  }
  return sodiumReadyPromise;
}

/**
 * Normalizes an Ed25519 key into a Uint8Array.
 * Accepts Base64 string, Hex string, or existing Uint8Array.
 */
function normalizeKey(key: string | Uint8Array, sodium: typeof LibsodiumTypes): Uint8Array {
  if (key instanceof Uint8Array) {
    return key;
  }

  if (typeof key !== 'string') {
    throw new TypeError('Key must be a string (Base64/Hex) or Uint8Array');
  }

  const trimmed = key.trim();

  // If it's a hex string (e.g. 64 or 128 characters)
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return sodium.from_hex(trimmed);
  }

  // Fallback to Base64 (standard ONDC representation)
  try {
    return sodium.from_base64(trimmed, sodium.base64_variants.ORIGINAL);
  } catch {
    return sodium.from_base64(trimmed, sodium.base64_variants.URLSAFE_NO_PADDING);
  }
}

/**
 * Resolves a private key into a full 64-byte Ed25519 secret key.
 * If a 32-byte seed is provided, it derives the full secret key.
 */
function resolvePrivateKey(
  privateKey: string | Uint8Array,
  sodium: typeof LibsodiumTypes
): Uint8Array {
  const rawKey = normalizeKey(privateKey, sodium);
  if (rawKey.length === 64) {
    return rawKey;
  }
  if (rawKey.length === 32) {
    const keyPair = sodium.crypto_sign_seed_keypair(rawKey);
    return keyPair.privateKey;
  }
  throw new Error(
    `Invalid Ed25519 private key length (${rawKey.length} bytes). Expected 32-byte seed or 64-byte secret key.`
  );
}

/**
 * Resolves a public key into a 32-byte Ed25519 public key.
 */
function resolvePublicKey(
  publicKey: string | Uint8Array,
  sodium: typeof LibsodiumTypes
): Uint8Array {
  const rawKey = normalizeKey(publicKey, sodium);
  if (rawKey.length === 32) {
    return rawKey;
  }
  if (rawKey.length === 64) {
    // If a full secret key was accidentally passed as public key, extract public key part (last 32 bytes)
    return rawKey.slice(32);
  }
  throw new Error(
    `Invalid Ed25519 public key length (${rawKey.length} bytes). Expected 32 bytes.`
  );
}

/**
 * Generates a fresh Ed25519 signing keypair encoded as Base64 strings.
 */
export async function generateKeyPair(): Promise<{
  publicKey: string;
  privateKey: string;
  keyType: string;
}> {
  const sodium = await ensureSodiumReady();
  const keyPair = sodium.crypto_sign_keypair();
  return {
    publicKey: sodium.to_base64(keyPair.publicKey, sodium.base64_variants.ORIGINAL),
    privateKey: sodium.to_base64(keyPair.privateKey, sodium.base64_variants.ORIGINAL),
    keyType: 'ed25519',
  };
}

/**
 * Computes the BLAKE-512 (Blake2b 64-byte) digest of the given payload string/object,
 * returning the Base64 encoded digest.
 */
export async function createBlake2bDigest(
  body: string | object
): Promise<string> {
  const sodium = await ensureSodiumReady();
  const serialized = typeof body === 'string' ? body : JSON.stringify(body);
  const hashBytes = sodium.crypto_generichash(64, sodium.from_string(serialized));
  return sodium.to_base64(hashBytes, sodium.base64_variants.ORIGINAL);
}

/**
 * Reconstructs the canonical Beckn signing string.
 */
export function constructSigningString(created: number, expires: number, digest: string): string {
  return `(created): ${created}\n(expires): ${expires}\ndigest: BLAKE-512=${digest}`;
}

/**
 * Generates an ONDC-compliant HTTP Authorization header signature string.
 *
 * Header format:
 * Signature username="[subscriberId]|[uniqueKeyId]|ed25519", algorithm="ed25519", created="[timestamp]", expires="[timestamp+ttl]", headers="(created) (expires) digest", signature="[base64_signature]"
 */
export async function generateAuthorizationHeader(
  options: OndcAuthHeaderOptions
): Promise<string> {
  const {
    body,
    privateKey,
    subscriberId,
    uniqueKeyId,
    ttl = 3600,
    created: customCreated,
  } = options;

  if (!subscriberId || !uniqueKeyId || !privateKey) {
    throw new Error('subscriberId, uniqueKeyId, and privateKey are required to sign authorization header.');
  }

  const sodium = await ensureSodiumReady();
  const created = customCreated !== undefined ? customCreated : Math.floor(Date.now() / 1000);
  const expires = created + ttl;

  // 1. Compute Blake2b digest of stringified body
  const serialized = typeof body === 'string' ? body : JSON.stringify(body);
  const digestBytes = sodium.crypto_generichash(64, sodium.from_string(serialized));
  const digest = sodium.to_base64(digestBytes, sodium.base64_variants.ORIGINAL);

  // 2. Build Beckn signing string
  const signingString = constructSigningString(created, expires, digest);

  // 3. Sign using Ed25519 private key
  const secretKeyBytes = resolvePrivateKey(privateKey, sodium);
  const signatureBytes = sodium.crypto_sign_detached(
    sodium.from_string(signingString),
    secretKeyBytes
  );
  const signature = sodium.to_base64(signatureBytes, sodium.base64_variants.ORIGINAL);

  // 4. Assemble standard ONDC Authorization header
  return `Signature username="${subscriberId}|${uniqueKeyId}|ed25519", algorithm="ed25519", created="${created}", expires="${expires}", headers="(created) (expires) digest", signature="${signature}"`;
}

/**
 * Parses an ONDC / Beckn Authorization header into its constituent parts.
 */
export function parseAuthorizationHeader(header: string): OndcSignatureParts {
  if (!header || typeof header !== 'string') {
    throw new Error('Authorization header is required and must be a string.');
  }

  // Normalize header prefix (strip leading 'Signature ' if present)
  let cleanHeader = header.trim();
  if (cleanHeader.toLowerCase().startsWith('signature ')) {
    cleanHeader = cleanHeader.substring('signature '.length).trim();
  }

  const pairs: Record<string, string> = {};
  // Match key="value" pairs, supporting escaping
  const regex = /([a-zA-Z0-9_-]+)="([^"\\]*(?:\\.[^"\\]*)*)"/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(cleanHeader)) !== null) {
    pairs[match[1]] = match[2];
  }

  const username = pairs.username || '';
  const algorithm = pairs.algorithm || 'ed25519';
  const created = parseInt(pairs.created || '0', 10);
  const expires = parseInt(pairs.expires || '0', 10);
  const headers = pairs.headers || '(created) (expires) digest';
  const signature = pairs.signature || '';

  const usernameParts = username.split('|');
  const subscriberId = usernameParts[0] || pairs.subscriberId || '';
  const uniqueKeyId = usernameParts[1] || pairs.keyId || '';

  if (!signature) {
    throw new Error('Invalid Authorization header format: Missing signature field.');
  }

  return {
    subscriberId,
    uniqueKeyId,
    algorithm,
    created,
    expires,
    headers,
    signature,
  };
}

/**
 * Verifies an incoming Authorization header signature against the body content and subscriber public key.
 */
export async function verifyAuthorizationHeader(
  options: OndcVerifyHeaderOptions
): Promise<boolean> {
  const { header, body, publicKey, toleranceSeconds = 300 } = options;

  if (!header || !body || !publicKey) {
    return false;
  }

  try {
    const sodium = await ensureSodiumReady();
    const parts = parseAuthorizationHeader(header);

    // Check expiration with leeway for network clock drift
    const now = Math.floor(Date.now() / 1000);
    if (parts.expires && parts.expires + toleranceSeconds < now) {
      return false; // Signature expired
    }

    // Check if created timestamp is unreasonably in the future
    if (parts.created && parts.created - toleranceSeconds > now) {
      return false; // Signature created in future
    }

    // 1. Recompute payload Blake2b digest
    const serialized = typeof body === 'string' ? body : JSON.stringify(body);
    const digestBytes = sodium.crypto_generichash(64, sodium.from_string(serialized));
    const digest = sodium.to_base64(digestBytes, sodium.base64_variants.ORIGINAL);

    // 2. Reconstruct Beckn signing string
    const signingString = constructSigningString(parts.created, parts.expires, digest);

    // 3. Verify detached Ed25519 signature
    const publicKeyBytes = resolvePublicKey(publicKey, sodium);
    const signatureBytes = sodium.from_base64(parts.signature, sodium.base64_variants.ORIGINAL);

    return sodium.crypto_sign_verify_detached(
      signatureBytes,
      sodium.from_string(signingString),
      publicKeyBytes
    );
  } catch {
    return false;
  }
}

/**
 * Synchronous verification helper when sodium is already initialized.
 */
export function verifyAuthorizationHeaderSync(
  options: OndcVerifyHeaderOptions
): boolean {
  const { header, body, publicKey, toleranceSeconds = 300 } = options;
  if (!header || !body || !publicKey) return false;

  try {
    const sodium = sodiumInstance;
    const parts = parseAuthorizationHeader(header);
    const now = Math.floor(Date.now() / 1000);

    if (parts.expires && parts.expires + toleranceSeconds < now) {
      return false;
    }
    if (parts.created && parts.created - toleranceSeconds > now) {
      return false;
    }

    const serialized = typeof body === 'string' ? body : JSON.stringify(body);
    const digestBytes = sodium.crypto_generichash(64, sodium.from_string(serialized));
    const digest = sodium.to_base64(digestBytes, sodium.base64_variants.ORIGINAL);

    const signingString = constructSigningString(parts.created, parts.expires, digest);
    const publicKeyBytes = resolvePublicKey(publicKey, sodium);
    const signatureBytes = sodium.from_base64(parts.signature, sodium.base64_variants.ORIGINAL);

    return sodium.crypto_sign_verify_detached(
      signatureBytes,
      sodium.from_string(signingString),
      publicKeyBytes
    );
  } catch {
    return false;
  }
}

/**
 * OndcCrypto engine bundled as a cohesive namespace object.
 */
export const OndcCrypto = {
  ensureSodiumReady,
  generateKeyPair,
  createBlake2bDigest,
  constructSigningString,
  generateAuthorizationHeader,
  parseAuthorizationHeader,
  verifyAuthorizationHeader,
  verifyAuthorizationHeaderSync,
};

export default OndcCrypto;
