// src/services/packs/coordinator.ts
var FixedPackCoordinator = class {
  constructor(preview) {
    this.preview = preview;
  }
  preview;
  pending = /* @__PURE__ */ new Map();
  workerActive = false;
  removeSender(sender) {
    this.pending.get(sender)?.controller.abort();
  }
  inspect(sender, id, trusted, choose) {
    const existing = this.pending.get(sender);
    if (existing) return existing.id === id ? existing.promise : Promise.reject(new Error("UNAVAILABLE"));
    if (this.pending.size >= 16) return Promise.reject(new Error("UNAVAILABLE"));
    const controller = new AbortController();
    const promise = (async () => {
      if (!trusted()) throw new Error("INVALID_SENDER");
      const file = await choose();
      if (controller.signal.aborted || !trusted()) throw new Error("INVALID_SENDER");
      if (!file) return { state: "cancelled" };
      if (this.workerActive) throw new Error("UNAVAILABLE");
      this.workerActive = true;
      try {
        const result = await this.preview(file, controller.signal);
        if (controller.signal.aborted || !trusted()) throw new Error("INVALID_SENDER");
        return { state: "preview", preview: result };
      } finally {
        this.workerActive = false;
      }
    })();
    const pending = { id, controller, promise };
    this.pending.set(sender, pending);
    void promise.finally(() => {
      if (this.pending.get(sender) === pending) this.pending.delete(sender);
    }).catch(() => {
    });
    return promise;
  }
};

// src/services/packs/fixed-reader.ts
import { Worker } from "node:worker_threads";

// src/services/packs/fixed-protocol.ts
import path from "node:path";

// src/shared/contracts/handshake.ts
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function exactObject(value, keys) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

// src/core/packs/fixed-preview.ts
var FIXED_PACK_SHA256 = "e4cf7d5607a70582cfcec200a381892a83c75e122f5be6bad926de23ff7278f2";
var FIXED_PACK_SIZE = 1355;
var FIXED_CONFIG_SHA256 = "9df1c49a83b3c3caf03c6fbb8abc44dda9d191e0fa01161aacff385174f900c3";
function fixedPackPreview(expandedBytes) {
  if (expandedBytes !== 889) throw new Error("INVALID_FIXED_SAMPLE");
  return {
    formatVersion: 1,
    status: "unknown",
    reason: "ENVIRONMENT_AND_MOD_NOT_VERIFIED",
    archive: { sha256: FIXED_PACK_SHA256, size: FIXED_PACK_SIZE, entries: 3, expandedBytes },
    target: { minecraft: "1.20.1", loader: "forge", loaderVersion: "47.4.28", javaMajor: 17, isolated: true },
    file: {
      projectId: "uXXizFIs",
      versionId: "DG5Fn9Sz",
      size: 123034,
      sha1: "417fb6ce8f52abf40bd9d0390371790f9576f8ba",
      sha512: "a1960a7c03dc32d4ccaccaf28afdd9b078758bbd62d15a91d4039a83fa9397a098e89b69591f6bd5190254d9ee97e502504154b9aec764adb8c65f000b75ba2c"
    },
    override: { path: "config/oucl-pe-smoke.properties", size: 14, sha256: FIXED_CONFIG_SHA256, layer: "client-overrides" }
  };
}

// src/services/packs/fixed-protocol.ts
function parseFixedPackRequest(value) {
  if (!exactObject(value, ["version", "kind", "file"]) || value.version !== 1 || value.kind !== "fixed-pack-preview" || typeof value.file !== "string" || !path.isAbsolute(value.file) || value.file.length > 32760) throw new Error("INVALID_MESSAGE");
  return value;
}
function parseFixedPackReply(value) {
  if (exactObject(value, ["version", "kind", "code"]) && value.version === 1 && value.kind === "fixed-pack-failed" && (value.code === "INVALID_SAMPLE" || value.code === "READ_FAILED" || value.code === "UNSAFE_PATH" || value.code === "WORKER_FAILED")) return value;
  if (!exactObject(value, ["version", "kind", "preview"]) || value.version !== 1 || value.kind !== "fixed-pack-result" || JSON.stringify(value.preview) !== JSON.stringify(fixedPackPreview(889))) throw new Error("INVALID_MESSAGE");
  return value;
}

