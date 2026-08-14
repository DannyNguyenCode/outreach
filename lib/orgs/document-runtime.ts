import "server-only";

import { createHash } from "node:crypto";

import type { ServerEnv } from "@/lib/env/schema";
import { getServerEnv } from "@/lib/env/server";
import {
  HttpMalwareScanner,
  MalwareScanUnavailableError,
  type MalwareScanner,
} from "@/lib/orgs/document-malware";
import {
  createSupabasePrivateDocumentStorage,
  FileSystemPrivateDocumentStorage,
  type PrivateDocumentStorage,
} from "@/lib/orgs/document-storage";

/** Same marker playwright.config.ts sets for localhost e2e (see email mock gate). */
const PLAYWRIGHT_WEB_SERVER_ENV = "PLAYWRIGHT_WEB_SERVER";

export function getPrivateDocumentStorage(): PrivateDocumentStorage {
  const env = getServerEnv();
  if (env.KNOWLEDGE_DOCUMENT_ADAPTER_MODE === "fake") {
    assertFakeDocumentAdaptersAllowed(env);
    return new FileSystemPrivateDocumentStorage();
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Private document storage is not configured. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
    );
  }
  return createSupabasePrivateDocumentStorage({
    supabaseUrl: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    bucketName: env.KNOWLEDGE_STORAGE_BUCKET,
  });
}

export function getDocumentMalwareScanner(): {
  scanner: MalwareScanner;
  name: string;
  version: string;
} {
  const env = getServerEnv();
  if (env.KNOWLEDGE_DOCUMENT_ADAPTER_MODE === "fake") {
    assertFakeDocumentAdaptersAllowed(env);
    return {
      scanner: new DeterministicCleanScanner(),
      name: "deterministic-ci-scanner",
      version: "ci-v1",
    };
  }
  if (!env.MALWARE_SCANNER_URL || !env.MALWARE_SCANNER_API_KEY) {
    throw new Error(
      "Malware scanning is not configured. Documents fail closed until MALWARE_SCANNER_URL and MALWARE_SCANNER_API_KEY are set.",
    );
  }
  const name = env.MALWARE_SCANNER_NAME ?? "configured-http-scanner";
  const version = env.MALWARE_SCANNER_VERSION ?? "v1";
  return {
    scanner: new HttpMalwareScanner({
      endpoint: env.MALWARE_SCANNER_URL,
      bearerToken: env.MALWARE_SCANNER_API_KEY,
      scannerName: name,
    }),
    name,
    version,
  };
}

class DeterministicCleanScanner implements MalwareScanner {
  async scan(bytes: Uint8Array, expectedSha256: string) {
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (checksum !== expectedSha256.toLowerCase()) {
      throw new MalwareScanUnavailableError(
        "Document checksum changed before deterministic scanning.",
      );
    }
    return {
      verdict: "clean" as const,
      sha256: checksum,
      scanner: "deterministic-ci-scanner",
    };
  }
}

/**
 * Fake storage/scanner adapters are allowed only for local development, CI,
 * or the Playwright localhost webServer — never Vercel production.
 */
export function assertFakeDocumentAdaptersAllowed(env: ServerEnv): void {
  if (process.env.VERCEL_ENV === "production") {
    throw new Error(
      "Fake document adapters are not allowed when VERCEL_ENV=production.",
    );
  }

  const allowFake =
    env.NODE_ENV !== "production" ||
    process.env.CI === "true" ||
    (process.env[PLAYWRIGHT_WEB_SERVER_ENV] === "true" &&
      isLocalhostAppUrl(env.NEXT_PUBLIC_APP_URL));

  if (!allowFake) {
    throw new Error(
      "Fake document adapters are not allowed in production deployments. Configure Supabase storage and a malware scanner, or run under CI / Playwright localhost.",
    );
  }
}

function isLocalhostAppUrl(appUrl: string): boolean {
  try {
    const { hostname } = new URL(appUrl);
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}
