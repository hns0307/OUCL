var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// <stdin>
var stdin_exports = {};
__export(stdin_exports, {
  MaintenancePreviewJobs: () => MaintenancePreviewJobs,
  ModContractError: () => ModContractError,
  isMaintenanceDisplay: () => isMaintenanceDisplay,
  presentMaintenancePreview: () => presentMaintenancePreview
});
module.exports = __toCommonJS(stdin_exports);

// src/services/mods/maintenance-jobs.ts
var import_node_crypto = require("node:crypto");

// src/shared/contracts/handshake.ts
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function exactObject(value, keys) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

// src/shared/contracts/resources.ts
var resourceId = (x) => typeof x === "string" && /^[a-zA-Z0-9]{8}$/.test(x);

// src/core/path/layout.ts
var LayoutError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "LayoutError";
  }
  code;
  category = "validation";
};
function validateComponent(value) {
  if (value.length === 0 || value.length > 255 || value === "." || value === ".." || /[<>:"/\\|?*;]/.test(value) || /[. ]$/.test(value) || [...value].some((character) => character.charCodeAt(0) < 32) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) throw new LayoutError("INVALID_PATH");
  return value;
}

// src/shared/contracts/mods.ts
var MOD_CODES = [
  "INVALID_ARGUMENT",
  "UNSUPPORTED_CONTRACT",
  "INVALID_SENDER",
  "TIMEOUT",
  "UNAVAILABLE",
  "ROOT_UNAVAILABLE",
  "REVISION_CONFLICT",
  "FILES_CHANGED",
  "MOD_LIMIT",
  "MODS_UNSAFE",
  "SCAN_BUSY",
  "CANCELLED",
  "SCAN_FAILED",
  "TASK_NOT_FOUND",
  "NEEDS_RECOVERY",
  "CANCEL_TOO_LATE",
  "NETWORK_FAILED",
  "UNTRUSTED_METADATA",
  "NOT_FOUND",
  "RETRY_LATER",
  "PLATFORM_LIMIT",
  "CONFIRMATION_REQUIRED",
  "INSTANCE_BUSY",
  "MODS_INCOMPATIBLE",
  "MODS_UNDETERMINED"
];
var ModContractError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "ModContractError";
  }
  code;
};
var isModCode = (value) => typeof value === "string" && MOD_CODES.includes(value);