// src/services/packs/fixed-reader.ts
var FixedPackReader = class {
  constructor(entry, timeoutMs = 12e4) {
    this.entry = entry;
    this.timeoutMs = timeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12e4) throw new Error("INVALID_TIMEOUT");
  }
  entry;
  timeoutMs;
  active = false;
  async preview(file, signal) {
    const request = parseFixedPackRequest({ version: 1, kind: "fixed-pack-preview", file });
    if (signal?.aborted) throw new Error("CANCELLED");
    if (this.active) throw new Error("QUEUE_FULL");
    this.active = true;
    try {
      const worker = new Worker(this.entry, { workerData: request, resourceLimits: { maxOldGenerationSizeMb: 128 } });
      return await new Promise((resolve, reject) => {
        let result;
        let failure;
        const stop = (code) => {
          failure ??= code;
          void worker.terminate().catch(() => {
          });
        };
        const abort = () => stop("CANCELLED");
        const timer = setTimeout(() => stop("TIMEOUT"), this.timeoutMs);
        worker.on("message", (message) => {
          if (result || failure) {
            stop("WORKER_FAILED");
            return;
          }
          try {
            const reply = parseFixedPackReply(message);
            if (reply.kind === "fixed-pack-failed") failure = reply.code;
            else result = reply.preview;
          } catch {
            stop("WORKER_FAILED");
          }
        });
        worker.once("error", () => {
          failure ??= "WORKER_FAILED";
        });
        worker.once("exit", (code) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          if (failure || code !== 0 || !result) reject(new Error(failure ?? "WORKER_FAILED"));
          else resolve(result);
        });
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
    } finally {
      this.active = false;
    }
  }
};

// src/shared/contracts/packs.ts
var ERRORS = {
  INVALID_ARGUMENT: { category: "validation", messageKey: "invalidArgument", retryable: false },
  INVALID_SENDER: { category: "permission", messageKey: "invalidSender", retryable: false },
  UNSUPPORTED_CONTRACT: { category: "validation", messageKey: "unsupportedContract", retryable: false },
  UNAVAILABLE: { category: "system", messageKey: "unavailable", retryable: true },
  TIMEOUT: { category: "system", messageKey: "timeout", retryable: true },
  FIXED_SAMPLE_MISMATCH: { category: "validation", messageKey: "packSampleMismatch", retryable: false },
  CANCELLED: { category: "cancelled", messageKey: "packCheckCancelled", retryable: true }
};
function packFailure(requestId, code, traceId) {
  return { contractVersion: 1, requestId, ok: false, error: { ...ERRORS[code], code, traceId } };
}
function isPackResult(value, requestId) {
  if (!exactObject(value, value && typeof value === "object" && "ok" in value && value.ok === true ? ["contractVersion", "requestId", "ok", "data"] : ["contractVersion", "requestId", "ok", "error"]) || value.contractVersion !== 1 || value.requestId !== requestId || !UUID_PATTERN.test(requestId)) return false;
  if (value.ok === true) {
    if (exactObject(value.data, ["state"]) && value.data.state === "cancelled") return true;
    return exactObject(value.data, ["state", "preview"]) && value.data.state === "preview" && JSON.stringify(value.data.preview) === JSON.stringify(fixedPackPreview(889));
  }
  if (value.ok !== false || !exactObject(value.error, ["category", "code", "messageKey", "retryable", "traceId"]) || typeof value.error.code !== "string" || !Object.hasOwn(ERRORS, value.error.code) || typeof value.error.traceId !== "string" || !UUID_PATTERN.test(value.error.traceId)) return false;
  const expected = ERRORS[value.error.code];
  return value.error.category === expected.category && value.error.messageKey === expected.messageKey && value.error.retryable === expected.retryable;
}

// src/ipc/packs.ts
async function handleFixedPack(input, trusted, trace, run) {
  const shape = exactObject(input, ["contractVersion", "requestId", "payload"]);
  const id = shape && typeof input.requestId === "string" && UUID_PATTERN.test(input.requestId) ? input.requestId : trace;
  if (!trusted) return packFailure(id, "INVALID_SENDER", trace);
  if (shape && typeof input.contractVersion === "number" && input.contractVersion > 1) return packFailure(id, "UNSUPPORTED_CONTRACT", trace);
  if (!shape || input.contractVersion !== 1 || input.requestId !== id || !exactObject(input.payload, [])) return packFailure(id, "INVALID_ARGUMENT", trace);
  try {
    const result = { contractVersion: 1, requestId: id, ok: true, data: await run(id) };
    return isPackResult(result, id) ? result : packFailure(id, "UNAVAILABLE", trace);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return packFailure(id, code === "INVALID_SAMPLE" ? "FIXED_SAMPLE_MISMATCH" : code === "CANCELLED" ? "CANCELLED" : code === "INVALID_SENDER" ? "INVALID_SENDER" : code === "TIMEOUT" ? "TIMEOUT" : "UNAVAILABLE", trace);
  }
}
export {
  FixedPackCoordinator,
  FixedPackReader,
  fixedPackPreview,
  handleFixedPack
};