// src/shared/contracts/mod-maintenance-preview.ts
var uuid = (value) => typeof value === "string" && UUID_PATTERN.test(value);
var hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
var modId = (value) => typeof value === "string" && /^[a-z][a-z0-9_-]{1,63}$/.test(value);
var code = (value) => typeof value === "string" && /^[A-Z_]{1,64}$/.test(value);
var safe = (value, maximum) => typeof value === "string" && value.length > 0 && value.length <= maximum && /^[A-Za-z0-9 .+_*,<>=!|()[\]{}":-]+$/.test(value);
var nullable = (value, check) => value === null || check(value);
var depth = (value) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4;
function isMaintenanceDisplay(value) {
  if (!exactObject(value, [
    "rootId",
    "instanceId",
    "instanceRevision",
    "fingerprint",
    "fileId",
    "filename",
    "sha256",
    "action",
    "state",
    "providers",
    "directRequiredBy",
    "transitiveRequiredBy",
    "issues",
    "relations",
    "platformFailures",
    "incomplete"
  ]) || !uuid(value.rootId) || !uuid(value.instanceId) || typeof value.instanceRevision !== "number" || !Number.isSafeInteger(value.instanceRevision) || value.instanceRevision < 1 || !hash(value.fingerprint) || !hash(value.fileId) || typeof value.filename !== "string" || !/\.jar(?:\.disabled)?$/i.test(value.filename) || !nullable(value.sha256, hash) || value.action !== "enable" && value.action !== "disable" || !["ready", "blocked", "unknown"].includes(value.state) || typeof value.incomplete !== "boolean") return false;
  try {
    validateComponent(value.filename);
  } catch {
    return false;
  }
  if (value.action === "enable" !== value.filename.toLowerCase().endsWith(".disabled")) return false;
  const lists = [value.providers, value.directRequiredBy, value.transitiveRequiredBy, value.issues, value.relations, value.platformFailures];
  if (!lists.every(Array.isArray) || lists.reduce((sum, list) => sum + list.length, 0) > 512) return false;
  if (!value.providers.every((item) => exactObject(item, ["id", "ownerId", "version", "embeddedDepth"]) && modId(item.id) && modId(item.ownerId) && nullable(item.version, (v) => safe(v, 160)) && depth(item.embeddedDepth))) return false;
  if (!value.directRequiredBy.every(hash) || !value.transitiveRequiredBy.every(hash) || !value.platformFailures.every(code)) return false;
  if (!value.issues.every((item) => exactObject(item, [
    "moment",
    "scope",
    "severity",
    "code",
    "fileId",
    "modId",
    "dependencyModId",
    "dependencyProjectId",
    "dependencyVersionId",
    "requirement",
    "actual",
    "embeddedDepth"
  ]) && ["before", "after"].includes(item.moment) && ["local", "platform"].includes(item.scope) && ["error", "unknown", "warning"].includes(item.severity) && code(item.code) && (item.fileId === "" || hash(item.fileId)) && nullable(item.modId, modId) && nullable(item.dependencyModId, modId) && nullable(item.dependencyProjectId, resourceId) && nullable(item.dependencyVersionId, resourceId) && nullable(item.requirement, (v) => safe(v, 2048)) && Array.isArray(item.actual) && item.actual.length <= 16 && item.actual.every((v) => safe(v, 160)) && depth(item.embeddedDepth) && (item.scope === "local" ? item.dependencyProjectId === null && item.dependencyVersionId === null : item.modId === null && item.dependencyModId === null && item.requirement === null && item.actual.length === 0 && item.embeddedDepth === 0))) return false;
  if (!value.relations.every((item) => exactObject(item, [
    "scope",
    "dependentFileId",
    "providerFileId",
    "optional",
    "dependencyModId",
    "dependencyProjectId",
    "dependencyVersionId",
    "embeddedDepth"
  ]) && ["local", "platform"].includes(item.scope) && hash(item.dependentFileId) && hash(item.providerFileId) && typeof item.optional === "boolean" && nullable(item.dependencyModId, modId) && nullable(item.dependencyProjectId, resourceId) && nullable(item.dependencyVersionId, resourceId) && depth(item.embeddedDepth) && (item.scope === "local" ? item.dependencyModId !== null && item.dependencyProjectId === null && item.dependencyVersionId === null : item.dependencyModId === null && (item.dependencyProjectId !== null || item.dependencyVersionId !== null) && item.embeddedDepth === 0))) return false;
  if (value.state === "ready" && (value.incomplete || value.platformFailures.length || value.issues.some((issue) => issue.severity !== "warning"))) return false;
  return new TextEncoder().encode(JSON.stringify(value)).length <= 2 * 1024 ** 2;
}

// src/services/mods/maintenance-presentation.ts
var LIMIT = 512;
var modId2 = (value) => typeof value === "string" && /^[a-z][a-z0-9_-]{1,63}$/.test(value);
var fileId = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
var code2 = (value) => typeof value === "string" && /^[A-Z_]{1,64}$/.test(value);
var safeText = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max && /^[A-Za-z0-9 .+_*,<>=!|()[\]{}":-]+$/.test(value);
function presentMaintenancePreview(preview) {
  const { impact } = preview;
  let incomplete = impact.truncated;
  let budget = LIMIT;
  const take = () => {
    if (budget === 0) {
      incomplete = true;
      return false;
    }
    budget--;
    return true;
  };
  const filename = preview.filename;
  try {
    validateComponent(filename);
  } catch {
    throw new Error("INVALID_MAINTENANCE_PRESENTATION");
  }
  if (!/\.jar(?:\.disabled)?$/i.test(filename) || !fileId(impact.fileId) || !fileId(preview.fingerprint) || !UUID_PATTERN.test(preview.rootId) || !UUID_PATTERN.test(preview.instanceId) || !Number.isSafeInteger(preview.instanceRevision) || preview.instanceRevision < 1 || preview.sha256 !== null && !fileId(preview.sha256)) throw new Error("INVALID_MAINTENANCE_PRESENTATION");
  const providers = [];
  for (const provider of impact.affectedProviders) {
    if (!take()) break;
    if (!modId2(provider.id) || !modId2(provider.ownerId) || provider.via.length > 4) {
      incomplete = true;
      continue;
    }
    const version = provider.version === null || safeText(provider.version, 160) ? provider.version : null;
    if (version === null && provider.version !== null) incomplete = true;
    providers.push({ id: provider.id, ownerId: provider.ownerId, version, embeddedDepth: provider.via.length });
  }
  const issues = [];
  const appendIssue = (finding, moment) => {
    if (!take()) return;
    const issue = finding.issue;
    if (!code2(issue.code) || issue.fileId !== "" && !fileId(issue.fileId)) {
      incomplete = true;
      return;
    }
    if (finding.scope === "local" && "dependencyId" in issue) {
      const requirement = issue.expected === null ? null : typeof issue.expected === "string" ? issue.expected : JSON.stringify(issue.expected);
      const acceptedRequirement = requirement === null || safeText(requirement, 2048) ? requirement : null;
      const actual = issue.actual.filter((value) => safeText(value, 160)).slice(0, 16);
      const validMod = issue.modId === null || modId2(issue.modId);
      const validDependency = issue.dependencyId === null || modId2(issue.dependencyId);
      if (!validMod || !validDependency || requirement !== acceptedRequirement || actual.length !== issue.actual.length || issue.via.length > 4) incomplete = true;
      issues.push({
        moment,
        scope: "local",
        severity: issue.severity,
        code: issue.code,
        fileId: issue.fileId,
        modId: validMod ? issue.modId : null,
        dependencyModId: validDependency ? issue.dependencyId : null,
        dependencyProjectId: null,
        dependencyVersionId: null,
        requirement: acceptedRequirement,
        actual,
        embeddedDepth: Math.min(issue.via.length, 4)
      });
    } else if (finding.scope === "platform" && "dependencyProjectId" in issue) {
      const project = issue.dependencyProjectId === null || resourceId(issue.dependencyProjectId) ? issue.dependencyProjectId : null;
      const version = issue.dependencyVersionId === null || resourceId(issue.dependencyVersionId) ? issue.dependencyVersionId : null;
      if (project !== issue.dependencyProjectId || version !== issue.dependencyVersionId) incomplete = true;
      issues.push({
        moment,
        scope: "platform",
        severity: issue.severity,
        code: issue.code,
        fileId: issue.fileId,
        modId: null,
        dependencyModId: null,
        dependencyProjectId: project,
        dependencyVersionId: version,
        requirement: null,
        actual: [],
        embeddedDepth: 0
      });
    } else incomplete = true;
  };
  for (const issue of impact.before.local.issues) appendIssue({ scope: "local", issue }, "before");
  for (const issue of impact.before.platform.issues) appendIssue({ scope: "platform", issue }, "before");
  for (const issue of impact.after.local.issues) appendIssue({ scope: "local", issue }, "after");
  for (const issue of impact.after.platform.issues) appendIssue({ scope: "platform", issue }, "after");
  const relations = [];
  for (const relation of impact.relations) {
    if (!take()) break;
    if (!fileId(relation.dependentFileId) || !fileId(relation.providerFileId) || relation.via.length > 4) {
      incomplete = true;
      continue;
    }
    let dependencyModId = null;
    let dependencyProjectId = null;
    let dependencyVersionId = null;
    if (relation.scope === "local") {
      if (!modId2(relation.selector)) {
        incomplete = true;
        continue;
      }
      dependencyModId = relation.selector;
    } else {
      const parsed = parsePlatformSelector(relation);
      if (!parsed) {
        incomplete = true;
        continue;
      }
      dependencyProjectId = parsed.projectId;
      dependencyVersionId = parsed.versionId;
    }
    relations.push({
      scope: relation.scope,
      dependentFileId: relation.dependentFileId,
      providerFileId: relation.providerFileId,
      optional: relation.optional,
      dependencyModId,
      dependencyProjectId,
      dependencyVersionId,
      embeddedDepth: relation.via.length
    });
  }
  const validIds = (values) => {
    const result = [];
    for (const value of values) {
      if (!take()) break;
      if (result.length >= 256 || !fileId(value)) {
        incomplete = true;
        continue;
      }
      result.push(value);
    }
    return result;
  };
  const directRequiredBy = validIds(impact.directRequiredBy);
  const transitiveRequiredBy = validIds(impact.transitiveRequiredBy);
  const platformFailures = [];
  for (const failure of preview.platformFailures) {
    if (!take()) break;
    if (!code2(failure)) {
      incomplete = true;
      continue;
    }
    platformFailures.push(failure);
  }
  return {
    rootId: preview.rootId,
    instanceId: preview.instanceId,
    instanceRevision: preview.instanceRevision,
    fingerprint: preview.fingerprint,
    fileId: impact.fileId,
    filename,
    sha256: preview.sha256,
    action: impact.action,
    state: impact.state === "blocked" ? "blocked" : incomplete || platformFailures.length ? "unknown" : impact.state,
    providers,
    directRequiredBy,
    transitiveRequiredBy,
    issues,
    relations,
    platformFailures,
    incomplete
  };
}
function parsePlatformSelector(relation) {
  try {
    const value = JSON.parse(relation.selector);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
    const item = value;
    if (Object.keys(item).length !== 2 || !Object.hasOwn(item, "projectId") || !Object.hasOwn(item, "versionId") || item.projectId !== null && !resourceId(item.projectId) || item.versionId !== null && !resourceId(item.versionId) || item.projectId === null && item.versionId === null) return void 0;
    return { projectId: item.projectId, versionId: item.versionId };
  } catch {
    return void 0;
  }
}

// src/services/mods/maintenance-jobs.ts
var RETENTION_MS = 15 * 60 * 1e3;
var MaintenancePreviewJobs = class {
  constructor(service, now = () => performance.now()) {
    this.service = service;
    this.now = now;
  }
  service;
  now;
  jobs = /* @__PURE__ */ new Map();
  requests = /* @__PURE__ */ new Map();
  expired = /* @__PURE__ */ new Set();
  active;
  closed = false;
  prune() {
    const now = this.now();
    for (const [id, job] of this.jobs) if (job.finishedAt !== null && now - job.finishedAt >= RETENTION_MS) {
      if (this.expired.size >= 4096) continue;
      this.expired.add(job.requestId);
      this.jobs.delete(id);
      this.requests.delete(job.requestId);
    }
  }
  /** Idempotent admission, with no eviction of an unexpired observation. */
  start(requestId, input) {
    if (this.closed) throw new ModContractError("UNAVAILABLE");
    this.prune();
    const request = requestId.toLowerCase();
    const canonical = {
      rootId: input.rootId.toLowerCase(),
      instanceId: input.instanceId.toLowerCase(),
      expectedRevision: input.expectedRevision,
      expectedFingerprint: input.expectedFingerprint,
      fileId: input.fileId,
      action: input.action
    };
    if (this.expired.has(request)) throw new PreviewExpiredError();
    const prior = this.requests.get(request);
    if (prior) {
      const job2 = this.jobs.get(prior);
      if (job2.finishedAt !== null && this.now() - job2.finishedAt >= RETENTION_MS) throw new PreviewExpiredError();
      if (JSON.stringify(job2.input) !== JSON.stringify(canonical)) throw new ModContractError("INVALID_ARGUMENT");
      return { previewId: prior };
    }
    if (this.jobs.size >= 16 || this.expired.size >= 4096) throw new ModContractError("SCAN_BUSY");
    let finish;
    const done = new Promise((resolve) => {
      finish = resolve;
    });
    const job = {
      id: (0, import_node_crypto.randomUUID)(),
      requestId: request,
      input: structuredClone(canonical),
      status: "queued",
      result: null,
      errorCode: null,
      controller: new AbortController(),
      done,
      finish,
      finishedAt: null
    };
    this.jobs.set(job.id, job);
    this.requests.set(request, job.id);
    queueMicrotask(() => {
      this.pump();
    });
    return { previewId: job.id };
  }
  terminal(job, state) {
    job.status = state;
    job.finishedAt = this.now();
    job.finish();
  }
  pump() {
    if (this.closed || this.active) return;
    const job = [...this.jobs.values()].find((item) => item.status === "queued");
    if (!job) return;
    this.active = job;
    job.status = "running";
    void (async () => {
      try {
        const preview = await this.service.preview(job.input, job.controller.signal);
        if (job.controller.signal.aborted) this.terminal(job, "cancelled");
        else {
          const result = presentMaintenancePreview(preview);
          if (!isMaintenanceDisplay(result)) throw new ModContractError("MOD_LIMIT");
          job.result = result;
          this.terminal(job, "completed");
        }
      } catch (error) {
        if (job.controller.signal.aborted) this.terminal(job, "cancelled");
        else {
          job.errorCode = typeof error === "object" && error !== null && "code" in error && isModCode(error.code) ? error.code : "SCAN_FAILED";
          this.terminal(job, "failed");
        }
      } finally {
        this.active = void 0;
        this.pump();
      }
    })();
  }
  /** Unknown/expired IDs deliberately share the same error and reveal no other observation. */
  get(previewId) {
    this.prune();
    const job = this.jobs.get(previewId.toLowerCase());
    if (!job || job.finishedAt !== null && this.now() - job.finishedAt >= RETENTION_MS) throw new PreviewExpiredError();
    return structuredClone({ previewId: job.id, status: job.status, result: job.result, errorCode: job.errorCode });
  }
  /** Running cancellation waits until the scanner has actually exited. */
  async cancel(previewId) {
    this.prune();
    const job = this.jobs.get(previewId.toLowerCase());
    if (!job || job.finishedAt !== null && this.now() - job.finishedAt >= RETENTION_MS) throw new PreviewExpiredError();
    if (job.status === "queued") this.terminal(job, "cancelled");
    else if (job.status === "running") {
      job.controller.abort();
      await job.done;
    }
    return { previewId: job.id, status: job.status };
  }
  /** Drains in-flight observation work before dependencies shut down. */
  async close() {
    this.closed = true;
    for (const job of this.jobs.values()) {
      if (job.status === "queued") this.terminal(job, "cancelled");
      else if (job.status === "running") job.controller.abort();
    }
    await Promise.all([...this.jobs.values()].map((job) => job.done));
  }
};
var PreviewExpiredError = class extends Error {
  code = "PREVIEW_EXPIRED";
  constructor() {
    super("PREVIEW_EXPIRED");
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MaintenancePreviewJobs,
  ModContractError,
  isMaintenanceDisplay,
  presentMaintenancePreview
});
