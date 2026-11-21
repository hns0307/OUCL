var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// <stdin>
var stdin_exports = {};
__export(stdin_exports, {
  CatalogService: () => CatalogService,
  InstallMetadataService: () => InstallMetadataService,
  InstalledJavaFacts: () => InstalledJavaFacts,
  InstalledLanguageReader: () => InstalledLanguageReader,
  InstallerAdapter: () => InstallerAdapter,
  InstallerService: () => InstallerService,
  LoaderInstallMetadataService: () => LoaderInstallMetadataService,
  ModArchiveReader: () => ModArchiveReader,
  ModInspectionService: () => ModInspectionService,
  ModInventoryService: () => ModInventoryService,
  ModTaskService: () => ModTaskService,
  ModrinthModClient: () => ModrinthModClient,
  ProfileService: () => ProfileService,
  StorageClient: () => StorageClient,
  createDesktopFetch: () => createDesktopFetch,
  instanceGameLayout: () => instanceGameLayout,
  modInventoryContext: () => modInventoryContext,
  modZip: () => modZip,
  parseLoaderProfile: () => parseLoaderProfile,
  restoreInstallMetadata: () => restoreInstallMetadata
});
module.exports = __toCommonJS(stdin_exports);

// src/main/network.ts
var import_node_stream = require("node:stream");
function createDesktopFetch(createRequest) {
  return async (input, init) => {
    const original = input instanceof Request ? input : void 0;
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? original?.method ?? "GET").toUpperCase();
    if (url.protocol !== "https:" || url.username || url.password || !["GET", "HEAD", "POST"].includes(method) || init?.body !== void 0 && typeof init.body !== "string") throw new TypeError("NETWORK_REQUEST_REJECTED");
    const signal = init?.signal ?? original?.signal;
    signal?.throwIfAborted();
    const headers = new Headers(init?.headers ?? original?.headers);
    const redirect = init?.redirect ?? original?.redirect ?? "error";
    return new Promise((resolve, reject) => {
      const request = createRequest({ url: url.href, method, redirect: "manual", useSessionCookies: false, credentials: "omit" });
      let incoming;
      let settled = false;
      const clean = () => {
        signal?.removeEventListener("abort", abort);
      };
      const fail2 = (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };
      const abort = () => {
        const error = new DOMException("Request aborted", "AbortError");
        incoming?.destroy(error);
        request.abort();
        clean();
        fail2(error);
      };
      const responseHeaders = (values) => {
        const result2 = new Headers();
        for (const [key, value] of Object.entries(values)) for (const item of Array.isArray(value) ? value : [value]) result2.append(key, item);
        return result2;
      };
      request.on("error", () => {
        const error = new TypeError("NETWORK_REQUEST_FAILED");
        clean();
        incoming?.destroy(error);
        fail2(error);
      });
      request.on("login", (_info, callback) => {
        callback();
        request.abort();
        clean();
        fail2(new TypeError("NETWORK_AUTH_REJECTED"));
      });
      request.on("redirect", (status, _method, location, values) => {
        clean();
        if (redirect === "manual") {
          const headers2 = responseHeaders(values);
          headers2.set("location", location);
          settled = true;
          resolve(new Response(null, { status, headers: headers2 }));
        } else fail2(new TypeError("NETWORK_REDIRECT_REJECTED"));
        request.abort();
      });
      request.on("response", (response) => {
        incoming = response;
        const stream = incoming;
        stream.on("error", () => {
        });
        if (settled || signal?.aborted) {
          stream.destroy();
          request.abort();
          return;
        }
        stream.once("end", clean);
        stream.once("close", () => {
          clean();
          if (!stream.readableEnded) request.abort();
        });
        try {
          const noBody = method === "HEAD" || [204, 205, 304].includes(response.statusCode);
          const body = noBody ? null : import_node_stream.Readable.toWeb(stream);
          const result2 = new Response(body, { status: response.statusCode, headers: responseHeaders(response.headers) });
          Object.defineProperty(result2, "url", { value: url.href });
          settled = true;
          resolve(result2);
          if (noBody) stream.resume();
        } catch {
          request.abort();
          clean();
          fail2(new TypeError("NETWORK_RESPONSE_FAILED"));
        }
      });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      try {
        headers.forEach((value, name2) => request.setHeader(name2, value));
        if (typeof init?.body === "string") request.write(init.body);
        request.end();
      } catch {
        request.abort();
        clean();
        fail2(new TypeError("NETWORK_REQUEST_FAILED"));
      }
    });
  };
}

// src/services/loaders/install-metadata.ts
var import_node_crypto2 = require("node:crypto");

// src/services/network/backoff.ts
var import_promises = require("node:timers/promises");
async function retryDelay(attempt, signal, retryAfterMs = 0) {
  await (0, import_promises.setTimeout)(Math.max(250 * 2 ** attempt, retryAfterMs), void 0, { signal });
}

// src/core/version/validation.ts
var VersionError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "VersionError";
  }
  code;
  category = "validation";
};
function requireMetadata(condition) {
  if (!condition) throw new VersionError("INVALID_METADATA");
}
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function identifier(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 160 && /^[a-zA-Z0-9_.+ -]+$/.test(value) && value.trim() === value && ![".", ".."].includes(value);
}
function parseArtifact(value) {
  requireMetadata(record(value) && typeof value.url === "string" && value.url.length <= 2048 && typeof value.sha1 === "string" && /^[a-fA-F0-9]{40}$/.test(value.sha1) && typeof value.size === "number" && Number.isSafeInteger(value.size) && value.size >= 0);
  let url;
  try {
    url = new URL(value.url);
  } catch {
    throw new VersionError("INVALID_METADATA");
  }
  requireMetadata(url.protocol === "https:" && !url.username && !url.password);
  const result2 = { url: url.href, sha1: value.sha1.toLowerCase(), size: value.size };
  if (value.path !== void 0) {
    requireMetadata(typeof value.path === "string" && value.path.length <= 1024 && !/[\\:]/.test(value.path) && !value.path.includes(String.fromCharCode(0)) && value.path.split("/").every((part) => part.length > 0 && ![".", ".."].includes(part)));
    result2.path = value.path;
  }
  return result2;
}
function parseRules(value) {
  requireMetadata(Array.isArray(value) && value.length <= 64);
  return value.map((entry) => {
    requireMetadata(record(entry) && (entry.action === "allow" || entry.action === "disallow"));
    const result2 = { action: entry.action };
    if (entry.os !== void 0) {
      requireMetadata(record(entry.os));
      result2.os = {};
      for (const key of ["name", "arch", "version"]) {
        const field = entry.os[key];
        if (field !== void 0) {
          requireMetadata(typeof field === "string" && field.length <= 128);
          result2.os[key] = field;
        }
      }
    }
    if (entry.features !== void 0) {
      requireMetadata(record(entry.features) && Object.keys(entry.features).length <= 64);
      result2.features = {};
      for (const [key, flag] of Object.entries(entry.features)) {
        requireMetadata(/^[a-zA-Z0-9_]{1,80}$/.test(key) && typeof flag === "boolean");
        Object.defineProperty(result2.features, key, { value: flag, enumerable: true });
      }
    }
    return result2;
  });
}
function parseArguments(value) {
  requireMetadata(Array.isArray(value) && value.length <= 4096);
  return value.map((entry) => {
    if (typeof entry === "string") {
      requireMetadata(entry.length <= 8192);
      return entry;
    }
    requireMetadata(record(entry));
    const rules = parseRules(entry.rules);
    const raw = Array.isArray(entry.value) ? entry.value : [entry.value];
    requireMetadata(raw.length <= 64 && raw.every((item) => typeof item === "string" && item.length <= 8192));
    return { rules, value: raw };
  });
}
function parseLibrary(value) {
  requireMetadata(record(value) && typeof value.name === "string" && value.name.length <= 256 && /^[\w.-]+:[\w.-]+:[\w.+-]+(?::[\w.+-]+)?(?:@[\w.-]+)?$/.test(value.name));
  const result2 = { name: value.name };
  if (value.rules !== void 0) result2.rules = parseRules(value.rules);
  if (value.downloads !== void 0) {
    requireMetadata(record(value.downloads));
    result2.downloads = {};
    if (value.downloads.artifact !== void 0) result2.downloads.artifact = parseArtifact(value.downloads.artifact);
    if (value.downloads.classifiers !== void 0) {
      requireMetadata(record(value.downloads.classifiers) && Object.keys(value.downloads.classifiers).length <= 64);
      result2.downloads.classifiers = {};
      for (const [key, artifact] of Object.entries(value.downloads.classifiers)) {
        requireMetadata(identifier(key));
        result2.downloads.classifiers[key] = parseArtifact(artifact);
      }
    }
  }
  if (value.natives !== void 0) {
    requireMetadata(record(value.natives));
    result2.natives = {};
    for (const [os, classifier] of Object.entries(value.natives)) {
      requireMetadata(["windows", "linux", "osx"].includes(os) && typeof classifier === "string" && /^[\w${}.-]{1,160}$/.test(classifier));
      result2.natives[os] = classifier;
    }
  }
  if (value.extract !== void 0) {
    requireMetadata(record(value.extract) && Array.isArray(value.extract.exclude) && value.extract.exclude.length <= 64 && value.extract.exclude.every((item) => typeof item === "string" && item.length <= 512));
    result2.extract = { exclude: [...value.extract.exclude] };
  }
  return result2;
}
function parseClientVersion(value) {
  requireMetadata(record(value) && identifier(value.id));
  const result2 = { id: value.id };
  if (value.inheritsFrom !== void 0) {
    requireMetadata(identifier(value.inheritsFrom));
    result2.inheritsFrom = value.inheritsFrom;
  }
  for (const key of ["mainClass", "type", "assets", "minecraftArguments"]) {
    const field = value[key];
    if (field !== void 0) {
      requireMetadata(typeof field === "string" && field.length > 0 && field.length <= 32768);
      result2[key] = field;
    }
  }
  if (result2.mainClass !== void 0) requireMetadata(result2.mainClass.length <= 256 && /^[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*$/.test(result2.mainClass));
  if (result2.type !== void 0) requireMetadata(result2.type.length <= 64);
  if (result2.assets !== void 0) requireMetadata(identifier(result2.assets));
  if (value.javaVersion !== void 0) {
    requireMetadata(record(value.javaVersion) && Number.isSafeInteger(value.javaVersion.majorVersion) && typeof value.javaVersion.majorVersion === "number" && value.javaVersion.majorVersion > 0 && value.javaVersion.majorVersion <= 1e3);
    result2.javaVersion = { majorVersion: value.javaVersion.majorVersion };
  }
  if (value.downloads !== void 0) {
    requireMetadata(record(value.downloads));
    result2.downloads = {};
    if (value.downloads.client !== void 0) result2.downloads.client = parseArtifact(value.downloads.client);
  }
  if (value.assetIndex !== void 0) {
    requireMetadata(record(value.assetIndex) && identifier(value.assetIndex.id));
    result2.assetIndex = { ...parseArtifact(value.assetIndex), id: value.assetIndex.id };
  }
  if (value.libraries !== void 0) {
    requireMetadata(Array.isArray(value.libraries) && value.libraries.length <= 1e4);
    result2.libraries = value.libraries.map(parseLibrary);
  }
  if (value.arguments !== void 0) {
    requireMetadata(record(value.arguments));
    result2.arguments = {};
    for (const key of ["game", "jvm"]) if (value.arguments[key] !== void 0) result2.arguments[key] = parseArguments(value.arguments[key]);
    requireMetadata(!(value.minecraftArguments !== void 0 && value.arguments.game !== void 0));
  }
  return result2;
}

// src/core/version/manifest.ts
function isOfficialMetadataUrl(value) {
  try {
    const url = new URL(value);
    const descriptor = /^\/v1\/packages\/[a-f0-9]{40}\/([^/]+)\.json$/.exec(url.pathname);
    const knownPath = url.pathname === "/mc/game/version_manifest_v2.json" || descriptor !== null && identifier(decodeURIComponent(descriptor[1]));
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.search && !url.hash && ["piston-meta.mojang.com", "launchermeta.mojang.com"].includes(url.hostname) && knownPath;
  } catch {
    return false;
  }
}
function parseManifest(value) {
  requireMetadata(record(value) && Array.isArray(value.versions) && value.versions.length > 0 && value.versions.length <= 2e4);
  const seen = /* @__PURE__ */ new Set();
  return value.versions.map((item) => {
    requireMetadata(record(item) && identifier(item.id) && !seen.has(item.id) && typeof item.type === "string" && ["release", "snapshot", "old_alpha", "old_beta"].includes(item.type) && typeof item.url === "string" && item.url.length <= 2048 && isOfficialMetadataUrl(item.url) && typeof item.sha1 === "string" && /^[a-fA-F0-9]{40}$/.test(item.sha1) && typeof item.releaseTime === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(item.releaseTime) && Number.isFinite(Date.parse(item.releaseTime)));
    seen.add(item.id);
    return { id: item.id, type: item.type, url: item.url, sha1: item.sha1.toLowerCase(), releaseTime: new Date(item.releaseTime).toISOString() };
  });
}

// src/services/catalog/transport.ts
var CatalogError = class extends Error {
  constructor(code3, retryable = true) {
    super(code3);
    this.code = code3;
    this.retryable = retryable;
    this.name = "CatalogError";
  }
  code;
  retryable;
  category = "network";
};
var MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

// src/core/loaders/metadata.ts
var PROFILE_FACTS = {
  fabric: {
    idPrefix: "fabric-loader-",
    mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
    origins: /* @__PURE__ */ new Set(["https://maven.fabricmc.net"])
  },
  quilt: {
    idPrefix: "quilt-loader-",
    mainClass: "org.quiltmc.loader.impl.launch.knot.KnotClient",
    origins: /* @__PURE__ */ new Set(["https://maven.fabricmc.net", "https://maven.quiltmc.org"])
  }
};
function boundedText(value, maximum = 256) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && value.trim() === value;
}
function coordinatePath(coordinate2) {
  const [withoutExtension, extension = "jar"] = coordinate2.split("@");
  requireMetadata(withoutExtension !== void 0 && /^[\w.-]+$/.test(extension));
  const parts = withoutExtension.split(":");
  requireMetadata(parts.length === 3 || parts.length === 4);
  const [group, artifact, version3, classifier] = parts;
  requireMetadata(group !== void 0 && artifact !== void 0 && version3 !== void 0 && [group, artifact, version3, classifier].filter((part) => part !== void 0).every((part) => /^[\w.+-]+$/.test(part)));
  const suffix = classifier === void 0 ? "" : `-${classifier}`;
  return `${group.replaceAll(".", "/")}/${artifact}/${version3}/${artifact}-${version3}${suffix}.${extension}`;
}
function parseLibrary2(kind, value, rules) {
  requireMetadata(record(value) && boundedText(value.name));
  const path27 = coordinatePath(value.name);
  requireMetadata(typeof value.url === "string" && value.url.length <= 2048);
  let base;
  try {
    base = new URL(value.url);
  } catch {
    throw new VersionError("INVALID_METADATA");
  }
  requireMetadata(base.protocol === "https:" && !base.username && !base.password && !base.search && !base.hash && PROFILE_FACTS[kind].origins.has(base.origin));
  const baseUrl = base.href.endsWith("/") ? base.href : `${base.href}/`;
  const result2 = {
    coordinate: value.name,
    path: path27,
    url: new URL(path27, baseUrl).href,
    proof: "official-sidecar-required"
  };
  if (rules !== void 0) result2.rules = rules;
  const hasSha1 = value.sha1 !== void 0;
  const hasSize = value.size !== void 0;
  requireMetadata(hasSha1 === hasSize);
  if (hasSha1) {
    requireMetadata(typeof value.sha1 === "string" && /^[a-fA-F0-9]{40}$/.test(value.sha1) && typeof value.size === "number" && Number.isSafeInteger(value.size) && value.size >= 0);
    result2.sha1 = value.sha1.toLowerCase();
    result2.size = value.size;
    result2.proof = "inline-sha1";
  }
  return result2;
}
function parseLoaderProfile(kind, minecraftVersion, loaderVersion, value) {
  requireMetadata(identifier(minecraftVersion) && identifier(loaderVersion) && record(value));
  const client2 = parseClientVersion(value);
  const facts = PROFILE_FACTS[kind];
  requireMetadata(client2.id === `${facts.idPrefix}${loaderVersion}-${minecraftVersion}` && client2.inheritsFrom === minecraftVersion && client2.mainClass === facts.mainClass && client2.minecraftArguments === void 0 && client2.downloads === void 0 && client2.assetIndex === void 0 && client2.javaVersion === void 0 && Array.isArray(value.libraries) && value.libraries.length <= 256);
  const game = client2.arguments?.game ?? [];
  const jvm = client2.arguments?.jvm ?? [];
  const libraries = value.libraries.map((entry, index) => {
    const parsed = client2.libraries?.[index];
    requireMetadata(parsed !== void 0 && parsed.name === (record(entry) ? entry.name : void 0) && parsed.downloads === void 0 && parsed.natives === void 0 && parsed.extract === void 0);
    return parseLibrary2(kind, entry, parsed.rules);
  });
  requireMetadata(new Set(libraries.map((library2) => library2.coordinate)).size === libraries.length && new Set(libraries.map((library2) => library2.path)).size === libraries.length);
  return {
    kind,
    minecraftVersion,
    loaderVersion,
    id: client2.id,
    mainClass: client2.mainClass,
    arguments: { game, jvm },
    libraries
  };
}

// src/shared/contracts/handshake.ts
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function exactObject(value, keys2) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === keys2.length && keys2.every((key) => Object.hasOwn(value, key));
}

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
function normalizeDataDirectory(input) {
  const match = /^([a-zA-Z]):[\\/](.*)$/.exec(input);
  if (!match || input.length > 32760) throw new LayoutError("INVALID_PATH");
  const parts = (match[2] ?? "").split(/[\\/]+/).filter(Boolean).map(validateComponent);
  return `${(match[1] ?? "").toUpperCase()}:\\${parts.join("\\")}`;
}
function childPath(root, relative) {
  if (relative.startsWith("/") || relative.startsWith("\\") || relative.includes(":")) throw new LayoutError("ROOT_ESCAPE");
  const parts = relative.split(/[\\/]/).map(validateComponent);
  const base = normalizeDataDirectory(root);
  const output = `${base.endsWith("\\") ? base : base + "\\"}${parts.join("\\")}`;
  if (output.length > 32760) throw new LayoutError("INVALID_PATH");
  return output;
}
function isolationPolicy(settings) {
  return { isolated: settings.pack || (settings.instance === "inherit" ? settings.globalDefault : settings.instance === "on"), forced: settings.pack };
}
function managedId(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.+-]{0,159}$/.test(value)) throw new LayoutError("INVALID_ID");
  return validateComponent(value);
}
function planGameLayout(input) {
  if (!UUID_PATTERN.test(input.rootId) || !UUID_PATTERN.test(input.instanceId)) throw new LayoutError("INVALID_ID");
  managedId(input.mcVersionId);
  const dataDirectory = normalizeDataDirectory(input.dataDirectory);
  const gameRoot = childPath(dataDirectory, `roots/${input.rootId}/.minecraft`);
  const versionDirectory = childPath(gameRoot, `versions/${managedId(input.directoryId)}`);
  const record3 = managedId(input.versionRecordId);
  const jar = childPath(gameRoot, `versions/${managedId(input.jar.directoryId)}/${managedId(input.jar.versionRecordId)}.jar`);
  const isolation2 = isolationPolicy(input.isolation);
  return {
    rootId: input.rootId,
    instanceId: input.instanceId,
    mcVersionId: input.mcVersionId,
    isolated: isolation2.isolated,
    forcedIsolation: isolation2.forced,
    dataDirectory,
    storeDirectory: childPath(dataDirectory, "store"),
    gameRoot,
    versionDirectory,
    gameDirectory: isolation2.isolated ? versionDirectory : gameRoot,
    assetsDirectory: childPath(gameRoot, "assets"),
    librariesDirectory: childPath(gameRoot, "libraries"),
    nativesDirectory: childPath(versionDirectory, "natives"),
    versionJson: childPath(versionDirectory, `${record3}.json`),
    instanceJson: childPath(versionDirectory, "oucl.instance.json"),
    localJar: childPath(versionDirectory, `${record3}.jar`),
    jar
  };
}

// src/core/install/assets.ts
var InstallPlanError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "InstallPlanError";
  }
  code;
  category = "validation";
};
function installRelativePath(value) {
  try {
    if (value.length === 0 || value.length > 1024 || value.includes("\\")) throw new InstallPlanError("INVALID_INSTALL_PATH");
    value.split("/").forEach(validateComponent);
    return value;
  } catch {
    throw new InstallPlanError("INVALID_INSTALL_PATH");
  }
}
function parseAssetIndex(value) {
  if (!record(value) || !record(value.objects) || Object.keys(value.objects).length > 1e5 || value.virtual !== void 0 && typeof value.virtual !== "boolean" || value.map_to_resources !== void 0 && typeof value.map_to_resources !== "boolean") throw new InstallPlanError("INVALID_ASSET_INDEX");
  const names = /* @__PURE__ */ new Set();
  const sizes = /* @__PURE__ */ new Map();
  const objects2 = [];
  for (const [name2, entry] of Object.entries(value.objects)) {
    installRelativePath(name2);
    const folded = name2.toLowerCase();
    if (names.has(folded) || !record(entry) || !Object.hasOwn(entry, "hash") || !Object.hasOwn(entry, "size") || typeof entry.hash !== "string" || !/^[a-fA-F0-9]{40}$/.test(entry.hash) || typeof entry.size !== "number" || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 64 * 1024 ** 3) throw new InstallPlanError("INVALID_ASSET_INDEX");
    const sha1 = entry.hash.toLowerCase();
    if (sizes.has(sha1) && sizes.get(sha1) !== entry.size) throw new InstallPlanError("ARTIFACT_CONFLICT");
    names.add(folded);
    sizes.set(sha1, entry.size);
    objects2.push({ name: name2, sha1, size: entry.size });
  }
  for (const object4 of objects2) {
    const parts = object4.name.toLowerCase().split("/");
    parts.pop();
    while (parts.length) {
      if (names.has(parts.join("/"))) throw new InstallPlanError("INVALID_ASSET_INDEX");
      parts.pop();
    }
  }
  return { objects: objects2, virtual: value.virtual ?? false, mapToResources: value.map_to_resources ?? false };
}

// src/core/install/plan.ts
function artifactProofKey(value) {
  return `${value.sha1.toLowerCase()}
${value.url}`;
}
function component(value) {
  try {
    return validateComponent(value);
  } catch {
    throw new InstallPlanError("INVALID_INSTALL_PATH");
  }
}
function assetIndexAlias(version3) {
  const index = version3.assetIndex;
  if (!index || !/^[a-f0-9]{40}$/i.test(index.sha1)) throw new InstallPlanError("ASSET_INDEX_REQUIRED");
  return component(`${component(index.id)}-${index.sha1.toLowerCase()}`);
}
function aliasAssetViews(plan, version3) {
  const index = version3.assetIndex;
  if (!index) throw new InstallPlanError("ASSET_INDEX_REQUIRED");
  const oldId = component(index.id);
  const alias = assetIndexAlias(version3);
  const oldPath = `indexes/${oldId}.json`;
  const oldPrefix = `virtual/${oldId}/`;
  const matches = plan.views.filter((view) => view.area === "assets" && view.path === oldPath);
  if (matches.length !== 1 || matches[0]?.artifactId !== `sha1-${index.sha1.toLowerCase()}`) throw new InstallPlanError("VIEW_CONFLICT");
  const views = plan.views.map((view) => view.area !== "assets" ? view : view.path === oldPath ? { ...view, path: `indexes/${alias}.json` } : view.path.startsWith(oldPrefix) ? { ...view, path: `virtual/${alias}/${view.path.slice(oldPrefix.length)}` } : view);
  const names = /* @__PURE__ */ new Set();
  for (const view of views) {
    const key = `${view.area}:${installRelativePath(view.path).toLowerCase()}`;
    if (names.has(key)) throw new InstallPlanError("VIEW_CONFLICT");
    names.add(key);
  }
  return { ...plan, views };
}
function coordinate(name2, overrideClassifier) {
  if (!/^[\w.-]+:[\w.-]+:[\w.+-]+(?::[\w.+-]+)?(?:@[\w.-]+)?$/.test(name2) || name2.length > 256) throw new InstallPlanError("INVALID_LIBRARY");
  const [body = "", extension = "jar"] = name2.split("@");
  const [group = "", artifact = "", version3 = "", classifier = ""] = body.split(":");
  const selected = overrideClassifier ?? classifier;
  const directories = group.split(".").map(component).join("/");
  const file = `${artifact}-${version3}${selected ? "-" + component(selected) : ""}.${component(extension)}`;
  return { path: installRelativePath(`${directories}/${component(artifact)}/${component(version3)}/${component(file)}`), classifier };
}
function exclusions(values) {
  if (values.length > 64) throw new InstallPlanError("INSTALL_LIMIT");
  return [...new Set(["META-INF/", ...values].map((value) => {
    installRelativePath(value.endsWith("/") ? value.slice(0, -1) : value);
    return value;
  }))].sort();
}
function windowsX64Native(classifier) {
  return ["natives-windows", "natives-windows-x64", "natives-windows-x86_64", "natives-windows-64"].includes(classifier);
}
function planVanillaInstall(version3, metadataProofByVersion, assets, artifactProofs = {}) {
  if (!version3.assetIndex) throw new InstallPlanError("ASSET_INDEX_REQUIRED");
  if (version3.libraries.length > 1e4 || assets.objects.length > 1e5) throw new InstallPlanError("INSTALL_LIMIT");
  const artifacts = /* @__PURE__ */ new Map();
  const addresses = /* @__PURE__ */ new Map();
  const views = /* @__PURE__ */ new Map();
  const directories = /* @__PURE__ */ new Set();
  const natives = /* @__PURE__ */ new Map();
  const classpath = /* @__PURE__ */ new Set();
  let totalBytes = 0;
  const canonicalSource = (raw) => {
    if (typeof raw === "string") {
      if (!/^[a-fA-F0-9]{40}$/.test(raw)) throw new InstallPlanError("MISSING_METADATA_PROOF");
      return { kind: "mojang-version", algorithm: "sha1", digest: raw.toLowerCase() };
    }
    if (!raw || !["mojang-version", "mojang-assets", "loader-profile", "loader-maven"].includes(raw.kind) || !["sha1", "sha256"].includes(raw.algorithm) || !new RegExp(`^[a-fA-F0-9]{${raw.algorithm === "sha1" ? 40 : 64}}$`).test(raw.digest)) {
      throw new InstallPlanError("MISSING_METADATA_PROOF");
    }
    return { kind: raw.kind, algorithm: raw.algorithm, digest: raw.digest.toLowerCase() };
  };
  const sources = (id2, value) => {
    const overrides = artifactProofs[artifactProofKey(value)];
    if (overrides !== void 0) {
      if (overrides.length < 1 || overrides.length > 16) throw new InstallPlanError("MISSING_METADATA_PROOF");
      return overrides.map(canonicalSource);
    }
    if (id2 === void 0 || !version3.ancestry.includes(id2) || !Object.hasOwn(metadataProofByVersion, id2)) throw new InstallPlanError("MISSING_METADATA_PROOF");
    return [canonicalSource(metadataProofByVersion[id2])];
  };
  const artifact = (raw, origins) => {
    let value;
    try {
      value = parseArtifact(raw);
    } catch {
      throw new InstallPlanError("INVALID_ARTIFACT");
    }
    if (value.size > 64 * 1024 ** 3) throw new InstallPlanError("INSTALL_LIMIT");
    const artifactId = `sha1-${value.sha1}`;
    const proofs = origins.map((origin) => ({
      source: origin,
      provenanceId: `${origin.kind === "mojang-assets" ? "asset" : origin.kind.startsWith("loader-") ? "loader" : "version"}:${origin.digest}:${value.sha1}`
    }));
    const proof = proofs[0];
    if (!proof) throw new InstallPlanError("MISSING_METADATA_PROOF");
    const existing = artifacts.get(artifactId);
    const atAddress = addresses.get(value.url);
    if (atAddress !== void 0 && atAddress !== artifactId || existing && existing.size !== value.size) throw new InstallPlanError("ARTIFACT_CONFLICT");
    addresses.set(value.url, artifactId);
    if (existing) {
      if (existing.url !== value.url && !existing.alternateUrls.includes(value.url)) existing.alternateUrls.push(value.url);
      for (const candidate of proofs) if (!existing.proofs.some((entry) => entry.provenanceId === candidate.provenanceId)) existing.proofs.push(candidate);
    } else {
      artifacts.set(artifactId, { artifactId, url: value.url, sha1: value.sha1, size: value.size, ...proof, proofs, alternateUrls: [] });
      totalBytes += value.size;
      if (!Number.isSafeInteger(totalBytes)) throw new InstallPlanError("INSTALL_LIMIT");
    }
    return artifactId;
  };
  const view = (area, path27, artifactId) => {
    const name2 = installRelativePath(path27);
    const key = `${area}:${name2.toLowerCase()}`;
    const previous = views.get(key);
    if (previous) {
      if (previous.artifactId !== artifactId || previous.path !== name2) throw new InstallPlanError("VIEW_CONFLICT");
      return previous.path;
    }
    if (directories.has(key)) throw new InstallPlanError("VIEW_CONFLICT");
    const parts = name2.toLowerCase().split("/");
    parts.pop();
    while (parts.length) {
      const prefix = `${area}:${parts.join("/")}`;
      if (views.has(prefix)) throw new InstallPlanError("VIEW_CONFLICT");
      directories.add(prefix);
      parts.pop();
    }
    views.set(key, { area, path: name2, artifactId });
    return name2;
  };
  const native = (artifactId, archivePath, exclude) => {
    const entry = { artifactId, archivePath, exclude: exclusions(exclude) };
    const previous = natives.get(archivePath);
    if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) throw new InstallPlanError("ARTIFACT_CONFLICT");
    natives.set(archivePath, entry);
  };
  view("version", "client.jar", artifact(version3.client, sources(version3.jarVersionId, version3.client)));
  const assetIndexId = component(version3.assetIndex.id);
  view("assets", `indexes/${assetIndexId}.json`, artifact(version3.assetIndex, sources(version3.assetIndexVersionId, version3.assetIndex)));
  for (const library2 of version3.libraries) {
    const identity3 = coordinate(library2.name);
    if (library2.artifact) {
      const id2 = artifact(library2.artifact, sources(library2.sourceVersionId, library2.artifact));
      const path27 = view("libraries", library2.artifact.path ?? identity3.path, id2);
      classpath.add(path27);
      if (windowsX64Native(identity3.classifier)) native(id2, path27, library2.nativeExcludes);
    }
    if (library2.native) {
      if (!library2.nativeClassifier) throw new InstallPlanError("INVALID_LIBRARY");
      const path27 = library2.native.path ?? coordinate(library2.name, library2.nativeClassifier).path;
      const id2 = artifact(library2.native, sources(library2.sourceVersionId, library2.native));
      view("libraries", path27, id2);
      native(id2, path27, library2.nativeExcludes);
    }
    if (!library2.artifact && !library2.native) throw new InstallPlanError("INVALID_LIBRARY");
  }
  for (const object4 of assets.objects) {
    const id2 = artifact(
      { url: `https://resources.download.minecraft.net/${object4.sha1.slice(0, 2)}/${object4.sha1}`, sha1: object4.sha1, size: object4.size },
      [{ kind: "mojang-assets", algorithm: "sha1", digest: version3.assetIndex.sha1.toLowerCase() }]
    );
    view("assets", `objects/${object4.sha1.slice(0, 2)}/${object4.sha1}`, id2);
    if (assets.virtual) view("assets", `virtual/${assetIndexId}/${object4.name}`, id2);
    if (assets.mapToResources) view("resources", object4.name, id2);
  }
  return { artifacts: [...artifacts.values()], views: [...views.values()], natives: [...natives.values()], classpath: [...classpath], totalBytes };
}

// src/core/version/arguments.ts
function patternMatches(pattern, value) {
  if (pattern.length > 128 || value.length > 128 || /\\[1-9]|\)[*+{]/.test(pattern) || (pattern.match(/[*+{]/g)?.length ?? 0) > 2) throw new VersionError("INVALID_RULE_PATTERN");
  try {
    return new RegExp(pattern).test(value);
  } catch {
    throw new VersionError("INVALID_RULE_PATTERN");
  }
}
function rulesAllow(rules, environment2) {
  if (!rules) return true;
  let allowed = false;
  for (const rule of rules) {
    if (rule.os?.name !== void 0 && rule.os.name !== environment2.os) continue;
    if (rule.os?.arch !== void 0 && !patternMatches(rule.os.arch, environment2.arch)) continue;
    if (rule.os?.version !== void 0 && !patternMatches(rule.os.version, environment2.osVersion)) continue;
    if (rule.features && Object.entries(rule.features).some(([name2, expected]) => (Object.hasOwn(environment2.features, name2) ? environment2.features[name2] : false) !== expected)) continue;
    allowed = rule.action === "allow";
  }
  return allowed;
}
function selectArguments(argumentsList, environment2) {
  return argumentsList.flatMap((entry) => typeof entry === "string" ? [entry] : rulesAllow(entry.rules, environment2) ? typeof entry.value === "string" ? [entry.value] : [...entry.value] : []);
}
function tokenizeLegacyArguments(input) {
  requireMetadata(input.length <= 32768);
  const output = [];
  let token = "";
  let quote;
  let started = false;
  for (let index = 0; index < input.length; index++) {
    const character = input[index] ?? "";
    if (character === "\\" && quote !== void 0 && input[index + 1] === quote) {
      token += quote;
      index++;
      started = true;
    } else if (character === '"' || character === "'") {
      if (quote === character) quote = void 0;
      else if (quote === void 0) quote = character;
      else token += character;
      started = true;
    } else if (/\s/.test(character) && quote === void 0) {
      if (started) {
        output.push(token);
        token = "";
        started = false;
      }
    } else {
      token += character;
      started = true;
    }
  }
  if (quote !== void 0) throw new VersionError("INVALID_LEGACY_ARGUMENTS");
  if (started) output.push(token);
  requireMetadata(output.length <= 4096);
  return output;
}

// src/core/version/resolve.ts
function libraryIdentity(name2) {
  const [coordinate2 = "", extension = "jar"] = name2.split("@");
  const [group = "", artifact = "", , classifier = ""] = coordinate2.split(":");
  return `${group}:${artifact}:${classifier}@${extension}`;
}
function resolveClientVersion(targetId, documents, environment2) {
  requireMetadata(identifier(targetId));
  const chain = [];
  const seen = /* @__PURE__ */ new Set();
  let next = targetId;
  while (next !== void 0) {
    if (seen.has(next)) throw new VersionError("CIRCULAR_INHERITANCE");
    if (chain.length >= 32) throw new VersionError("INHERITANCE_LIMIT");
    if (!Object.hasOwn(documents, next)) throw new VersionError("MISSING_PARENT");
    const version3 = parseClientVersion(documents[next]);
    requireMetadata(version3.id === next);
    seen.add(next);
    chain.push(version3);
    next = version3.inheritsFrom;
  }
  chain.reverse();
  let mainClass;
  let type = "release";
  let javaMajor = 8;
  let client2;
  let jarVersionId = "";
  let assetIndex;
  let assets;
  const libraries = /* @__PURE__ */ new Map();
  let gameArguments = [];
  const jvmArguments = [];
  for (const version3 of chain) {
    if (version3.mainClass !== void 0) mainClass = version3.mainClass;
    if (version3.type !== void 0) type = version3.type;
    if (version3.javaVersion !== void 0) javaMajor = version3.javaVersion.majorVersion;
    if (version3.downloads?.client) {
      client2 = version3.downloads.client;
      jarVersionId = version3.id;
    }
    if (version3.assetIndex) assetIndex = { value: version3.assetIndex, sourceVersionId: version3.id };
    if (version3.assets !== void 0) assets = version3.assets;
    for (const library2 of version3.libraries ?? []) libraries.set(libraryIdentity(library2.name), { library: library2, sourceVersionId: version3.id });
    requireMetadata(libraries.size <= 1e4);
    if (version3.minecraftArguments !== void 0) gameArguments = tokenizeLegacyArguments(version3.minecraftArguments);
    gameArguments.push(...selectArguments(version3.arguments?.game ?? [], environment2));
    jvmArguments.push(...selectArguments(version3.arguments?.jvm ?? [], environment2));
    requireMetadata(gameArguments.length <= 4096 && jvmArguments.length <= 4096);
  }
  if (!client2) throw new VersionError("CLIENT_NOT_FOUND");
  if (!mainClass) throw new VersionError("MAIN_CLASS_MISSING");
  const selected = [];
  for (const { library: library2, sourceVersionId } of libraries.values()) {
    if (!rulesAllow(library2.rules, environment2)) continue;
    const resolved = { name: library2.name, sourceVersionId, nativeExcludes: [...library2.extract?.exclude ?? []] };
    if (library2.downloads?.artifact) resolved.artifact = library2.downloads.artifact;
    const nativeTemplate = library2.natives?.[environment2.os];
    if (nativeTemplate !== void 0) {
      const classifier = nativeTemplate.replace(/\$\{arch\}/g, environment2.arch === "x86" ? "32" : "64");
      const native = library2.downloads?.classifiers?.[classifier];
      if (!native || classifier.includes("${")) throw new VersionError("NATIVE_NOT_FOUND");
      resolved.native = native;
      resolved.nativeClassifier = classifier;
    }
    selected.push(resolved);
  }
  const result2 = {
    id: targetId,
    ancestry: chain.map((version3) => version3.id),
    mainClass,
    type,
    javaMajor,
    client: client2,
    jarVersionId,
    libraries: selected,
    gameArguments,
    jvmArguments
  };
  if (assetIndex !== void 0) {
    result2.assetIndex = assetIndex.value;
    result2.assetIndexVersionId = assetIndex.sourceVersionId;
  }
  if (assets !== void 0) result2.assets = assets;
  return result2;
}

// src/services/loaders/compose.ts
function composeLoaderInstall(input) {
  if (!Object.hasOwn(input.baseVersionDocuments, input.profile.minecraftVersion)) throw new Error("INVALID_LOADER_BASE");
  if (!/^[a-f0-9]{64}$/.test(input.profileSha256) || input.libraries.libraries.length !== input.profile.libraries.length) throw new Error("INVALID_LOADER_PROOF");
  const downloads = new Map(input.libraries.libraries.map((item) => [item.path, item.spec]));
  const artifactProofs = {};
  const descriptor = {
    id: input.profile.id,
    inheritsFrom: input.profile.minecraftVersion,
    mainClass: input.profile.mainClass,
    arguments: input.profile.arguments,
    libraries: input.profile.libraries.map((library2) => {
      const selected = downloads.get(library2.path);
      if (!selected || selected.url !== library2.url || selected.expected.algorithm !== "sha1" || selected.anchor.kind !== "loader-profile" && selected.anchor.kind !== "loader-maven" || selected.anchor.algorithm !== "sha256") throw new Error("INVALID_LOADER_LIBRARY");
      const artifact = { url: selected.url, sha1: selected.expected.digest, size: selected.expected.size, path: library2.path };
      const key = artifactProofKey(artifact);
      const proof2 = { kind: selected.anchor.kind, algorithm: "sha256", digest: selected.anchor.digest };
      const entries = artifactProofs[key] ??= [];
      if (!entries.some((entry) => entry.kind === proof2.kind && entry.digest === proof2.digest)) entries.push(proof2);
      return { name: library2.coordinate, downloads: { artifact }, ...library2.rules === void 0 ? {} : { rules: library2.rules } };
    })
  };
  const documents = Object.fromEntries(Object.entries(input.baseVersionDocuments).map(([id2, body]) => {
    try {
      return [id2, JSON.parse(body)];
    } catch {
      throw new Error("INVALID_LOADER_BASE");
    }
  }));
  if (Object.hasOwn(documents, descriptor.id)) throw new Error("INVALID_LOADER_BASE");
  documents[descriptor.id] = descriptor;
  const version3 = resolveClientVersion(descriptor.id, documents, input.environment);
  const proof = {
    ...input.baseMetadataSha1ByVersion,
    [descriptor.id]: { kind: "loader-profile", algorithm: "sha256", digest: input.profileSha256 }
  };
  return { version: version3, plan: planVanillaInstall(version3, proof, input.assets, artifactProofs), loaderDocument: JSON.stringify(descriptor), metadataProofByVersion: proof };
}

// src/services/objects/provenance.ts
var import_node_crypto = require("node:crypto");
var ObjectError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "ObjectError";
    this.category = code3 === "INVALID_ARTIFACT" ? "validation" : code3 === "HASH_MISMATCH" ? "network" : code3 === "STORE_BUSY" ? "biz" : "disk";
  }
  code;
  category;
};
function record2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value, names) {
  return Object.keys(value).sort().join(",") === names.sort().join(",");
}
var hex = (value, size) => typeof value === "string" && value.length === size && /^[a-fA-F0-9]+$/.test(value);
function definition(expected, anchor) {
  if (!record2(expected) || !keys(expected, ["algorithm", "digest", "size", "provenanceId"]) || typeof expected.algorithm !== "string" || !["sha1", "sha256"].includes(expected.algorithm) || !hex(expected.digest, expected.algorithm === "sha1" ? 40 : 64) || typeof expected.size !== "number" || !Number.isSafeInteger(expected.size) || expected.size < 0 || expected.size > 64 * 1024 ** 3 || typeof expected.provenanceId !== "string" || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(expected.provenanceId) || !record2(anchor) || !keys(anchor, ["kind", "algorithm", "digest"]) || typeof anchor.kind !== "string" || !["mojang-version", "mojang-assets", "mojang-runtime", "adoptium-runtime", "modrinth-version", "loader-profile", "loader-maven"].includes(anchor.kind) || typeof anchor.algorithm !== "string" || !["sha1", "sha256"].includes(anchor.algorithm) || !hex(anchor.digest, anchor.algorithm === "sha1" ? 40 : 64)) throw new ObjectError("INVALID_ARTIFACT");
  return {
    expected: { algorithm: expected.algorithm, digest: expected.digest.toLowerCase(), size: expected.size, provenanceId: expected.provenanceId },
    anchor: { kind: anchor.kind, algorithm: anchor.algorithm, digest: anchor.digest.toLowerCase() }
  };
}
function sourceKey(expected, anchor) {
  return (0, import_node_crypto.createHash)("sha256").update(JSON.stringify(definition(expected, anchor))).digest("hex");
}
function parseProvenance(bytes) {
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (!record2(value) || !keys(value, ["schemaVersion", "objectDigest", "expected", "anchor"]) || value.schemaVersion !== 1 || !hex(value.objectDigest, 64)) throw new ObjectError("NEEDS_RECOVERY");
    return { schemaVersion: 1, objectDigest: value.objectDigest.toLowerCase(), ...definition(value.expected, value.anchor) };
  } catch {
    throw new ObjectError("NEEDS_RECOVERY");
  }
}

// src/services/download/types.ts
var DownloadError = class extends Error {
  constructor(code3, retryAfterMs) {
    super(code3);
    this.code = code3;
    this.retryAfterMs = retryAfterMs;
    this.name = "DownloadError";
    this.category = code3 === "INVALID_TRANSFER" ? "validation" : code3 === "CANCELLED" ? "cancelled" : code3 === "TRANSFER_BUSY" ? "biz" : ["DISK_FULL", "DISK_PERMISSION", "TRANSFER_IO", "NEEDS_RECOVERY"].includes(code3) ? "disk" : "network";
  }
  code;
  retryAfterMs;
  category;
};
function isArtifactUrl(value) {
  try {
    const url = new URL(value);
    return value.length <= 2048 && url.protocol === "https:" && !url.username && !url.password && !url.port && !url.search && !url.hash && [
      "piston-data.mojang.com",
      "resources.download.minecraft.net",
      "libraries.minecraft.net",
      "launcher.mojang.com",
      "cdn.modrinth.com",
      "maven.fabricmc.net",
      "maven.quiltmc.org",
      "maven.minecraftforge.net",
      "maven.neoforged.net"
    ].includes(url.hostname);
  } catch {
    return false;
  }
}
function parseTransferRecord(value) {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new DownloadError("INVALID_TRANSFER");
    const row = value;
    const optional = ["etag", "lastModified", "objectDigest", "transportSource"].filter((key) => Object.hasOwn(row, key));
    if (!exactObject(row, ["url", "expected", "anchor", "key", "stagingId", "revision", "bytesDone", "state", ...optional]) || typeof row.url !== "string" || !isArtifactUrl(row.url) || typeof row.key !== "string" || !/^[a-f0-9]{64}$/.test(row.key) || typeof row.stagingId !== "string" || !UUID_PATTERN.test(row.stagingId) || typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 1 || row.revision >= Number.MAX_SAFE_INTEGER || typeof row.bytesDone !== "number" || !Number.isSafeInteger(row.bytesDone) || row.bytesDone < 0 || typeof row.state !== "string" || !["partial", "complete", "committed"].includes(row.state)) throw new DownloadError("INVALID_TRANSFER");
    const facts = definition(row.expected, row.anchor);
    if (sourceKey(facts.expected, facts.anchor) !== row.key || row.bytesDone > facts.expected.size || row.state !== "partial" && row.bytesDone !== facts.expected.size || row.etag !== void 0 && (typeof row.etag !== "string" || !/^"[\x21\x23-\x7e]{0,180}"$/.test(row.etag)) || row.lastModified !== void 0 && (typeof row.lastModified !== "string" || row.lastModified.length > 80 || !Number.isFinite(Date.parse(row.lastModified)) || new Date(row.lastModified).toUTCString() !== row.lastModified) || row.objectDigest !== void 0 && (typeof row.objectDigest !== "string" || !/^[a-f0-9]{64}$/.test(row.objectDigest)) || row.transportSource !== void 0 && row.transportSource !== "official" && row.transportSource !== "bmclapi" || row.state === "committed" !== (row.objectDigest !== void 0)) throw new DownloadError("INVALID_TRANSFER");
    return {
      ...facts,
      url: row.url,
      key: row.key,
      stagingId: row.stagingId,
      revision: row.revision,
      bytesDone: row.bytesDone,
      state: row.state,
      ...row.etag === void 0 ? {} : { etag: row.etag },
      ...row.lastModified === void 0 ? {} : { lastModified: row.lastModified },
      ...row.transportSource === void 0 ? {} : { transportSource: row.transportSource },
      ...row.objectDigest === void 0 ? {} : { objectDigest: row.objectDigest }
    };
  } catch {
    throw new DownloadError("INVALID_TRANSFER");
  }
}

// src/services/loaders/metadata.ts
var SEGMENT = "[a-zA-Z0-9_.+-]+";
var ENDPOINTS = {
  fabric: { origin: "https://meta.fabricmc.net", api: "v2" },
  quilt: { origin: "https://meta.quiltmc.org", api: "v3" }
};
function isOfficialLoaderMetadataUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return false;
  for (const { origin, api } of Object.values(ENDPOINTS)) {
    if (url.origin === origin && new RegExp(`^/${api}/versions/loader/${SEGMENT}(?:/${SEGMENT}/profile/json)?$`).test(url.pathname)) return true;
  }
  return url.href === "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json" || url.href === "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";
}

// src/services/loaders/maven.ts
var LIBRARY_LIMIT = 1024 ** 3;
var LoaderMavenError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "LoaderMavenError";
    this.category = code3 === "INVALID_METADATA" ? "validation" : code3 === "CANCELLED" ? "cancelled" : "network";
  }
  code;
  category;
};

// src/services/loaders/install-metadata.ts
function rebuildPreparedLoaderPlan(metadata2) {
  const profile = parseStoredLoaderProfile(
    metadata2.loader.kind,
    metadata2.version.ancestry[0] ?? "",
    metadata2.loader.version,
    metadata2.loader.profileBody,
    metadata2.loader.profileEvidence.sha256
  );
  return composeLoaderInstall({
    baseVersionDocuments: metadata2.versionDocuments,
    baseMetadataSha1ByVersion: metadata2.metadataSha1ByVersion,
    assets: metadata2.assets,
    profile,
    profileSha256: metadata2.loader.profileEvidence.sha256,
    libraries: metadata2.loader.libraries,
    environment: metadata2.loader.environment
  }).plan;
}
var LoaderInstallMetadataService = class {
  constructor(vanilla, metadata2, maven2) {
    this.vanilla = vanilla;
    this.metadata = metadata2;
    this.maven = maven2;
  }
  vanilla;
  metadata;
  maven;
  async prepare(kind, minecraftVersion, loaderVersion, environment2, signal) {
    if (environment2.os !== "windows" || environment2.arch !== "x64" || signal?.aborted) throw new CatalogError("INVALID_ARGUMENT");
    try {
      const [base, loader2] = await Promise.all([
        this.vanilla.prepare(minecraftVersion, environment2),
        this.metadata.profile(kind, minecraftVersion, loaderVersion, signal)
      ]);
      if (signal?.aborted) throw new CatalogError("CATALOG_UNAVAILABLE");
      const libraries = await this.maven.plan(loader2.profile, loader2.evidence, signal);
      const composed = composeLoaderInstall({
        baseVersionDocuments: base.versionDocuments,
        baseMetadataSha1ByVersion: base.metadataSha1ByVersion,
        assets: base.assets,
        profile: loader2.profile,
        profileSha256: loader2.evidence.sha256,
        libraries,
        environment: environment2
      });
      return { ...base, version: composed.version, plan: composed.plan, loader: {
        kind,
        version: loaderVersion,
        profileBody: loader2.body,
        profileEvidence: loader2.evidence,
        libraries,
        derivedDocument: composed.loaderDocument,
        environment: environment2
      } };
    } catch (error) {
      if (error instanceof CatalogError) throw error;
      if (error instanceof LoaderMavenError && (error.code === "NETWORK_FAILED" || error.code === "CANCELLED")) throw new CatalogError("CATALOG_UNAVAILABLE");
      throw new CatalogError("UNTRUSTED_MANIFEST");
    }
  }
};
function parseStoredLoaderProfile(kind, minecraftVersion, loaderVersion, body, expectedSha256) {
  if (typeof body !== "string" || Buffer.byteLength(body) > 2 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(expectedSha256)) throw new CatalogError("UNTRUSTED_MANIFEST");
  if ((0, import_node_crypto2.createHash)("sha256").update(body).digest("hex") !== expectedSha256) throw new CatalogError("UNTRUSTED_MANIFEST");
  try {
    return parseLoaderProfile(kind, minecraftVersion, loaderVersion, JSON.parse(body));
  } catch {
    throw new CatalogError("UNTRUSTED_MANIFEST");
  }
}

// src/services/workers/storage-client.ts
var import_node_worker_threads = require("node:worker_threads");
var import_node_crypto9 = require("node:crypto");

// src/core/task/machine.ts
function unchanged(execution, rejected) {
  return rejected ? { execution, effects: [], rejected } : { execution, effects: [] };
}
function move(execution, state2, effects = []) {
  return { execution: { ...execution, state: state2, revision: execution.revision + 1 }, effects };
}
function controlTask(execution, command) {
  const state2 = execution.state;
  if (command === "interrupted") {
    if (["running", "verifying", "committing", "pausing", "cancelling", "failing"].includes(state2)) return move(execution, "needsRecovery", ["recover"]);
    return unchanged(execution);
  }
  if (command === "cancel") {
    if (state2 === "committing" || state2 === "completed") return unchanged(execution, "CANCEL_TOO_LATE");
    if (state2 === "cancelling" || state2 === "cancelled") return unchanged(execution);
    if (state2 === "needsRecovery") return unchanged(execution, "INVALID_TASK_STATE");
    return move(execution, "cancelling", ["cleanup"]);
  }
  if (command === "pause") {
    if (state2 === "paused" || state2 === "pausing") return unchanged(execution);
    if (state2 === "queued") return move(execution, "paused");
    if (state2 === "running") return move(execution, "pausing", ["pause"]);
    return unchanged(execution, "INVALID_TASK_STATE");
  }
  if (command === "resume" && state2 === "paused") return move(execution, "queued");
  if (command === "retry" && state2 === "failed") return move(execution, "queued");
  if (command === "start" && state2 === "queued") {
    return { execution: {
      state: "running",
      attempt: execution.attempt + 1,
      lastSequence: 0,
      revision: execution.revision + 1,
      bytesDone: 0
    }, effects: ["start"] };
  }
  return unchanged(execution, "INVALID_TASK_STATE");
}
function applyWorkerEvent(execution, event) {
  if (event.attempt !== execution.attempt || !Number.isSafeInteger(event.sequence) || event.sequence <= execution.lastSequence) return unchanged(execution);
  const base = { ...execution, lastSequence: event.sequence };
  if (event.kind === "progress" && execution.state === "running") {
    const total = event.bytesTotal ?? execution.bytesTotal;
    if (!Number.isSafeInteger(event.bytesDone) || event.bytesDone < execution.bytesDone || total !== void 0 && (!Number.isSafeInteger(total) || total < event.bytesDone || execution.bytesTotal !== void 0 && total !== execution.bytesTotal)) return unchanged(execution);
    const next = { ...base, bytesDone: event.bytesDone, revision: base.revision + 1 };
    if (total !== void 0) next.bytesTotal = total;
    return { execution: next, effects: [] };
  }
  if (event.kind === "transferred" && execution.state === "running") return move(base, "verifying", ["verify"]);
  if (event.kind === "verified" && execution.state === "verifying") return move(base, "committing", ["commit"]);
  if (event.kind === "committed" && execution.state === "committing") return move(base, "completed");
  if (event.kind === "paused" && execution.state === "pausing") return move(base, "paused");
  if (event.kind === "cleaned" && execution.state === "cancelling") return move(base, "cancelled");
  if (event.kind === "cleaned" && execution.state === "failing") return move(base, "failed");
  if (event.kind === "failed" && ["running", "verifying", "pausing"].includes(execution.state)) return move(base, "failing", ["cleanup"]);
  if (event.kind === "failed" && ["committing", "cancelling", "failing"].includes(execution.state)) return move(base, "needsRecovery", ["recover"]);
  return unchanged(execution);
}

// src/services/storage/files.ts
var import_promises2 = require("node:fs/promises");
var import_node_path = __toESM(require("node:path"), 1);
var MAX_RECORD_BYTES = 4 * 1024 * 1024;
var StorageError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "StorageError";
    this.category = code3 === "INVALID_RECORD" || code3 === "UNSAFE_PATH" ? "validation" : code3 === "REVISION_CONFLICT" || code3 === "STORE_BUSY" ? "biz" : "disk";
  }
  code;
  category;
};
function hasCode(error, code3) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code3;
}
async function guardDirectory(directory2) {
  if (!import_node_path.default.isAbsolute(directory2)) throw new StorageError("UNSAFE_PATH");
  const resolved = import_node_path.default.resolve(directory2);
  const root = import_node_path.default.parse(resolved).root;
  if (process.platform === "win32" && !/^[a-zA-Z]:\\$/.test(root)) throw new StorageError("UNSAFE_PATH");
  let current = root;
  for (const part of resolved.slice(root.length).split(import_node_path.default.sep).filter(Boolean)) {
    current = import_node_path.default.join(current, part);
    const info = await (0, import_promises2.lstat)(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new StorageError("UNSAFE_PATH");
  }
  return (0, import_promises2.realpath)(resolved);
}
async function readRegular(file, maximum = MAX_RECORD_BYTES) {
  let info;
  try {
    info = await (0, import_promises2.lstat)(file);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return void 0;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum) throw new StorageError("UNSAFE_PATH");
  const handle = await (0, import_promises2.open)(file, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino || opened.size > maximum) throw new StorageError("UNSAFE_PATH");
    const bytes = Buffer.alloc(opened.size + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== opened.size) throw new StorageError("NEEDS_RECOVERY");
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
async function guardDatabase(file) {
  let exists2 = false;
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    try {
      const info = await (0, import_promises2.lstat)(file + suffix);
      if (!info.isFile() || info.isSymbolicLink()) throw new StorageError("UNSAFE_PATH");
      if (!suffix) exists2 = true;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
  }
  return exists2;
}

// src/services/storage/tasks.ts
var TASK_KINDS = ["download", "install", "java", "launch", "stop", "mod-check", "mod-install"];
var STATES = ["queued", "running", "verifying", "committing", "pausing", "paused", "cancelling", "cancelled", "completed", "failing", "failed", "needsRecovery"];
function parseExecution(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new StorageError("INVALID_RECORD");
  const record3 = value;
  if (Object.keys(record3).some((key) => !["state", "attempt", "lastSequence", "revision", "bytesDone", "bytesTotal"].includes(key)) || typeof record3.state !== "string" || !STATES.includes(record3.state) || !["attempt", "lastSequence", "revision", "bytesDone"].every((key) => typeof record3[key] === "number" && Number.isSafeInteger(record3[key]) && record3[key] >= 0) || record3.revision === 0 || record3.revision === Number.MAX_SAFE_INTEGER || record3.bytesTotal !== void 0 && (typeof record3.bytesTotal !== "number" || !Number.isSafeInteger(record3.bytesTotal) || record3.bytesTotal < record3.bytesDone)) throw new StorageError("INVALID_RECORD");
  return {
    state: record3.state,
    attempt: record3.attempt,
    lastSequence: record3.lastSequence,
    revision: record3.revision,
    bytesDone: record3.bytesDone,
    ...record3.bytesTotal === void 0 ? {} : { bytesTotal: record3.bytesTotal }
  };
}

// src/shared/contracts/resources.ts
var resourceId = (x) => typeof x === "string" && /^[a-zA-Z0-9]{8}$/.test(x);
var text = (x, max) => typeof x === "string" && x.length <= max && !/[\p{C}]/u.test(x);
var integer = (x) => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
var resourceKind = (x) => x === "mod" || x === "resourcepack" || x === "shader";
var resourceFilename = (x) => text(x, 180) && x.length > 0 && !/[<>:"/\\|?*]/.test(x) && !/[. ]$/.test(x) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x) && /\.(jar|zip)$/i.test(x);
var filter = (x) => text(x, 64) && /^[a-zA-Z0-9_.+ -]*$/.test(x);
var resourceLoader = (x) => typeof x === "string" && ["", "fabric", "quilt", "forge", "neoforge", "minecraft", "iris", "optifine", "vanilla", "canvas"].includes(x);
function isResourcePayload(x, channel) {
  if (channel === "resources:search") return exactObject(x, ["kind", "query", "gameVersion", "loader", "offset"]) && resourceKind(x.kind) && text(x.query, 120) && filter(x.gameVersion) && resourceLoader(x.loader) && integer(x.offset) && x.offset <= 1e4;
  if (channel === "resources:versions") return exactObject(x, ["projectId", "gameVersion", "loader"]) && resourceId(x.projectId) && filter(x.gameVersion) && resourceLoader(x.loader);
  if (channel === "resources:download") return exactObject(x, ["projectId", "versionId", "fileId"]) && resourceId(x.projectId) && resourceId(x.versionId) && typeof x.fileId === "string" && /^[a-f0-9]{40}$/.test(x.fileId);
  return (channel === "resources:library" || channel === "resources:open") && exactObject(x, []);
}
function isLibraryItem(x) {
  return exactObject(x, ["fileId", "taskId", "projectId", "versionId", "kind", "title", "versionName", "filename", "size", "downloaded", ...typeof x === "object" && x !== null && Object.hasOwn(x, "errorCode") ? ["errorCode"] : []]) && typeof x.fileId === "string" && /^[a-f0-9]{40}$/.test(x.fileId) && typeof x.taskId === "string" && UUID_PATTERN.test(x.taskId) && resourceId(x.projectId) && resourceId(x.versionId) && resourceKind(x.kind) && text(x.title, 200) && text(x.versionName, 200) && resourceFilename(x.filename) && integer(x.size) && x.size <= 2 * 1024 ** 3 && typeof x.downloaded === "boolean" && (!Object.hasOwn(x, "errorCode") || typeof x.errorCode === "string" && Object.hasOwn(ERRORS, x.errorCode));
}
var ERRORS = {
  INVALID_ARGUMENT: { category: "validation", key: "invalidArgument" },
  UNSUPPORTED_CONTRACT: { category: "validation", key: "unsupportedContract" },
  INVALID_SENDER: { category: "permission", key: "invalidSender" },
  TIMEOUT: { category: "system", key: "timeout" },
  UNAVAILABLE: { category: "system", key: "unavailable" },
  NETWORK_FAILED: { category: "network", key: "resourceNetworkFailed" },
  RETRY_LATER: { category: "network", key: "resourceRateLimited" },
  HASH_MISMATCH: { category: "network", key: "resourceHashMismatch" },
  ROOT_UNAVAILABLE: { category: "disk", key: "chooseRootFirst" },
  NEEDS_RECOVERY: { category: "disk", key: "stageRecovery" }
};

// src/shared/contracts/mods-report.ts
var states = ["satisfied", "unsatisfied", "unknown"];
var code = (value) => typeof value === "string" && /^[A-Z_]{1,64}$/.test(value);
var text2 = (value, maximum) => typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\p{C}]/u.test(value);
var nullableText = (value, maximum) => value === null || text2(value, maximum);
var nullableHash = (value, length) => value === null || typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
var fileId = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
var id = (value) => typeof value === "string" && /^[a-z][a-z0-9_-]{1,63}$/.test(value);
var nullableId = (value) => value === null || id(value);
var nullableProject = (value) => value === null || resourceId(value);
var member = (value, values) => typeof value === "string" && values.includes(value);
function isModFileSummary(value) {
  if (!exactObject(value, ["fileId", "filename", "enabled", "size", "sha1", "sha256", "sha512", "mods", "sourceStatus", "source", "issues"]) || !fileId(value.fileId) || typeof value.filename !== "string" || !/\.jar(?:\.disabled)?$/i.test(value.filename) || typeof value.enabled !== "boolean" || value.enabled === value.filename.toLowerCase().endsWith(".disabled") || value.size !== null && (typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 0) || !nullableHash(value.sha1, 40) || !nullableHash(value.sha256, 64) || !nullableHash(value.sha512, 128) || !Array.isArray(value.mods) || value.mods.length > 256 || !Array.isArray(value.issues) || value.issues.length > 256 || !value.issues.every(code) || !member(value.sourceStatus, ["matched", "unknown", "conflict"])) return false;
  if ([value.sha1, value.sha256, value.sha512].some((hash2) => hash2 === null) && [value.sha1, value.sha256, value.sha512].some((hash2) => hash2 !== null)) return false;
  try {
    validateComponent(value.filename);
  } catch {
    return false;
  }
  if (value.source !== null && (!exactObject(value.source, ["projectId", "versionId", "versionName"]) || !resourceId(value.source.projectId) || !resourceId(value.source.versionId) || !text2(value.source.versionName, 256) || value.sha512 === null)) return false;
  if (value.sourceStatus === "unknown" && value.source !== null || value.sourceStatus !== "unknown" && value.source === null) return false;
  for (const mod of value.mods) if (!exactObject(mod, ["format", "id", "version", "name"]) || !member(mod.format, ["fabric", "quilt", "forge", "neoforge"]) || !id(mod.id) || !nullableText(mod.version, 160) || typeof mod.version === "string" && mod.version.includes("${") || !text2(mod.name, 256)) return false;
  return true;
}
function isModReportIssue(value) {
  if (!exactObject(value, ["scope", "severity", "code", "fileId", "modId", "targetModId", "targetProjectId", "targetVersionId", "requirement", "actual", "via"]) || value.scope !== "local" && value.scope !== "platform" || !member(value.severity, ["error", "unknown", "warning"]) || !code(value.code) || value.fileId !== "" && !fileId(value.fileId) || !nullableId(value.modId) || !nullableId(value.targetModId) || !nullableProject(value.targetProjectId) || !nullableProject(value.targetVersionId) || !nullableText(value.requirement, 8192) || !Array.isArray(value.actual) || value.actual.length > 16 || !value.actual.every((item) => text2(item, 160)) || !Array.isArray(value.via) || value.via.length > 4) return false;
  for (const entry of value.via) {
    if (typeof entry !== "string" || entry.length > 4096) return false;
    try {
      installRelativePath(entry);
    } catch {
      return false;
    }
  }
  return true;
}
function isModReport(value) {
  if (!exactObject(value, ["formatVersion", "instanceId", "instanceRevision", "fingerprint", "checkedAt", "mode", "localState", "state", "files", "issues"]) || value.formatVersion !== 1 || typeof value.instanceId !== "string" || !UUID_PATTERN.test(value.instanceId) || typeof value.instanceRevision !== "number" || !Number.isSafeInteger(value.instanceRevision) || value.instanceRevision < 1 || !fileId(value.fingerprint) || typeof value.checkedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.checkedAt) || !Number.isFinite(Date.parse(value.checkedAt)) || value.mode !== "list" && value.mode !== "check" || !member(value.localState, states) || !member(value.state, states) || !Array.isArray(value.files) || value.files.length > 256 || !value.files.every(isModFileSummary) || new Set(value.files.map((file) => file.fileId)).size !== value.files.length || new Set(value.files.map((file) => file.filename.toLowerCase())).size !== value.files.length || !Array.isArray(value.issues) || value.issues.length > 512 || !value.issues.every(isModReportIssue)) return false;
  const ids2 = new Set(value.files.map((file) => file.fileId));
  if (value.issues.some((issue) => issue.fileId !== "" && !ids2.has(issue.fileId))) return false;
  if (value.state === "satisfied" && (value.issues.some((issue) => issue.severity !== "warning") || value.localState !== "satisfied")) return false;
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length <= 2 * 1024 ** 2;
  } catch {
    return false;
  }
}

// src/shared/contracts/instances.ts
var STATES2 = ["queued", "running", "verifying", "committing", "pausing", "paused", "cancelling", "cancelled", "completed", "failing", "failed", "needsRecovery"];
var STAGES = ["metadata", "downloading", "materializing", "committing", "completed", "failed", "cancelled", "needsRecovery", "queued", "preparing"];
var ERRORS2 = {
  INVALID_ARGUMENT: { category: "validation", key: "invalidArgument", retryable: false },
  UNSUPPORTED_CONTRACT: { category: "validation", key: "unsupportedContract", retryable: false },
  INVALID_SENDER: { category: "permission", key: "invalidSender", retryable: false },
  OUT_OF_SCOPE: { category: "permission", key: "invalidSender", retryable: false },
  TIMEOUT: { category: "system", key: "timeout", retryable: true },
  UNAVAILABLE: { category: "system", key: "unavailable", retryable: true },
  ROOT_UNAVAILABLE: { category: "disk", key: "rootUnavailable", retryable: true },
  VERSION_UNSUPPORTED: { category: "minecraft", key: "unavailable", retryable: false },
  NAME_CONFLICT: { category: "biz", key: "invalidArgument", retryable: false },
  DISK_FULL: { category: "disk", key: "unavailable", retryable: true },
  PERMISSION_DENIED: { category: "permission", key: "permissionDenied", retryable: true },
  TASK_STORE_UNAVAILABLE: { category: "disk", key: "unavailable", retryable: true },
  TASK_NOT_FOUND: { category: "biz", key: "unavailable", retryable: false },
  TASK_NOT_OWNED: { category: "permission", key: "invalidSender", retryable: false },
  INVALID_TASK_STATE: { category: "biz", key: "unavailable", retryable: false },
  CANCEL_TOO_LATE: { category: "biz", key: "unavailable", retryable: false },
  CURSOR_EXPIRED: { category: "biz", key: "unavailable", retryable: true },
  SUBSCRIPTION_NOT_OWNED: { category: "permission", key: "invalidSender", retryable: false },
  NEEDS_RECOVERY: { category: "disk", key: "unavailable", retryable: false },
  INSTALL_FAILED: { category: "minecraft", key: "unavailable", retryable: true },
  LAUNCH_FAILED: { category: "minecraft", key: "launchFailed", retryable: true },
  JAVA_INCOMPATIBLE: { category: "validation", key: "javaIncompatible", retryable: false },
  AUTH_REQUIRED: { category: "auth", key: "chooseAccountFirst", retryable: false },
  DEPENDENCY_MISSING: { category: "minecraft", key: "dependencyMissing", retryable: true },
  MEMORY_OUT_OF_RANGE: { category: "validation", key: "memoryInvalid", retryable: false },
  INSTANCE_BUSY: { category: "biz", key: "instanceBusy", retryable: true },
  REVISION_CONFLICT: { category: "biz", key: "instanceChanged", retryable: true },
  STOP_UNSUPPORTED: { category: "biz", key: "stopUnsupported", retryable: false },
  CONFIRMATION_REQUIRED: { category: "permission", key: "stopConfirmation", retryable: false },
  SESSION_NOT_FOUND: { category: "biz", key: "unavailable", retryable: false },
  SESSION_NOT_OWNED: { category: "permission", key: "invalidSender", retryable: false }
};
var InstanceContractError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "InstanceContractError";
  }
  code;
};
function uuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
function integer2(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function state(value) {
  return typeof value === "string" && STATES2.includes(value);
}
function version(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_.+ -]{1,160}$/.test(value) && value.trim() === value && value !== "." && value !== "..";
}
function name(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 80 && value.trim() === value && !/[\p{C}]/u.test(value);
}
function isolation(value) {
  return value === "inherit" || value === "on" || value === "off";
}
function optionalKeys(value, required, optional) {
  return typeof value === "object" && value !== null && exactObject(value, [...required, ...optional.filter((key) => Object.hasOwn(value, key))]);
}
function cursor(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 512 && !/[\p{C}]/u.test(value);
}
function query(value, withRoot) {
  return optionalKeys(value, withRoot ? ["rootId", "limit"] : ["limit"], withRoot ? ["cursor"] : ["cursor", "state"]) && integer2(value.limit) && value.limit >= 1 && value.limit <= 100 && (!withRoot || uuid(value.rootId)) && (!Object.hasOwn(value, "cursor") || cursor(value.cursor)) && (!Object.hasOwn(value, "state") || state(value.state));
}
function isInstancePayload(value, channel) {
  switch (channel) {
    case "instances:list":
      return query(value, true);
    case "instances:create":
      return exactObject(value, ["rootId", "mcVersionId", "displayName", "isolation"]) && uuid(value.rootId) && version(value.mcVersionId) && name(value.displayName) && isolation(value.isolation);
    case "tasks:list":
      return query(value, false);
    case "tasks:get":
      return exactObject(value, ["taskId"]) && uuid(value.taskId);
    case "tasks:control":
      return exactObject(value, ["taskId", "action"]) && uuid(value.taskId) && typeof value.action === "string" && ["pause", "resume", "cancel"].includes(value.action);
    case "tasks:subscribe":
      return optionalKeys(value, ["taskId"], ["afterSeq"]) && uuid(value.taskId) && (!Object.hasOwn(value, "afterSeq") || integer2(value.afterSeq));
    case "events:unsubscribe":
      return exactObject(value, ["subscriptionId"]) && uuid(value.subscriptionId);
    default:
      return false;
  }
}
function instanceFailure(requestId, code3, traceId) {
  const spec = ERRORS2[code3];
  return { contractVersion: 1, requestId, ok: false, error: { category: spec.category, code: code3, messageKey: spec.key, retryable: spec.retryable, traceId } };
}
function isInstanceError(value) {
  if (!exactObject(value, ["category", "code", "messageKey", "retryable", "traceId"]) || typeof value.code !== "string" || !Object.hasOwn(ERRORS2, value.code) || !uuid(value.traceId)) return false;
  const expected = ERRORS2[value.code];
  return value.category === expected.category && value.messageKey === expected.key && value.retryable === expected.retryable;
}
function isInstanceSummary(value) {
  return exactObject(value, ["instanceId", "displayName", "mcVersionId", "isolation", "state", "revision"]) && uuid(value.instanceId) && name(value.displayName) && version(value.mcVersionId) && isolation(value.isolation) && typeof value.state === "string" && ["installing", "ready", "failed", "cancelled", "needsRecovery"].includes(value.state) && integer2(value.revision) && value.revision > 0;
}
function isTaskSnapshot(value) {
  if (!optionalKeys(value, ["taskId", "kind", "state", "stage", "revision", "bytesDone"], ["bytesTotal", "error"]) || !uuid(value.taskId) || !["install", "launch", "stop", "download", "mod-check", "mod-install"].includes(value.kind) || !state(value.state) || typeof value.stage !== "string" || !STAGES.includes(value.stage) || !integer2(value.revision) || value.revision < 1 || !integer2(value.bytesDone) || value.kind !== "install" && value.kind !== "download" && ["metadata", "downloading", "materializing"].includes(value.stage) || value.kind === "install" && value.stage === "preparing" || Object.hasOwn(value, "bytesTotal") && (!integer2(value.bytesTotal) || value.bytesTotal < value.bytesDone) || Object.hasOwn(value, "error") && !isInstanceError(value.error)) return false;
  return true;
}
function page(value, item, identity3) {
  return optionalKeys(value, ["items"], ["nextCursor"]) && Array.isArray(value.items) && value.items.length <= 100 && value.items.every(item) && new Set(value.items.map(identity3)).size === value.items.length && (!Object.hasOwn(value, "nextCursor") || cursor(value.nextCursor));
}
function isInstanceData(value, channel) {
  switch (channel) {
    case "instances:list":
      return page(value, isInstanceSummary, (item) => item.instanceId.toLowerCase());
    case "instances:create":
      return exactObject(value, ["taskId"]) && uuid(value.taskId);
    case "tasks:list":
      return page(value, isTaskSnapshot, (item) => item.taskId.toLowerCase());
    case "tasks:get":
      return optionalKeys(value, ["snapshot"], ["result"]) && isTaskSnapshot(value.snapshot) && (!Object.hasOwn(value, "result") || value.snapshot.state === "completed" && (value.snapshot.kind === "install" ? exactObject(value.result, ["instanceId"]) && uuid(value.result.instanceId) : value.snapshot.kind === "launch" ? exactObject(value.result, ["sessionId"]) && uuid(value.result.sessionId) : optionalKeys(value.result, ["sessionId", "stopped"], ["exitCode"]) && uuid(value.result.sessionId) && value.result.stopped === true && (!Object.hasOwn(value.result, "exitCode") || Number.isSafeInteger(value.result.exitCode))));
    case "tasks:control":
      return exactObject(value, ["taskId", "accepted", "state"]) && uuid(value.taskId) && value.accepted === true && state(value.state);
    case "tasks:subscribe":
      return exactObject(value, ["subscriptionId", "snapshot", "seq"]) && uuid(value.subscriptionId) && isTaskSnapshot(value.snapshot) && integer2(value.seq);
    case "events:unsubscribe":
      return exactObject(value, ["removed"]) && typeof value.removed === "boolean";
    default:
      return false;
  }
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
var uuid2 = (value) => typeof value === "string" && UUID_PATTERN.test(value);
var integer3 = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
var ids = (value, maximum) => Array.isArray(value) && value.length <= maximum && value.every(resourceId);
function selections(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length > 256) return false;
  return Object.entries(value).every(([projectId, versionId]) => resourceId(projectId) && resourceId(versionId));
}
var isModCode = (value) => typeof value === "string" && MOD_CODES.includes(value);
function isModPayload(value, channel) {
  if (channel === "mods:report") return exactObject(value, ["taskId"]) && uuid2(value.taskId);
  if (channel === "mods:planState" || channel === "mods:installState") return exactObject(value, ["planRequestId"]) && uuid2(value.planRequestId);
  if (channel === "mods:confirm") return exactObject(value, ["planRequestId", "planId", "confirmed"]) && uuid2(value.planRequestId) && typeof value.planId === "string" && /^[a-f0-9]{64}$/.test(value.planId) && value.confirmed === true;
  if (channel === "mods:cancelPlan") return exactObject(value, ["planRequestId", "planId"]) && uuid2(value.planRequestId) && typeof value.planId === "string" && /^[a-f0-9]{64}$/.test(value.planId);
  if (channel === "mods:plan") return exactObject(value, ["instanceId", "expectedRevision", "root", "selections"]) && uuid2(value.instanceId) && integer3(value.expectedRevision) && value.expectedRevision >= 1 && isResourcePayload(value.root, "resources:download") && selections(value.selections);
  return (channel === "mods:list" || channel === "mods:check") && exactObject(value, ["instanceId", "expectedRevision"]) && uuid2(value.instanceId) && typeof value.expectedRevision === "number" && Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 1;
}
var issueCodes = [
  "MISSING_CANDIDATE",
  "PIN_CONFLICT",
  "PROJECT_CONFLICT",
  "INSTALLED_CONFLICT",
  "INCOMPATIBLE",
  "UNRESOLVED_IDENTITY",
  "CYCLE",
  "DEPTH_LIMIT",
  "PROJECT_LIMIT",
  "UNKNOWN_INSTALLED",
  "TARGET_CONFLICT",
  "FILE_SELECTION",
  "SEARCH_LIMIT",
  "NO_SOLUTION"
];
function isModInstallPlan(value) {
  if (!exactObject(value, [
    "formatVersion",
    "planId",
    "instanceId",
    "instanceRevision",
    "fingerprint",
    "minecraft",
    "loader",
    "rootVersionId",
    "state",
    "attempts",
    "totalDownloadBytes",
    "items",
    "issues"
  ]) || value.formatVersion !== 1 || typeof value.planId !== "string" || !/^[a-f0-9]{64}$/.test(value.planId) || !uuid2(value.instanceId) || !integer3(value.instanceRevision) || value.instanceRevision < 1 || typeof value.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.fingerprint) || typeof value.minecraft !== "string" || value.minecraft.length < 1 || value.minecraft.length > 64 || !["fabric", "quilt", "forge", "neoforge"].includes(value.loader) || !resourceId(value.rootVersionId) || !["ready", "conflict", "unknown"].includes(value.state) || !integer3(value.attempts) || value.attempts > 4096 || !integer3(value.totalDownloadBytes) || !Array.isArray(value.items) || value.items.length > 256 || !Array.isArray(value.issues) || value.issues.length > 512) return false;
  if (!value.items.every((item) => exactObject(item, ["projectId", "versionId", "filename", "fileId", "sha512", "size", "disposition", "requiredBy"]) && resourceId(item.projectId) && resourceId(item.versionId) && resourceFilename(item.filename) && typeof item.fileId === "string" && /^[a-f0-9]{40}$/.test(item.fileId) && typeof item.sha512 === "string" && /^[a-f0-9]{128}$/.test(item.sha512) && integer3(item.size) && item.size >= 1 && item.size <= 1024 ** 3 && ["reuse", "library", "download"].includes(item.disposition) && ids(item.requiredBy, 256))) return false;
  return value.issues.every((issue) => exactObject(issue, ["severity", "code", "projectId", "versionId", "requiredBy"]) && (issue.severity === "conflict" || issue.severity === "unknown") && typeof issue.code === "string" && issueCodes.includes(issue.code) && (issue.projectId === null || resourceId(issue.projectId)) && (issue.versionId === null || resourceId(issue.versionId)) && ids(issue.requiredBy, 256));
}

// src/services/storage/mod-jobs.ts
var uuid3 = (value) => typeof value === "string" && UUID_PATTERN.test(value);
function invalid() {
  throw new StorageError("INVALID_RECORD");
}
function parseModJobs(value) {
  if (!exactObject(value, ["formatVersion", "rootId", "items"]) || value.formatVersion !== 1 || !uuid3(value.rootId) || !Array.isArray(value.items) || value.items.length > 1e3) invalid();
  const requests = /* @__PURE__ */ new Set();
  const tasks = /* @__PURE__ */ new Set();
  for (const job of value.items) {
    if (!exactObject(job, ["taskId", "requestId", "payloadDigest", "instanceId", "instanceRevision", "mode", "stage", "reportRevision", "errorCode"]) || !uuid3(job.taskId) || !uuid3(job.requestId) || !uuid3(job.instanceId) || typeof job.payloadDigest !== "string" || !/^[a-f0-9]{64}$/.test(job.payloadDigest) || typeof job.instanceRevision !== "number" || !Number.isSafeInteger(job.instanceRevision) || job.instanceRevision < 1 || job.mode !== "list" && job.mode !== "check" || typeof job.stage !== "string" || !["queued", "local", "platform", "rechecking", "completed", "failed", "cancelled", "needsRecovery"].includes(job.stage) || job.reportRevision !== 0 && job.reportRevision !== 1 || job.errorCode !== null && !isModCode(job.errorCode)) invalid();
    if (job.stage === "completed" && (job.reportRevision !== 1 || job.errorCode !== null) || job.reportRevision === 1 && job.errorCode !== null || requests.has(job.requestId.toLowerCase()) || tasks.has(job.taskId.toLowerCase())) invalid();
    requests.add(job.requestId.toLowerCase());
    tasks.add(job.taskId.toLowerCase());
  }
  return value;
}
function parseStoredModReport(value) {
  if (!exactObject(value, ["formatVersion", "rootId", "taskId", "report"]) || value.formatVersion !== 1 || !uuid3(value.rootId) || !uuid3(value.taskId) || !isModReport(value.report)) invalid();
  return value;
}

// src/services/mods/plan-identity.ts
var import_node_crypto3 = require("node:crypto");
function canonicalModPlanInput(input) {
  return {
    instanceId: input.instanceId.toLowerCase(),
    expectedRevision: input.expectedRevision,
    root: { projectId: input.root.projectId, versionId: input.root.versionId, fileId: input.root.fileId },
    selections: Object.fromEntries(Object.entries(input.selections).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
  };
}
function modPlanInputDigest(input) {
  return (0, import_node_crypto3.createHash)("sha256").update(JSON.stringify(canonicalModPlanInput(input))).digest("hex");
}
function modPlanDigest(plan) {
  const body = {
    formatVersion: plan.formatVersion,
    instanceId: plan.instanceId,
    instanceRevision: plan.instanceRevision,
    fingerprint: plan.fingerprint,
    minecraft: plan.minecraft,
    loader: plan.loader,
    rootVersionId: plan.rootVersionId,
    state: plan.state,
    attempts: plan.attempts,
    totalDownloadBytes: plan.totalDownloadBytes,
    items: plan.items.map((item) => ({
      projectId: item.projectId,
      versionId: item.versionId,
      filename: item.filename,
      fileId: item.fileId,
      sha512: item.sha512,
      size: item.size,
      disposition: item.disposition,
      requiredBy: item.requiredBy
    })),
    issues: plan.issues.map((issue) => ({
      severity: issue.severity,
      code: issue.code,
      projectId: issue.projectId,
      versionId: issue.versionId,
      requiredBy: issue.requiredBy
    }))
  };
  return (0, import_node_crypto3.createHash)("sha256").update(JSON.stringify(body)).digest("hex");
}

// src/services/storage/mod-plans.ts
var uuid4 = (value) => typeof value === "string" && UUID_PATTERN.test(value);
function invalid2() {
  throw new StorageError("INVALID_RECORD");
}
function modPlanRecordId(requestId) {
  if (!uuid4(requestId)) invalid2();
  return `mod-plan-${requestId.toLowerCase()}`;
}
function parseStoredModPlan(value) {
  if (!exactObject(value, ["formatVersion", "rootId", "requestId", "payloadDigest", "input", "plan", "status"]) || value.formatVersion !== 1 || !uuid4(value.rootId) || !uuid4(value.requestId) || typeof value.payloadDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.payloadDigest) || !isModPayload(value.input, "mods:plan") || !isModInstallPlan(value.plan) || value.status !== "preview" && value.status !== "cancelled") invalid2();
  const input = canonicalModPlanInput(value.input);
  const plan = value.plan;
  if (Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 ** 2 || value.payloadDigest !== modPlanInputDigest(input) || plan.planId !== modPlanDigest(plan) || plan.instanceId !== input.instanceId || plan.instanceRevision !== input.expectedRevision || plan.rootVersionId !== input.root.versionId || plan.totalDownloadBytes !== plan.items.filter((item) => item.disposition === "download").reduce((sum, item) => sum + item.size, 0) || new Set(plan.items.map((item) => item.projectId)).size !== plan.items.length || plan.state === "ready" && (plan.issues.length > 0 || plan.items.filter((item) => item.versionId === input.root.versionId && item.projectId === input.root.projectId && item.fileId === input.root.fileId).length !== 1)) invalid2();
  return {
    formatVersion: 1,
    rootId: value.rootId.toLowerCase(),
    requestId: value.requestId.toLowerCase(),
    payloadDigest: value.payloadDigest,
    input,
    plan: structuredClone(plan),
    status: value.status
  };
}

// src/services/storage/mod-transactions.ts
var uuid5 = (value) => typeof value === "string" && UUID_PATTERN.test(value);
var hex2 = (value, length) => typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
function invalid3() {
  throw new StorageError("INVALID_RECORD");
}
function parseModTransaction(value) {
  if (!exactObject(value, [
    "formatVersion",
    "taskId",
    "rootId",
    "planRequestId",
    "planId",
    "instanceId",
    "instanceRevision",
    "fingerprint",
    "beforeInstanceDigest",
    "afterInstanceDigest",
    "leaseToken",
    "phase",
    "files"
  ]) || value.formatVersion !== 1 || ![value.taskId, value.rootId, value.planRequestId, value.instanceId, value.leaseToken].every(uuid5) || ![value.planId, value.fingerprint, value.beforeInstanceDigest, value.afterInstanceDigest].every((item) => hex2(item, 64)) || typeof value.instanceRevision !== "number" || !Number.isSafeInteger(value.instanceRevision) || value.instanceRevision < 1 || value.instanceRevision >= Number.MAX_SAFE_INTEGER - 1 || !["prepared", "applying", "committed", "rolledBack", "needsRecovery"].includes(value.phase) || !Array.isArray(value.files) || value.files.length > 256) invalid3();
  const names = /* @__PURE__ */ new Set();
  const projects = /* @__PURE__ */ new Set();
  for (const file of value.files) {
    if (!exactObject(file, ["filename", "projectId", "versionId", "sha1", "sha256", "sha512", "size", "sourceKey", "identity"]) || !resourceFilename(file.filename) || !file.filename.toLowerCase().endsWith(".jar") || !resourceId(file.projectId) || !resourceId(file.versionId) || !hex2(file.sha1, 40) || !hex2(file.sha256, 64) || !hex2(file.sha512, 128) || !hex2(file.sourceKey, 64) || typeof file.size !== "number" || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 1024 ** 3 || file.identity !== null && (!exactObject(file.identity, ["dev", "ino"]) || file.identity.ino === "0" || ![file.identity.dev, file.identity.ino].every((item) => typeof item === "string" && /^\d{1,32}$/.test(item)))) invalid3();
    if (names.has(file.filename.toLowerCase()) || projects.has(file.projectId) || ["applying", "committed"].includes(value.phase) && file.identity === null) invalid3();
    names.add(file.filename.toLowerCase());
    projects.add(file.projectId);
  }
  if (Buffer.byteLength(JSON.stringify(value)) > 512 * 1024) invalid3();
  const result2 = structuredClone(value);
  for (const key of ["taskId", "rootId", "planRequestId", "instanceId", "leaseToken"]) result2[key] = result2[key].toLowerCase();
  return result2;
}

// src/services/storage/mod-results.ts
var uuid6 = (value) => typeof value === "string" && UUID_PATTERN.test(value);
function invalid4() {
  throw new StorageError("INVALID_RECORD");
}
function parseModInstallResult(value) {
  if (!exactObject(value, ["formatVersion", "rootId", "taskId", "planRequestId", "planId", "instanceId", "instanceRevision", "state", "errorCode", "assessment"]) || value.formatVersion !== 1 || !uuid6(value.rootId) || !uuid6(value.taskId) || !uuid6(value.planRequestId) || !uuid6(value.instanceId) || typeof value.planId !== "string" || !/^[a-f0-9]{64}$/.test(value.planId) || typeof value.instanceRevision !== "number" || !Number.isSafeInteger(value.instanceRevision) || value.instanceRevision < 1 || !["completed", "failed", "cancelled", "needsRecovery"].includes(String(value.state)) || value.errorCode !== null && !isModCode(value.errorCode) || value.assessment !== null && !isModReport(value.assessment) || value.state === "completed" !== (value.errorCode === null) || value.state === "cancelled" && value.errorCode !== "CANCELLED" || value.state === "needsRecovery" && value.errorCode !== "NEEDS_RECOVERY" || value.assessment !== null && (value.assessment.instanceId !== value.instanceId || value.assessment.instanceRevision !== value.instanceRevision) || Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 ** 2) invalid4();
  return structuredClone(value);
}

// src/services/storage/installation.ts
function parseInstallation(value) {
  if (!exactObject(value, ["rootId", "dataDirectory"]) || typeof value.rootId !== "string" || !UUID_PATTERN.test(value.rootId) || typeof value.dataDirectory !== "string") throw new StorageError("INVALID_RECORD");
  try {
    return { rootId: value.rootId, dataDirectory: normalizeDataDirectory(value.dataDirectory) };
  } catch {
    throw new StorageError("INVALID_RECORD");
  }
}

// src/services/storage/catalog-cache.ts
var import_node_crypto4 = require("node:crypto");
function parseCatalogCache(value) {
  try {
    if (!exactObject(value, ["fetchedAt", "body", "sha256"]) || typeof value.fetchedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.fetchedAt) || !Number.isFinite(Date.parse(value.fetchedAt)) || typeof value.body !== "string" || Buffer.byteLength(value.body) > 2 * 1024 * 1024 || typeof value.sha256 !== "string" || (0, import_node_crypto4.createHash)("sha256").update(value.body).digest("hex") !== value.sha256) throw new StorageError("INVALID_RECORD");
    parseManifest(JSON.parse(value.body));
    return { fetchedAt: value.fetchedAt, body: value.body, sha256: value.sha256 };
  } catch {
    throw new StorageError("INVALID_RECORD");
  }
}

// src/services/storage/instance-records.ts
var import_node_crypto6 = require("node:crypto");

// src/core/loaders/installer-profile.ts
var FACTS = {
  forge: {
    profile: "forge",
    version: (minecraft, loader2) => `${minecraft}-forge-${loader2}`,
    paths: { "maven.minecraftforge.net": "", "libraries.minecraft.net": "" }
  },
  neoforge: {
    profile: "NeoForge",
    version: (_minecraft, loader2) => `neoforge-${loader2}`,
    paths: { "maven.neoforged.net": "/releases", "libraries.minecraft.net": "" }
  }
};
var REQUIRED_DATA = ["MAPPINGS", "MOJMAPS", "MERGED_MAPPINGS", "BINPATCH", "MC_SLIM", "MC_EXTRA", "MC_SRG", "PATCHED"];
var BUILTIN_PLACEHOLDERS = /* @__PURE__ */ new Set(["SIDE", "MINECRAFT_JAR", "INSTALLER", "ROOT"]);
function bounded(value, maximum = 8192) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && [...value].every((character) => {
    const code3 = character.charCodeAt(0);
    return code3 >= 32 && (code3 < 127 || code3 > 159);
  });
}
function mavenPath(coordinate2) {
  const pair = coordinate2.split("@");
  requireMetadata(pair.length <= 2);
  const extension = pair[1] ?? "jar";
  const parts = pair[0]?.split(":") ?? [];
  requireMetadata((parts.length === 3 || parts.length === 4) && /^[\w.-]+$/.test(extension));
  const [group, artifact, version3, classifier] = parts;
  requireMetadata(group !== void 0 && artifact !== void 0 && version3 !== void 0 && /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(group) && [artifact, version3, classifier].filter((part) => part !== void 0).every((part) => /^[A-Za-z0-9_.+-]+$/.test(part) && part !== "." && part !== ".."));
  return `${group.replaceAll(".", "/")}/${artifact}/${version3}/${artifact}-${version3}${classifier === void 0 ? "" : `-${classifier}`}.${extension}`;
}
function trustedArtifact(value, coordinate2, paths) {
  const artifact = parseArtifact(value);
  requireMetadata(artifact.path === mavenPath(coordinate2));
  let url;
  try {
    url = new URL(artifact.url);
  } catch {
    requireMetadata(false);
  }
  const prefix = paths[url.hostname];
  requireMetadata(prefix !== void 0 && !url.port && !url.search && !url.hash && url.pathname === `${prefix}/${artifact.path}`);
  return { coordinate: coordinate2, path: artifact.path, url: artifact.url, sha1: artifact.sha1, size: artifact.size };
}
function library(value, paths) {
  requireMetadata(record(value) && bounded(value.name, 256) && record(value.downloads));
  return trustedArtifact(value.downloads.artifact, value.name, paths);
}
function dataValue(value) {
  requireMetadata(bounded(value, 512));
  const artifact = /^\[([^\]]+)\]$/.exec(value);
  if (artifact?.[1] !== void 0) return { kind: "artifact", coordinate: artifact[1], path: mavenPath(artifact[1]) };
  if (/^\/data\/[A-Za-z0-9_.+-]{1,160}$/.test(value)) return { kind: "embedded", entry: value.slice(1) };
  const literal = /^'([A-Za-z0-9_.+-]{1,160})'$/.exec(value);
  requireMetadata(literal?.[1] !== void 0);
  return { kind: "literal", value: literal[1] };
}
function placeholders(value) {
  return [...value.matchAll(/\{([A-Z][A-Z0-9_]{0,63})\}/g)].map((match) => match[1]);
}
function processor(value, libraries, allowed) {
  requireMetadata(record(value) && bounded(value.jar, 256) && libraries.has(value.jar) && Array.isArray(value.classpath) && value.classpath.length <= 32 && value.classpath.every((item) => bounded(item, 256) && libraries.has(item)) && Array.isArray(value.args) && value.args.length <= 128 && value.args.every((item) => bounded(item)));
  if (value.sides !== void 0) requireMetadata(Array.isArray(value.sides) && value.sides.length >= 1 && value.sides.length <= 2 && new Set(value.sides).size === value.sides.length && value.sides.every((side) => side === "client" || side === "server"));
  const outputs = {};
  if (value.outputs !== void 0) {
    requireMetadata(record(value.outputs) && Object.keys(value.outputs).length <= 32);
    for (const [key, digest3] of Object.entries(value.outputs)) {
      requireMetadata(/^\{[A-Z][A-Z0-9_]{0,63}\}$/.test(key) && bounded(digest3, 160) && placeholders(key).every((item) => allowed.has(item)) && placeholders(digest3).every((item) => allowed.has(item)));
      outputs[key] = digest3;
    }
  }
  const args = value.args;
  requireMetadata(args.every((argument) => placeholders(argument).every((item) => allowed.has(item))));
  return { tool: value.jar, classpath: [...value.classpath], arguments: [...args], outputs };
}
function versionDescriptor(value, expected, minecraft, paths) {
  const parsed = parseClientVersion(value);
  requireMetadata(parsed.id === expected && parsed.inheritsFrom === minecraft && parsed.mainClass === "cpw.mods.bootstraplauncher.BootstrapLauncher" && parsed.downloads === void 0 && parsed.assetIndex === void 0 && parsed.javaVersion === void 0 && parsed.minecraftArguments === void 0 && parsed.libraries !== void 0);
  const names = /* @__PURE__ */ new Set();
  const artifactPaths = /* @__PURE__ */ new Set();
  for (const item of parsed.libraries) {
    requireMetadata(item.downloads?.artifact !== void 0 && item.downloads.classifiers === void 0 && item.natives === void 0 && item.extract === void 0);
    const artifact = trustedArtifact({ ...item.downloads.artifact, path: item.downloads.artifact.path ?? mavenPath(item.name) }, item.name, paths);
    requireMetadata(!names.has(item.name) && !artifactPaths.has(artifact.path));
    names.add(item.name);
    artifactPaths.add(artifact.path);
  }
  return parsed;
}
function parseInstallerProfile(kind, minecraftVersion, loaderVersion, profileValue, versionValue) {
  requireMetadata((kind === "forge" || kind === "neoforge") && identifier(minecraftVersion) && identifier(loaderVersion) && record(profileValue));
  const facts = FACTS[kind];
  const expected = facts.version(minecraftVersion, loaderVersion);
  requireMetadata(profileValue.spec === 1 && profileValue.profile === facts.profile && profileValue.version === expected && profileValue.minecraft === minecraftVersion && record(profileValue.data) && Object.keys(profileValue.data).length <= 64 && Array.isArray(profileValue.libraries) && profileValue.libraries.length <= 256 && Array.isArray(profileValue.processors) && profileValue.processors.length <= 32);
  const libraries = profileValue.libraries.map((value) => library(value, facts.paths));
  const names = new Set(libraries.map((item) => item.coordinate));
  requireMetadata(names.size === libraries.length && new Set(libraries.map((item) => item.path)).size === libraries.length);
  const data = {};
  for (const [key, raw] of Object.entries(profileValue.data)) {
    requireMetadata(/^[A-Z][A-Z0-9_]{0,63}$/.test(key) && record(raw) && raw.client !== void 0);
    data[key] = dataValue(raw.client);
  }
  requireMetadata(REQUIRED_DATA.every((key) => data[key] !== void 0));
  const allowed = /* @__PURE__ */ new Set([...Object.keys(data), ...BUILTIN_PLACEHOLDERS]);
  const processors = profileValue.processors.flatMap((value) => {
    requireMetadata(record(value));
    if (Array.isArray(value.sides) && !value.sides.includes("client")) return [];
    return [processor(value, names, allowed)];
  });
  requireMetadata(processors.length >= 1);
  return {
    kind,
    minecraftVersion,
    loaderVersion,
    version: versionDescriptor(versionValue, expected, minecraftVersion, facts.paths),
    libraries,
    data,
    processors
  };
}

// src/core/loaders/processor-policy.ts
var ROLES = [
  "extract-mappings",
  "download-mojang-mappings",
  "merge-mappings",
  "split-client",
  "rename-client",
  "apply-client-patches"
];
var TOOL_PATTERNS = {
  forge: [
    /^net\.minecraftforge:installertools:[A-Za-z0-9_.+-]+$/,
    /^net\.minecraftforge:installertools:[A-Za-z0-9_.+-]+$/,
    /^net\.minecraftforge:installertools:[A-Za-z0-9_.+-]+$/,
    /^net\.minecraftforge:jarsplitter:[A-Za-z0-9_.+-]+$/,
    /^net\.minecraftforge:ForgeAutoRenamingTool:[A-Za-z0-9_.+-]+:all$/,
    /^net\.minecraftforge:binarypatcher:[A-Za-z0-9_.+-]+$/
  ],
  neoforge: [
    /^net\.neoforged\.installertools:installertools:[A-Za-z0-9_.+-]+$/,
    /^net\.neoforged\.installertools:installertools:[A-Za-z0-9_.+-]+$/,
    /^net\.neoforged\.installertools:installertools:[A-Za-z0-9_.+-]+$/,
    /^net\.neoforged\.installertools:jarsplitter:[A-Za-z0-9_.+-]+$/,
    /^net\.neoforged:AutoRenamingTool:[A-Za-z0-9_.+-]+:all$/,
    /^net\.neoforged\.installertools:binarypatcher:[A-Za-z0-9_.+-]+:fatjar$/
  ]
};
function same(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}
function outputPolicy(kind, index, outputs) {
  const entries = Object.entries(outputs);
  if (kind === "forge" && index === 3) return entries.length === 2 && outputs["{MC_SLIM}"] === "{MC_SLIM_SHA}" && outputs["{MC_EXTRA}"] === "{MC_EXTRA_SHA}";
  return entries.length === 0;
}
function expectedArguments(kind, minecraft, input) {
  return [
    ["--task", "MCP_DATA", "--input", input, "--output", "{MAPPINGS}", "--key", "mappings"],
    ["--task", "DOWNLOAD_MOJMAPS", "--version", minecraft, "--side", "{SIDE}", "--output", "{MOJMAPS}"],
    [
      "--task",
      "MERGE_MAPPING",
      "--left",
      "{MAPPINGS}",
      "--right",
      "{MOJMAPS}",
      "--output",
      "{MERGED_MAPPINGS}",
      "--classes",
      ...kind === "neoforge" ? ["--fields", "--methods"] : [],
      "--reverse-right"
    ],
    ["--input", "{MINECRAFT_JAR}", "--slim", "{MC_SLIM}", "--extra", "{MC_EXTRA}", "--srg", "{MERGED_MAPPINGS}"],
    [
      "--input",
      "{MC_SLIM}",
      "--output",
      "{MC_SRG}",
      "--names",
      "{MERGED_MAPPINGS}",
      "--ann-fix",
      "--ids-fix",
      "--src-fix",
      "--record-fix"
    ],
    ["--clean", "{MC_SRG}", "--output", "{PATCHED}", "--apply", "{BINPATCH}"]
  ];
}
function mappingInput(kind, minecraft, processor2, libraries) {
  const value = processor2.arguments[3];
  requireMetadata(value !== void 0 && /^\[[^\]]+@zip\]$/.test(value));
  const coordinate2 = value.slice(1, -1);
  const prefix = kind === "forge" ? `de.oceanlabs.mcp:mcp_config:${minecraft}-` : `net.neoforged:neoform:${minecraft}-`;
  requireMetadata(coordinate2.startsWith(prefix) && libraries.some((item) => item.coordinate === coordinate2));
  return value;
}
function enforceInstallerProcessorPolicy(profile) {
  requireMetadata(profile.processors.length === ROLES.length);
  const input = mappingInput(profile.kind, profile.minecraftVersion, profile.processors[0], profile.libraries);
  const expected = expectedArguments(profile.kind, profile.minecraftVersion, input);
  return profile.processors.map((processor2, index) => {
    requireMetadata(TOOL_PATTERNS[profile.kind][index].test(processor2.tool) && same(processor2.arguments, expected[index]) && processor2.classpath.length >= 1 && processor2.classpath.length <= 32 && new Set(processor2.classpath).size === processor2.classpath.length && outputPolicy(profile.kind, index, processor2.outputs));
    return {
      ...processor2,
      classpath: [...processor2.classpath],
      arguments: [...processor2.arguments],
      outputs: { ...processor2.outputs },
      role: ROLES[index]
    };
  });
}

// src/core/loaders/processor-manifest.ts
var MAIN_CLASSES = {
  forge: {
    "extract-mappings": "net.minecraftforge.installertools.ConsoleTool",
    "download-mojang-mappings": "net.minecraftforge.installertools.ConsoleTool",
    "merge-mappings": "net.minecraftforge.installertools.ConsoleTool",
    "split-client": "net.minecraftforge.jarsplitter.ConsoleTool",
    "rename-client": "net.minecraftforge.fart.Main",
    "apply-client-patches": "net.minecraftforge.binarypatcher.ConsoleTool"
  },
  neoforge: {
    "extract-mappings": "net.neoforged.installertools.ConsoleTool",
    "download-mojang-mappings": "net.neoforged.installertools.ConsoleTool",
    "merge-mappings": "net.neoforged.installertools.ConsoleTool",
    "split-client": "net.neoforged.jarsplitter.ConsoleTool",
    "rename-client": "net.neoforged.art.Main",
    "apply-client-patches": "net.neoforged.binarypatcher.ConsoleTool"
  }
};
function requireProcessorMainClass(kind, role, value) {
  requireMetadata(value === MAIN_CLASSES[kind][role]);
  return value;
}

// src/services/loaders/installer-compose.ts
var import_node_crypto5 = require("node:crypto");
function parseStoredInstallerProfile(kind, minecraftVersion, loaderVersion, profileBody, profileSha256, versionBody, versionSha256) {
  if (typeof profileBody !== "string" || Buffer.byteLength(profileBody) > 2 * 1024 ** 2 || !/^[a-f0-9]{64}$/.test(profileSha256) || (0, import_node_crypto5.createHash)("sha256").update(profileBody).digest("hex") !== profileSha256 || typeof versionBody !== "string" || Buffer.byteLength(versionBody) > 2 * 1024 ** 2 || !/^[a-f0-9]{64}$/.test(versionSha256) || (0, import_node_crypto5.createHash)("sha256").update(versionBody).digest("hex") !== versionSha256) throw new Error("INVALID_INSTALLER_PROFILE");
  try {
    return parseInstallerProfile(kind, minecraftVersion, loaderVersion, JSON.parse(profileBody), JSON.parse(versionBody));
  } catch {
    throw new Error("INVALID_INSTALLER_PROFILE");
  }
}
function addProcessorLibraries(plan, profile, source) {
  const artifacts = new Map(plan.artifacts.map((item) => [item.artifactId, { ...item, proofs: [...item.proofs], alternateUrls: [...item.alternateUrls] }]));
  const views = new Map(plan.views.map((item) => [`${item.area}:${item.path.toLowerCase()}`, { ...item }]));
  let totalBytes = plan.totalBytes;
  for (const library2 of profile.libraries) {
    const artifactId = `sha1-${library2.sha1}`;
    const proof = { source, provenanceId: `loader:${source.digest}:${library2.sha1}` };
    const existing = artifacts.get(artifactId);
    if (existing) {
      if (existing.size !== library2.size) throw new Error("INSTALLER_LIBRARY_CONFLICT");
      if (existing.url !== library2.url && !existing.alternateUrls.includes(library2.url)) existing.alternateUrls.push(library2.url);
      if (!existing.proofs.some((item) => item.provenanceId === proof.provenanceId)) existing.proofs.push(proof);
    } else {
      const artifact = {
        artifactId,
        url: library2.url,
        sha1: library2.sha1,
        size: library2.size,
        ...proof,
        proofs: [proof],
        alternateUrls: []
      };
      artifacts.set(artifactId, artifact);
      totalBytes += library2.size;
      if (!Number.isSafeInteger(totalBytes)) throw new Error("INSTALLER_LIBRARY_LIMIT");
    }
    const key = `libraries:${library2.path.toLowerCase()}`;
    const old = views.get(key);
    if (old && old.artifactId !== artifactId || old && old.path !== library2.path) throw new Error("INSTALLER_LIBRARY_CONFLICT");
    views.set(key, { area: "libraries", path: library2.path, artifactId });
  }
  return { ...plan, artifacts: [...artifacts.values()], views: [...views.values()], totalBytes };
}
function composeInstallerInstall(input) {
  enforceInstallerProcessorPolicy(input.profile);
  if (!Object.hasOwn(input.baseVersionDocuments, input.profile.minecraftVersion) || !/^[a-f0-9]{64}$/.test(input.profileSha256)) {
    throw new Error("INVALID_INSTALLER_BASE");
  }
  const documents = Object.fromEntries(Object.entries(input.baseVersionDocuments).map(([id2, body]) => {
    try {
      return [id2, JSON.parse(body)];
    } catch {
      throw new Error("INVALID_INSTALLER_BASE");
    }
  }));
  if (Object.hasOwn(documents, input.profile.version.id)) throw new Error("INVALID_INSTALLER_BASE");
  documents[input.profile.version.id] = input.profile.version;
  const source = { kind: "loader-profile", algorithm: "sha256", digest: input.profileSha256 };
  const proof = { ...input.baseMetadataSha1ByVersion, [input.profile.version.id]: source };
  const version3 = resolveClientVersion(input.profile.version.id, documents, input.environment);
  const artifactProofs = {};
  for (const library2 of input.profile.libraries) artifactProofs[artifactProofKey({ url: library2.url, sha1: library2.sha1 })] = [source];
  const plan = addProcessorLibraries(planVanillaInstall(version3, proof, input.assets, artifactProofs), input.profile, source);
  return { version: version3, plan, loaderDocument: JSON.stringify(input.profile.version), metadataProofByVersion: proof };
}

// src/services/loaders/installer-artifact.ts
function installerArtifactUrl(kind, minecraftVersion, loaderVersion) {
  if (kind === "forge" && minecraftVersion === "1.20.1" && /^47\.\d+\.\d+$/.test(loaderVersion)) {
    const version3 = `${minecraftVersion}-${loaderVersion}`;
    return `https://maven.minecraftforge.net/net/minecraftforge/forge/${version3}/forge-${version3}-installer.jar`;
  }
  if (kind === "neoforge" && minecraftVersion === "1.21.1" && /^21\.1\.\d+$/.test(loaderVersion)) {
    return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;
  }
  throw new LoaderMavenError("INVALID_METADATA");
}

// src/services/storage/instance-records.ts
function invalid5() {
  throw new StorageError("INVALID_RECORD");
}
function object(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function uuid7(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
function integer4(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function budget(value) {
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_RECORD_BYTES - 128) invalid5();
}
var ARTIFACT = /^sha1-[a-f0-9]{40}$/;
function parseInstanceSummary(value) {
  if (!exactObject(value, ["instanceId", "rootId", "taskId", "displayName", "mcVersionId", "isolation", "state", "revision"]) || !uuid7(value.instanceId) || !uuid7(value.rootId) || !uuid7(value.taskId) || typeof value.displayName !== "string" || value.displayName.length < 1 || value.displayName.length > 80 || value.displayName.trim() !== value.displayName || /[\p{C}]/u.test(value.displayName) || !identifier(value.mcVersionId) || typeof value.isolation !== "string" || !["inherit", "on", "off"].includes(value.isolation) || typeof value.state !== "string" || !["installing", "ready", "failed", "cancelled", "needsRecovery"].includes(value.state) || !integer4(value.revision) || value.revision < 1 || value.revision >= Number.MAX_SAFE_INTEGER) invalid5();
  return {
    instanceId: value.instanceId.toLowerCase(),
    rootId: value.rootId.toLowerCase(),
    taskId: value.taskId.toLowerCase(),
    displayName: value.displayName,
    mcVersionId: value.mcVersionId,
    isolation: value.isolation,
    state: value.state,
    revision: value.revision
  };
}
function parseInstanceIndex(value) {
  try {
    if (!exactObject(value, ["items"]) || !Array.isArray(value.items) || value.items.length > 1e3) invalid5();
    const items = value.items.map(parseInstanceSummary);
    const ids2 = new Set(items.map((item) => item.instanceId));
    if (ids2.size !== items.length) invalid5();
    const result2 = { items };
    budget(result2);
    return result2;
  } catch {
    return invalid5();
  }
}
function environment(value) {
  if (!exactObject(value, ["os", "arch", "osVersion", "features"]) || value.os !== "windows" || value.arch !== "x64" || typeof value.osVersion !== "string" || value.osVersion.length > 160 || /[\p{C}]/u.test(value.osVersion) || !object(value.features) || Object.keys(value.features).length > 64) invalid5();
  const features = Object.fromEntries(Object.entries(value.features).map(([key, enabled]) => {
    if (!/^[A-Za-z0-9_]{1,64}$/.test(key) || typeof enabled !== "boolean") invalid5();
    return [key, enabled];
  }));
  return { os: "windows", arch: "x64", osVersion: value.osVersion, features };
}
function profileLoaderMetadata(value, minecraftVersion, baseDocuments, baseProofs, assets, selectedEnvironment) {
  if (!exactObject(value, ["kind", "version", "profileBody", "profileSourceUrl", "profileSha256", "libraries"]) || value.kind !== "fabric" && value.kind !== "quilt" || !identifier(value.version) || !/^[a-zA-Z0-9_.+-]+$/.test(value.version) || typeof value.profileBody !== "string" || typeof value.profileSourceUrl !== "string" || typeof value.profileSha256 !== "string" || !isOfficialLoaderMetadataUrl(value.profileSourceUrl) || !Array.isArray(value.libraries) || value.libraries.length > 256) invalid5();
  const expectedSource = `https://meta.${value.kind === "fabric" ? "fabricmc.net/v2" : "quiltmc.org/v3"}/versions/loader/${minecraftVersion}/${value.version}/profile/json`;
  if (value.profileSourceUrl !== expectedSource) invalid5();
  let profile;
  try {
    profile = parseStoredLoaderProfile(value.kind, minecraftVersion, value.version, value.profileBody, value.profileSha256);
  } catch {
    return invalid5();
  }
  const libraries = value.libraries.map((entry, index) => {
    if (!exactObject(entry, ["path", "spec"]) || typeof entry.path !== "string" || !exactObject(entry.spec, ["url", "expected", "anchor"]) || typeof entry.spec.url !== "string" || !isArtifactUrl(entry.spec.url)) invalid5();
    const declared = profile.libraries[index];
    if (!declared || declared.path !== entry.path || declared.url !== entry.spec.url) invalid5();
    let facts;
    try {
      facts = definition(entry.spec.expected, entry.spec.anchor);
    } catch {
      return invalid5();
    }
    if (facts.expected.algorithm !== "sha1" || facts.expected.provenanceId !== `loader:${value.kind}:${facts.expected.digest}` || facts.anchor.kind !== "loader-profile" && facts.anchor.kind !== "loader-maven" || facts.anchor.algorithm !== "sha256" || declared.proof === "inline-sha1" && (facts.anchor.kind !== "loader-profile" || facts.anchor.digest !== value.profileSha256 || facts.expected.digest !== declared.sha1 || facts.expected.size !== declared.size) || declared.proof === "official-sidecar-required" && facts.anchor.kind !== "loader-maven") invalid5();
    return { path: entry.path, spec: { url: entry.spec.url, expected: facts.expected, anchor: facts.anchor } };
  });
  if (libraries.length !== profile.libraries.length) invalid5();
  const plan = { libraries, totalBytes: libraries.reduce((sum, entry) => sum + entry.spec.expected.size, 0) };
  if (!Number.isSafeInteger(plan.totalBytes)) invalid5();
  try {
    composeLoaderInstall({
      baseVersionDocuments: baseDocuments,
      baseMetadataSha1ByVersion: baseProofs,
      assets,
      profile,
      profileSha256: value.profileSha256,
      libraries: plan,
      environment: selectedEnvironment
    });
  } catch {
    return invalid5();
  }
  return {
    kind: value.kind,
    version: value.version,
    profileBody: value.profileBody,
    profileSourceUrl: value.profileSourceUrl,
    profileSha256: value.profileSha256,
    libraries
  };
}
function downloadSpec(value) {
  if (!exactObject(value, ["url", "expected", "anchor"]) || typeof value.url !== "string" || !isArtifactUrl(value.url)) invalid5();
  let facts;
  try {
    facts = definition(value.expected, value.anchor);
  } catch {
    return invalid5();
  }
  return { url: value.url, expected: facts.expected, anchor: facts.anchor };
}
function objectRef(value) {
  if (!exactObject(value, ["digest", "size", "sourceKey"]) || typeof value.digest !== "string" || !/^[a-f0-9]{64}$/.test(value.digest) || !integer4(value.size) || value.size < 1 || value.size > 64 * 1024 ** 2 || typeof value.sourceKey !== "string" || !/^[a-f0-9]{64}$/.test(value.sourceKey)) invalid5();
  return { digest: value.digest, size: value.size, sourceKey: value.sourceKey };
}
var PROCESSOR_OUTPUTS = {
  "extract-mappings": ["MAPPINGS"],
  "download-mojang-mappings": ["MOJMAPS"],
  "merge-mappings": ["MERGED_MAPPINGS"],
  "split-client": ["MC_SLIM", "MC_EXTRA"],
  "rename-client": ["MC_SRG"],
  "apply-client-patches": ["PATCHED"]
};
function installerLoaderMetadata(value, minecraftVersion, baseDocuments, baseProofs, assets, selectedEnvironment) {
  const hasProcessors = Object.hasOwn(value, "processors");
  if (!exactObject(value, [
    "kind",
    "version",
    "catalogSourceUrl",
    "catalogSha256",
    "installer",
    "profileBody",
    "profileSha256",
    "versionBody",
    "versionSha256",
    "libraries",
    ...hasProcessors ? ["processors"] : []
  ]) || value.kind !== "forge" && value.kind !== "neoforge" || !identifier(value.version) || typeof value.catalogSourceUrl !== "string" || !isOfficialLoaderMetadataUrl(value.catalogSourceUrl) || typeof value.catalogSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.catalogSha256) || typeof value.profileBody !== "string" || typeof value.profileSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.profileSha256) || (0, import_node_crypto6.createHash)("sha256").update(value.profileBody).digest("hex") !== value.profileSha256 || typeof value.versionBody !== "string" || typeof value.versionSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.versionSha256) || (0, import_node_crypto6.createHash)("sha256").update(value.versionBody).digest("hex") !== value.versionSha256 || !Array.isArray(value.libraries) || value.libraries.length > 256 || !object(value.installer)) invalid5();
  const expectedCatalog = value.kind === "forge" ? "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json" : "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";
  if (value.catalogSourceUrl !== expectedCatalog) invalid5();
  const installer = value.installer;
  if (!exactObject(installer, ["sourceUrl", "spec", "object"]) || typeof installer.sourceUrl !== "string" || installer.sourceUrl !== installerArtifactUrl(value.kind, minecraftVersion, value.version)) invalid5();
  const installerSpec = downloadSpec(installer.spec);
  const installerObject = objectRef(installer.object);
  if (installerSpec.url !== installer.sourceUrl || installerSpec.expected.algorithm !== "sha1" || installerSpec.expected.provenanceId !== `loader:${value.kind}:${installerSpec.expected.digest}` || installerSpec.anchor.kind !== "loader-maven" || installerSpec.anchor.algorithm !== "sha256" || installerObject.size !== installerSpec.expected.size || installerObject.sourceKey !== sourceKey(installerSpec.expected, installerSpec.anchor)) invalid5();
  let profile;
  try {
    profile = parseInstallerProfile(value.kind, minecraftVersion, value.version, JSON.parse(value.profileBody), JSON.parse(value.versionBody));
  } catch {
    return invalid5();
  }
  const libraries = value.libraries.map((entry, index) => {
    if (!exactObject(entry, ["path", "spec"]) || typeof entry.path !== "string") invalid5();
    const spec = downloadSpec(entry.spec);
    const declared = profile.libraries[index];
    if (!declared || entry.path !== declared.path || spec.url !== declared.url || spec.expected.algorithm !== "sha1" || spec.expected.digest !== declared.sha1 || spec.expected.size !== declared.size || spec.expected.provenanceId !== `loader:${value.kind}:${declared.sha1}` || spec.anchor.kind !== "loader-profile" || spec.anchor.algorithm !== "sha256" || spec.anchor.digest !== value.profileSha256) invalid5();
    return { path: entry.path, spec };
  });
  if (libraries.length !== profile.libraries.length) invalid5();
  const controlled = enforceInstallerProcessorPolicy(profile);
  let processors;
  if (hasProcessors) {
    if (!Array.isArray(value.processors) || value.processors.length !== controlled.length) invalid5();
    processors = value.processors.map((entry, index) => {
      const expected = controlled[index];
      if (!exactObject(entry, ["role", "tool", "mainClass", "outputs"]) || entry.role !== expected.role || entry.tool !== expected.tool || typeof entry.mainClass !== "string" || !Array.isArray(entry.outputs)) invalid5();
      try {
        requireProcessorMainClass(value.kind, expected.role, entry.mainClass);
      } catch {
        return invalid5();
      }
      const outputKeys = PROCESSOR_OUTPUTS[expected.role];
      if (entry.outputs.length !== outputKeys.length) invalid5();
      const parsedOutputs = entry.outputs.map((output, outputIndex) => {
        const key = outputKeys[outputIndex];
        const declared = profile.data[key];
        const proof = profile.data[`${key}_SHA`];
        if (!declared || declared.kind !== "artifact" || !exactObject(output, [
          "path",
          "size",
          "sha1",
          "sha256",
          ...Object.hasOwn(output, "upstreamSha1") ? ["upstreamSha1"] : []
        ]) || output.path !== declared.path || !integer4(output.size) || output.size < 1 || output.size > 1024 ** 3 || typeof output.sha1 !== "string" || !/^[a-f0-9]{40}$/.test(output.sha1) || typeof output.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(output.sha256)) invalid5();
        const upstream = proof?.kind === "literal" && /^[a-f0-9]{40}$/.test(proof.value) ? proof.value : void 0;
        if (upstream === void 0 !== (output.upstreamSha1 === void 0) || upstream !== void 0 && output.upstreamSha1 !== upstream || upstream !== void 0 && output.sha1 !== upstream) invalid5();
        return {
          path: output.path,
          size: output.size,
          sha1: output.sha1,
          sha256: output.sha256,
          ...upstream === void 0 ? {} : { upstreamSha1: upstream }
        };
      });
      return { role: expected.role, tool: expected.tool, mainClass: entry.mainClass, outputs: parsedOutputs };
    });
  }
  try {
    composeInstallerInstall({
      baseVersionDocuments: baseDocuments,
      baseMetadataSha1ByVersion: baseProofs,
      assets,
      profile,
      profileSha256: value.profileSha256,
      environment: selectedEnvironment
    });
  } catch {
    return invalid5();
  }
  return {
    kind: value.kind,
    version: value.version,
    catalogSourceUrl: value.catalogSourceUrl,
    catalogSha256: value.catalogSha256,
    installer: { sourceUrl: installer.sourceUrl, spec: installerSpec, object: installerObject },
    profileBody: value.profileBody,
    profileSha256: value.profileSha256,
    versionBody: value.versionBody,
    versionSha256: value.versionSha256,
    libraries,
    ...processors === void 0 ? {} : { processors }
  };
}
function loaderMetadata(value, minecraftVersion, baseDocuments, baseProofs, assets, selectedEnvironment) {
  if (!object(value) || typeof value.kind !== "string") invalid5();
  return value.kind === "fabric" || value.kind === "quilt" ? profileLoaderMetadata(value, minecraftVersion, baseDocuments, baseProofs, assets, selectedEnvironment) : installerLoaderMetadata(value, minecraftVersion, baseDocuments, baseProofs, assets, selectedEnvironment);
}
function metadata(value, versionId) {
  const hasEnvironment = object(value) && Object.hasOwn(value, "environment");
  const hasLoader = object(value) && Object.hasOwn(value, "loader");
  if (!exactObject(value, ["versionDocuments", "metadataSha1ByVersion", "assetIndexBody", ...hasEnvironment ? ["environment"] : [], ...hasLoader ? ["loader"] : []]) || !object(value.versionDocuments) || !object(value.metadataSha1ByVersion) || typeof value.assetIndexBody !== "string") invalid5();
  const entries = Object.entries(value.versionDocuments);
  const hashes = Object.entries(value.metadataSha1ByVersion);
  if (entries.length === 0 || entries.length > 32 || hashes.length !== entries.length) invalid5();
  let bytes = Buffer.byteLength(value.assetIndexBody);
  if (bytes > 2 * 1024 ** 2) invalid5();
  const documents = [];
  const sha1s = [];
  const parsed = [];
  for (const [id2, body] of entries) {
    const sha1 = value.metadataSha1ByVersion[id2];
    if (!identifier(id2) || typeof body !== "string") invalid5();
    bytes += Buffer.byteLength(body);
    if (bytes > 2 * 1024 ** 2) invalid5();
    if (!Object.hasOwn(value.metadataSha1ByVersion, id2) || typeof sha1 !== "string" || !/^[a-f0-9]{40}$/.test(sha1) || (0, import_node_crypto6.createHash)("sha1").update(body).digest("hex") !== sha1) invalid5();
    documents.push([id2, body]);
    sha1s.push([id2, sha1]);
    parsed.push([id2, JSON.parse(body)]);
  }
  const selectedEnvironment = hasEnvironment ? environment(value.environment) : void 0;
  const resolved = resolveClientVersion(versionId, Object.fromEntries(parsed), selectedEnvironment ?? { os: "windows", arch: "x64", osVersion: "10.0", features: {} });
  if (resolved.ancestry.length !== entries.length || !resolved.assetIndex || Buffer.byteLength(value.assetIndexBody) !== resolved.assetIndex.size || (0, import_node_crypto6.createHash)("sha1").update(value.assetIndexBody).digest("hex") !== resolved.assetIndex.sha1) invalid5();
  const assetIndex = parseAssetIndex(JSON.parse(value.assetIndexBody));
  planVanillaInstall(resolved, Object.fromEntries(sha1s), assetIndex);
  if (hasLoader && selectedEnvironment === void 0) invalid5();
  const parsedLoader = hasLoader ? loaderMetadata(value.loader, versionId, Object.fromEntries(documents), Object.fromEntries(sha1s), assetIndex, selectedEnvironment) : void 0;
  return {
    versionDocuments: Object.fromEntries(documents),
    metadataSha1ByVersion: Object.fromEntries(sha1s),
    assetIndexBody: value.assetIndexBody,
    ...selectedEnvironment === void 0 ? {} : { environment: selectedEnvironment },
    ...parsedLoader === void 0 ? {} : { loader: parsedLoader }
  };
}
function objects(value) {
  if (!object(value) || Object.keys(value).length > 1e5) invalid5();
  return Object.fromEntries(Object.entries(value).map(([id2, entry]) => {
    if (!ARTIFACT.test(id2) || !exactObject(entry, ["digest", "size", "sourceKey"]) || typeof entry.digest !== "string" || !/^[a-f0-9]{64}$/.test(entry.digest) || !integer4(entry.size) || entry.size > 64 * 1024 ** 3 || typeof entry.sourceKey !== "string" || !/^[a-f0-9]{64}$/.test(entry.sourceKey)) invalid5();
    return [id2, { digest: entry.digest, size: entry.size, sourceKey: entry.sourceKey }];
  }));
}
function receipts(value, refs) {
  if (!Array.isArray(value) || value.length > 2e5) invalid5();
  const seen = /* @__PURE__ */ new Set();
  const parents = /* @__PURE__ */ new Set();
  return value.map((entry) => {
    if (!exactObject(entry, ["area", "path", "artifactId", "mode"]) || typeof entry.area !== "string" || !["assets", "libraries", "version", "resources"].includes(entry.area) || typeof entry.path !== "string" || typeof entry.artifactId !== "string" || !ARTIFACT.test(entry.artifactId) || !Object.hasOwn(refs, entry.artifactId) || typeof entry.mode !== "string" || !["copy", "symlink"].includes(entry.mode)) invalid5();
    const name2 = installRelativePath(entry.path);
    const key = `${entry.area}:${name2.toLowerCase()}`;
    if (seen.has(key) || parents.has(key)) invalid5();
    seen.add(key);
    const parts = name2.toLowerCase().split("/");
    parts.pop();
    while (parts.length) {
      const parent = `${entry.area}:${parts.join("/")}`;
      if (seen.has(parent)) invalid5();
      parents.add(parent);
      parts.pop();
    }
    return { area: entry.area, path: name2, artifactId: entry.artifactId, mode: entry.mode };
  });
}
function loader(value) {
  if (exactObject(value, ["kind"]) && value.kind === "vanilla") return { kind: "vanilla" };
  if (!exactObject(value, ["kind", "version"]) || typeof value.kind !== "string" || !["fabric", "quilt", "forge", "neoforge"].includes(value.kind) || !identifier(value.version) || !/^[a-zA-Z0-9_.+-]+$/.test(value.version)) invalid5();
  return { kind: value.kind, version: value.version };
}
function parseInstanceRecord(value) {
  try {
    if (!object(value)) invalid5();
    budget(value);
    const versioned = Object.hasOwn(value, "formatVersion") || Object.hasOwn(value, "loader");
    if (versioned && (!Object.hasOwn(value, "formatVersion") || !Object.hasOwn(value, "loader") || value.formatVersion !== 2)) invalid5();
    const optional = ["formatVersion", "loader", "metadata", "objects", "receipts", "modCommitId"].filter((key) => Object.hasOwn(value, key));
    if (!exactObject(value, ["summary", "phase", ...optional])) invalid5();
    const summary = parseInstanceSummary(value.summary);
    const phase = value.phase;
    if (typeof phase !== "string" || !["reserved", "prepared", "downloaded", "materializing", "ready", "failed", "cancelled", "needsRecovery"].includes(phase) || summary.state !== (["reserved", "prepared", "downloaded", "materializing"].includes(phase) ? "installing" : phase)) invalid5();
    const parsedMetadata = value.metadata === void 0 ? void 0 : metadata(value.metadata, summary.mcVersionId);
    const parsedLoader = versioned ? loader(value.loader) : { kind: "vanilla" };
    if (Object.hasOwn(value, "modCommitId") && (!versioned || !uuid7(value.modCommitId) || phase !== "ready" || parsedLoader.kind === "vanilla")) invalid5();
    const parsedObjects = value.objects === void 0 ? void 0 : objects(value.objects);
    const parsedReceipts = value.receipts === void 0 ? void 0 : receipts(value.receipts, parsedObjects ?? {});
    const metadataLoader = parsedMetadata?.loader;
    if (phase === "ready" && (metadataLoader?.kind === "forge" || metadataLoader?.kind === "neoforge") && !metadataLoader.processors) invalid5();
    if (metadataLoader !== void 0) {
      if (parsedLoader.kind === "vanilla" || parsedLoader.kind !== metadataLoader.kind || parsedLoader.version !== metadataLoader.version) invalid5();
    } else if (parsedLoader.kind !== "vanilla" && ["prepared", "downloaded", "materializing", "ready"].includes(phase)) invalid5();
    if (["prepared", "downloaded", "materializing", "ready"].includes(phase) && !parsedMetadata || ["downloaded", "materializing", "ready"].includes(phase) && !parsedObjects || phase === "ready" && (!parsedReceipts || !parsedObjects || Object.keys(parsedObjects).length === 0 || parsedReceipts.length === 0) || parsedObjects && !parsedMetadata || parsedReceipts && !parsedObjects || optional.some((key) => value[key] === void 0)) invalid5();
    const result2 = {
      formatVersion: 2,
      loader: parsedLoader,
      summary,
      phase,
      ...parsedMetadata === void 0 ? {} : { metadata: parsedMetadata },
      ...parsedObjects === void 0 ? {} : { objects: parsedObjects },
      ...parsedReceipts === void 0 ? {} : { receipts: parsedReceipts },
      ...value.modCommitId === void 0 ? {} : { modCommitId: value.modCommitId.toLowerCase() }
    };
    budget(result2);
    return result2;
  } catch {
    return invalid5();
  }
}

// src/services/storage/launch-profiles.ts
var import_node_crypto7 = require("node:crypto");
var import_node_path2 = __toESM(require("node:path"), 1);
function invalid6() {
  throw new StorageError("INVALID_RECORD");
}
function uuid8(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
function validGameName(value) {
  return typeof value === "string" && /^[A-Za-z0-9_]{3,16}$/.test(value);
}
function offlineUuid(gameName) {
  if (!validGameName(gameName)) invalid6();
  const bytes = (0, import_node_crypto7.createHash)("md5").update(`OfflinePlayer:${gameName}`, "utf8").digest();
  bytes[6] = bytes[6] & 15 | 48;
  bytes[8] = bytes[8] & 63 | 128;
  const hex3 = bytes.toString("hex");
  return `${hex3.slice(0, 8)}-${hex3.slice(8, 12)}-${hex3.slice(12, 16)}-${hex3.slice(16, 20)}-${hex3.slice(20)}`;
}
function parseLaunchProfiles(value) {
  if (!exactObject(value, ["javas", "accounts", "requests", ...value && typeof value === "object" && "selectedJavaId" in value ? ["selectedJavaId"] : []]) || !Array.isArray(value.javas) || value.javas.length > 32 || !Array.isArray(value.accounts) || value.accounts.length > 1e3 || !Array.isArray(value.requests) || value.requests.length > 2048 || Object.hasOwn(value, "selectedJavaId") && value.selectedJavaId === void 0) invalid6();
  const javas = value.javas.map((entry) => {
    if (!exactObject(entry, ["javaId", "executable", "major", "version", "vendor"]) || !uuid8(entry.javaId) || typeof entry.executable !== "string" || ![8, 17, 21].includes(entry.major) || typeof entry.version !== "string" || !/^[A-Za-z0-9_.+-]{1,80}$/.test(entry.version) || typeof entry.vendor !== "string" || entry.vendor.length < 1 || entry.vendor.length > 160 || /[\p{C}]/u.test(entry.vendor)) invalid6();
    let executable;
    try {
      executable = normalizeDataDirectory(entry.executable);
    } catch {
      invalid6();
    }
    if (import_node_path2.default.win32.basename(executable).toLowerCase() !== "java.exe") invalid6();
    return { javaId: entry.javaId, executable, major: entry.major, version: entry.version, vendor: entry.vendor };
  });
  const accounts = value.accounts.map((entry) => {
    if (!exactObject(entry, ["accountId", "displayName", "gameName", "uuid"]) || !uuid8(entry.accountId) || typeof entry.displayName !== "string" || entry.displayName.trim() !== entry.displayName || entry.displayName.length < 1 || entry.displayName.length > 80 || /[\p{C}]/u.test(entry.displayName) || !validGameName(entry.gameName) || entry.uuid !== offlineUuid(entry.gameName)) invalid6();
    return { accountId: entry.accountId, displayName: entry.displayName, gameName: entry.gameName, uuid: entry.uuid };
  });
  const requests = value.requests.map((entry) => {
    if (!exactObject(entry, ["requestId", "digest", "accountId"]) || !uuid8(entry.requestId) || !uuid8(entry.accountId) || typeof entry.digest !== "string" || !/^[a-f0-9]{64}$/.test(entry.digest) || !accounts.some((account) => account.accountId === entry.accountId)) invalid6();
    return { requestId: entry.requestId, digest: entry.digest, accountId: entry.accountId };
  });
  if (new Set(javas.map((java) => java.javaId)).size !== javas.length || new Set(javas.map((java) => java.executable.toLowerCase())).size !== javas.length || new Set(accounts.map((account) => account.accountId)).size !== accounts.length || new Set(accounts.map((account) => account.gameName)).size !== accounts.length || new Set(requests.map((request) => request.requestId)).size !== requests.length || value.selectedJavaId !== void 0 && !javas.some((java) => java.javaId === value.selectedJavaId)) invalid6();
  return { javas, accounts, requests, ...value.selectedJavaId === void 0 ? {} : { selectedJavaId: value.selectedJavaId } };
}

// src/services/storage/game-sessions.ts
var LAUNCH_ERRORS = ["LAUNCH_FAILED", "JAVA_INCOMPATIBLE", "AUTH_REQUIRED", "DEPENDENCY_MISSING", "MEMORY_OUT_OF_RANGE", "INSTANCE_BUSY", "REVISION_CONFLICT", "NEEDS_RECOVERY", "CANCELLED", "STOP_UNSUPPORTED", "CONFIRMATION_REQUIRED"];
var uuid9 = (x) => typeof x === "string" && UUID_PATTERN.test(x);
function invalid7() {
  throw new StorageError("INVALID_RECORD");
}
function parseGameSessions(value) {
  if (!exactObject(value, ["items"]) || !Array.isArray(value.items) || value.items.length > 1e3) invalid7();
  const items = value.items.map((entry) => {
    if (!exactObject(entry, ["rootId", "taskId", "snapshot", "spawned", "stopTaskIds", ...entry && typeof entry === "object" && "errors" in entry ? ["errors"] : []]) || !uuid9(entry.rootId) || !uuid9(entry.taskId) || !Array.isArray(entry.stopTaskIds) || entry.stopTaskIds.length > 16 || !entry.stopTaskIds.every(uuid9) || typeof entry.spawned !== "boolean") invalid7();
    const taskIds = [entry.taskId, ...entry.stopTaskIds];
    const errors = Object.hasOwn(entry, "errors") ? (() => {
      if (!Array.isArray(entry.errors) || entry.errors.length > 17) invalid7();
      const parsed = entry.errors.map((item) => {
        if (!exactObject(item, ["taskId", "code"]) || !uuid9(item.taskId) || !taskIds.includes(item.taskId) || !LAUNCH_ERRORS.includes(item.code)) invalid7();
        return { taskId: item.taskId, code: item.code };
      });
      if (new Set(parsed.map((item) => item.taskId)).size !== parsed.length) invalid7();
      return parsed;
    })() : void 0;
    const snapshot = entry.snapshot;
    if (!exactObject(snapshot, ["sessionId", "instanceId", "state", "revision", "startedAt", ...snapshot && typeof snapshot === "object" && "exitCode" in snapshot ? ["exitCode"] : []]) || snapshot.sessionId !== entry.taskId || !uuid9(snapshot.instanceId) || !["running", "stopping", "exited", "unknown"].includes(snapshot.state) || typeof snapshot.revision !== "number" || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1 || typeof snapshot.startedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(snapshot.startedAt) || !Number.isFinite(Date.parse(snapshot.startedAt)) || Object.hasOwn(snapshot, "exitCode") && (typeof snapshot.exitCode !== "number" || !Number.isSafeInteger(snapshot.exitCode) || snapshot.state !== "exited")) invalid7();
    if (!entry.spawned && snapshot.state !== "unknown") invalid7();
    return {
      rootId: entry.rootId,
      taskId: entry.taskId,
      snapshot,
      spawned: entry.spawned,
      stopTaskIds: entry.stopTaskIds,
      ...errors === void 0 ? {} : { errors }
    };
  });
  const ids2 = items.flatMap((item) => [item.taskId, ...item.stopTaskIds]);
  if (new Set(ids2).size !== ids2.length) invalid7();
  return { items };
}

// src/services/resources/modrinth.ts
var LIMIT = 8 * 1024 * 1024;
function isModrinthFileUrl(x) {
  if (typeof x !== "string" || x.length > 2048) return false;
  try {
    const u = new URL(x);
    return u.protocol === "https:" && u.hostname === "cdn.modrinth.com" && !u.port && !u.username && !u.password && !u.search && !u.hash && /^\/data\/[a-zA-Z0-9]{8}\/(?:versions\/)?/.test(u.pathname);
  } catch {
    return false;
  }
}

// src/services/storage/resources.ts
function parseResourceLibrary(x) {
  if (!exactObject(x, ["rootId", "items"]) || typeof x.rootId !== "string" || !UUID_PATTERN.test(x.rootId) || !Array.isArray(x.items) || x.items.length > 512) throw new StorageError("INVALID_RECORD");
  const items = x.items.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new StorageError("INVALID_RECORD");
    const row = item;
    const { spec, object: object4, ...summary } = row;
    if (!isLibraryItem(summary) || !exactObject(spec, ["url", "expected", "anchor"]) || !isModrinthFileUrl(spec.url)) throw new StorageError("INVALID_RECORD");
    const canonical = definition(spec.expected, spec.anchor);
    if (canonical.anchor.kind !== "modrinth-version" || canonical.expected.algorithm !== "sha1" || canonical.expected.size !== summary.size || canonical.expected.digest !== summary.fileId || canonical.expected.provenanceId !== `modrinth:${summary.projectId}:${summary.versionId}:${canonical.expected.digest}`) throw new StorageError("INVALID_RECORD");
    if (object4 !== void 0 && (!exactObject(object4, ["digest", "size", "sourceKey"]) || typeof object4.digest !== "string" || !/^[a-f0-9]{64}$/.test(object4.digest) || object4.size !== summary.size || typeof object4.sourceKey !== "string" || !/^[a-f0-9]{64}$/.test(object4.sourceKey))) throw new StorageError("INVALID_RECORD");
    if (summary.downloaded && !object4) throw new StorageError("INVALID_RECORD");
    return { ...summary, spec: { url: spec.url, ...canonical }, ...object4 === void 0 ? {} : { object: object4 } };
  });
  if (new Set(items.map((item) => item.taskId)).size !== items.length) throw new StorageError("INVALID_RECORD");
  return { rootId: x.rootId, items };
}

// src/shared/contracts/desktop.ts
var validIcon = (x) => typeof x === "string" && (x === "" || x.length <= 18e4 && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(x));
var color = (x) => typeof x === "string" && /^#[a-fA-F0-9]{6}$/.test(x);
var uuid10 = (x) => typeof x === "string" && UUID_PATTERN.test(x);
function isAppearance(x) {
  return exactObject(x, ["accent", "background", "surface", "ink", "icon", "sidebarCollapsed", "density", "layout", "homeOrder", "homeHidden"]) && color(x.accent) && color(x.background) && color(x.surface) && color(x.ink) && validIcon(x.icon) && typeof x.sidebarCollapsed === "boolean" && ["comfortable", "compact"].includes(x.density) && ["balanced", "profile-left"].includes(x.layout) && Array.isArray(x.homeOrder) && x.homeOrder.length === 3 && new Set(x.homeOrder).size === 3 && x.homeOrder.every((v) => ["banner", "game", "community"].includes(v)) && Array.isArray(x.homeHidden) && x.homeHidden.length <= 2 && new Set(x.homeHidden).size === x.homeHidden.length && x.homeHidden.every((v) => v === "banner" || v === "community");
}
function isForumDraft(x) {
  return exactObject(x, ["id", "title", "category", "body", "updatedAt"]) && uuid10(x.id) && typeof x.title === "string" && x.title.trim().length > 0 && x.title.length <= 120 && !/[\p{C}]/u.test(x.title) && ["general", "game", "mods", "builds"].includes(x.category) && typeof x.body === "string" && x.body.trim().length > 0 && x.body.length <= 2e4 && !Array.from(x.body).some((char) => char.charCodeAt(0) < 32 && !["	", "\n", "\r"].includes(char)) && typeof x.updatedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(x.updatedAt) && Number.isFinite(Date.parse(x.updatedAt));
}
function isDesktopState(x) {
  return exactObject(x, ["appearance", "drafts"]) && isAppearance(x.appearance) && Array.isArray(x.drafts) && x.drafts.length <= 50 && x.drafts.every(isForumDraft) && new Set(x.drafts.map((v) => v.id)).size === x.drafts.length;
}

// src/services/storage/desktop.ts
function parseDesktop(x) {
  if (!isDesktopState(x)) throw new StorageError("INVALID_RECORD");
  return structuredClone(x);
}

// src/services/workers/protocol.ts
var import_node_path3 = __toESM(require("node:path"), 1);

// src/shared/contracts/download-preferences.ts
var DEFAULT_DOWNLOAD_PREFERENCES = Object.freeze({ formatVersion: 1, source: "official", fileConcurrency: 4, connectionsPerFile: 4 });
function isDownloadPreferences(value) {
  return exactObject(value, ["formatVersion", "source", "fileConcurrency", "connectionsPerFile"]) && value.formatVersion === 1 && (value.source === "official" || value.source === "bmclapi") && typeof value.fileConcurrency === "number" && Number.isSafeInteger(value.fileConcurrency) && value.fileConcurrency >= 1 && value.fileConcurrency <= 8 && typeof value.connectionsPerFile === "number" && Number.isSafeInteger(value.connectionsPerFile) && value.connectionsPerFile >= 1 && value.connectionsPerFile <= 8;
}

// src/services/storage/settings.ts
function parseSettings(value) {
  if (!exactObject(value, ["memoryMiB", "isolationDefault", ...value && typeof value === "object" && Object.hasOwn(value, "downloads") ? ["downloads"] : []]) || typeof value.memoryMiB !== "number" || !Number.isSafeInteger(value.memoryMiB) || value.memoryMiB < 512 || value.memoryMiB > 65536 || typeof value.isolationDefault !== "boolean" || Object.hasOwn(value, "downloads") && !isDownloadPreferences(value.downloads)) throw new StorageError("INVALID_RECORD");
  return {
    memoryMiB: value.memoryMiB,
    isolationDefault: value.isolationDefault,
    ...isDownloadPreferences(value.downloads) ? { downloads: value.downloads } : {}
  };
}

// src/services/workers/protocol.ts
var CODES = [
  "INVALID_RECORD",
  "REVISION_CONFLICT",
  "NEEDS_RECOVERY",
  "STORE_BUSY",
  "UNSAFE_PATH",
  "STORAGE_IO",
  "WORKER_FAILED",
  "INVALID_MESSAGE",
  "QUEUE_FULL",
  "CANCELLED",
  "TIMEOUT",
  "FILE_TOO_LARGE",
  "CANCEL_TOO_LATE",
  "TARGET_ROOT_CHANGED",
  "TARGET_OUT_OF_SCOPE"
];
var WorkerError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "WorkerError";
    this.category = code3 === "CANCELLED" ? "cancelled" : code3 === "INVALID_MESSAGE" ? "validation" : "system";
  }
  code;
  category;
};
function object2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(value, keys2) {
  return Object.keys(value).sort().join(",") === keys2.sort().join(",");
}
function uuid11(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
function integer5(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function requireMessage(condition) {
  if (!condition) throw new WorkerError("INVALID_MESSAGE");
}
function parseHashJobRequest(value) {
  requireMessage(object2(value) && exact(value, ["version", "kind", "jobId", "file", "maximumBytes"]) && value.version === 1 && value.kind === "hash-job" && uuid11(value.jobId) && typeof value.file === "string" && value.file.length <= 32760 && import_node_path3.default.isAbsolute(value.file) && integer5(value.maximumBytes) && value.maximumBytes <= 64 * 1024 ** 3);
  return { version: 1, kind: "hash-job", jobId: value.jobId, file: value.file, maximumBytes: value.maximumBytes };
}
function parseStorageRequest(value) {
  requireMessage(object2(value) && exact(value, ["version", "id", "command"]) && value.version === 1 && uuid11(value.id) && object2(value.command));
  const command = value.command;
  if (command.kind === "close" || command.kind === "object:clear" || command.kind === "installation:get" || command.kind === "catalog:get" || command.kind === "instances:get" || command.kind === "profiles:get" || command.kind === "sessions:get" || command.kind === "desktop:get" || command.kind === "settings:get" || command.kind === "resources:get" || command.kind === "mod-jobs:get") requireMessage(exact(command, ["kind"]));
  else if (command.kind === "mod-targets:read") requireMessage(exact(command, ["kind", "rootId", "rootRevision", "instanceId", "kinds"]) && uuid11(command.rootId) && integer5(command.rootRevision) && command.rootRevision > 0 && uuid11(command.instanceId) && Array.isArray(command.kinds) && command.kinds.length >= 1 && command.kinds.length <= 2 && command.kinds.every((kind) => kind === "mod-check" || kind === "mod-install") && new Set(command.kinds).size === command.kinds.length);
  else if (command.kind === "mod-confirm:list") requireMessage(exact(command, ["kind"]));
  else if (command.kind === "mod-confirm:accept") requireMessage(exact(command, ["kind", "planRequestId", "planId", "confirmed"]) && uuid11(command.planRequestId) && typeof command.planId === "string" && /^[a-f0-9]{64}$/.test(command.planId) && command.confirmed === true);
  else if (command.kind === "mod-jobs:set") {
    requireMessage(exact(command, ["kind", "expectedRevision", "data"]) && integer5(command.expectedRevision));
    parseModJobs(command.data);
  } else if (command.kind === "mod-result:get" || command.kind === "mod-txn:get") requireMessage(exact(command, ["kind", "taskId"]) && uuid11(command.taskId));
  else if (command.kind === "mod-result:set") {
    requireMessage(exact(command, ["kind", "taskId", "expectedRevision", "data"]) && uuid11(command.taskId) && integer5(command.expectedRevision));
    requireMessage(parseModInstallResult(command.data).taskId === command.taskId.toLowerCase());
  } else if (command.kind === "mod-txn:set") {
    requireMessage(exact(command, ["kind", "taskId", "expectedRevision", "data"]) && uuid11(command.taskId) && integer5(command.expectedRevision));
    requireMessage(parseModTransaction(command.data).taskId.toLowerCase() === command.taskId.toLowerCase());
  } else if (command.kind === "mod-plan:get") {
    requireMessage(exact(command, ["kind", "requestId"]) && uuid11(command.requestId));
    modPlanRecordId(command.requestId);
  } else if (command.kind === "mod-plan:set") {
    requireMessage(exact(command, ["kind", "requestId", "expectedRevision", "data"]) && uuid11(command.requestId) && integer5(command.expectedRevision) && command.expectedRevision < 2);
    const data = parseStoredModPlan(command.data);
    requireMessage(data.requestId === command.requestId.toLowerCase() && command.expectedRevision === (data.status === "preview" ? 0 : 1));
  } else if (command.kind === "mod-report:get") requireMessage(exact(command, ["kind", "taskId"]) && uuid11(command.taskId));
  else if (command.kind === "mod-report:set") {
    requireMessage(exact(command, ["kind", "taskId", "expectedRevision", "data"]) && uuid11(command.taskId) && command.expectedRevision === 0);
    requireMessage(parseStoredModReport(command.data).taskId.toLowerCase() === command.taskId.toLowerCase());
  } else if (command.kind === "resources:set") {
    requireMessage(exact(command, ["kind", "expectedRevision", "data"]) && integer5(command.expectedRevision));
    parseResourceLibrary(command.data);
  } else if (command.kind === "desktop:set") {
    requireMessage(exact(command, ["kind", "expectedRevision", "data"]) && integer5(command.expectedRevision));
    parseDesktop(command.data);
  } else if (command.kind === "settings:set") {
    requireMessage(exact(command, ["kind", "expectedRevision", "data"]) && integer5(command.expectedRevision));
    parseSettings(command.data);
  } else if (command.kind === "sessions:set") {
    requireMessage(exact(command, ["kind", "expectedRevision", "data"]) && integer5(command.expectedRevision));
    parseGameSessions(command.data);
  } else if (command.kind === "profiles:set") {
    requireMessage(exact(command, ["kind", "expectedRevision", "data"]) && integer5(command.expectedRevision));
    parseLaunchProfiles(command.data);
  } else if (command.kind === "instances:set") {
    requireMessage(exact(command, ["kind", "expectedRevision", "data"]) && integer5(command.expectedRevision));
    parseInstanceIndex(command.data);
  } else if (command.kind === "instance:get") requireMessage(exact(command, ["kind", "instanceId"]) && uuid11(command.instanceId));
  else if (command.kind === "instance:set") {
    requireMessage(exact(command, ["kind", "instanceId", "expectedRevision", "data"]) && uuid11(command.instanceId) && integer5(command.expectedRevision));
    const data = parseInstanceRecord(command.data);
    requireMessage(data.summary.instanceId === command.instanceId.toLowerCase() && data.summary.revision === command.expectedRevision + 1);
  } else if (command.kind === "installation:set") {
    requireMessage(exact(command, ["kind", "data"]));
    parseInstallation(command.data);
  } else if (command.kind === "catalog:set") {
    requireMessage(exact(command, ["kind", "expectedRevision", "data"]) && integer5(command.expectedRevision));
    parseCatalogCache(command.data);
  } else if (command.kind === "transfer:get") requireMessage(exact(command, ["kind", "key"]) && typeof command.key === "string" && /^[a-f0-9]{64}$/.test(command.key));
  else if (command.kind === "transfer:set") {
    requireMessage(exact(command, ["kind", "expectedRevision", "record"]) && integer5(command.expectedRevision));
    parseTransferRecord(command.record);
  } else if (command.kind === "object:lookup" || command.kind === "object:remember") {
    requireMessage(typeof command.sourceKey === "string" && /^[a-f0-9]{64}$/.test(command.sourceKey) && exact(command, command.kind === "object:lookup" ? ["kind", "sourceKey"] : ["kind", "sourceKey", "object"]));
    if (command.kind === "object:remember") parseIndexed(command.object);
  } else {
    requireMessage(uuid11(command.ownerId));
    if (command.kind === "accept" || command.kind === "find-accepted") requireMessage(exact(command, ["kind", "ownerId", "requestId", "taskKind", "payloadDigest"]) && uuid11(command.requestId) && typeof command.taskKind === "string" && TASK_KINDS.includes(command.taskKind) && (command.kind !== "accept" || command.taskKind !== "mod-install") && typeof command.payloadDigest === "string" && /^[a-f0-9]{64}$/.test(command.payloadDigest));
    else if (command.kind === "get") requireMessage(exact(command, ["kind", "ownerId", "taskId"]) && uuid11(command.taskId));
    else if (command.kind === "update") {
      requireMessage(exact(command, ["kind", "ownerId", "taskId", "expectedRevision", "execution"]) && uuid11(command.taskId) && integer5(command.expectedRevision));
      parseExecution(command.execution);
    } else throw new WorkerError("INVALID_MESSAGE");
  }
  return value;
}
function parseModConfirmations(value) {
  requireMessage(Array.isArray(value) && value.length <= 1e3);
  const requests = /* @__PURE__ */ new Set();
  const tasks = /* @__PURE__ */ new Set();
  return value.map((item) => {
    requireMessage(object2(item) && exact(item, ["planRequestId", "payloadDigest", "task"]) && uuid11(item.planRequestId) && typeof item.payloadDigest === "string" && /^[a-f0-9]{64}$/.test(item.payloadDigest));
    const task = parseTask(item.task);
    const id2 = item.planRequestId.toLowerCase();
    requireMessage(task.kind === "mod-install" && !requests.has(id2) && !tasks.has(task.taskId.toLowerCase()));
    requests.add(id2);
    tasks.add(task.taskId.toLowerCase());
    return { planRequestId: id2, payloadDigest: item.payloadDigest, task };
  });
}
function parseTask(value) {
  requireMessage(object2(value) && exact(value, ["taskId", "ownerId", "kind", "execution"]) && uuid11(value.taskId) && uuid11(value.ownerId) && typeof value.kind === "string" && TASK_KINDS.includes(value.kind));
  return { taskId: value.taskId, ownerId: value.ownerId, kind: value.kind, execution: parseExecution(value.execution) };
}
function parseModTargets(value) {
  requireMessage(object2(value) && exact(value, ["rootId", "rootRevision", "items"]) && uuid11(value.rootId) && integer5(value.rootRevision) && value.rootRevision > 0 && Array.isArray(value.items) && value.items.length <= 2e3 && Buffer.byteLength(JSON.stringify(value)) <= 2 * 1024 * 1024);
  const rootId = value.rootId.toLowerCase();
  const ids2 = /* @__PURE__ */ new Set();
  const items = value.items.map((item) => {
    requireMessage(object2(item) && exact(item, ["instanceId", "instanceRevision", "task"]) && uuid11(item.instanceId) && integer5(item.instanceRevision) && item.instanceRevision > 0);
    const task = parseTask(item.task);
    const id2 = task.taskId.toLowerCase();
    requireMessage(task.ownerId.toLowerCase() === rootId && (task.kind === "mod-check" || task.kind === "mod-install") && !ids2.has(id2));
    ids2.add(id2);
    return { instanceId: item.instanceId.toLowerCase(), instanceRevision: item.instanceRevision, task };
  });
  return { rootId, rootRevision: value.rootRevision, items };
}
function parseIndexed(value) {
  requireMessage(object2(value) && exact(value, ["digest", "size"]) && typeof value.digest === "string" && /^[a-f0-9]{64}$/.test(value.digest) && integer5(value.size));
  return { digest: value.digest, size: value.size };
}
function parseReply(value) {
  requireMessage(object2(value) && value.version === 1);
  if (value.kind === "ready") {
    if (!Object.hasOwn(value, "features")) {
      requireMessage(exact(value, ["version", "kind"]));
      return { version: 1, kind: "ready" };
    }
    requireMessage(exact(value, ["version", "kind", "features"]) && Array.isArray(value.features) && value.features.length <= 1 && value.features.every((feature) => feature === "mod-targets.read.v1"));
    return { version: 1, kind: "ready", features: value.features };
  }
  if (value.kind === "hash-ready") {
    requireMessage(exact(value, ["version", "kind"]));
    return { version: 1, kind: "hash-ready" };
  }
  if (value.kind === "startup-failed") {
    requireMessage(exact(value, ["version", "kind", "code"]) && typeof value.code === "string" && CODES.includes(value.code));
    return { version: 1, kind: "startup-failed", code: value.code };
  }
  if (value.kind === "response") {
    requireMessage(uuid11(value.id));
    if (value.ok === true) {
      requireMessage([value.desktop, value.task, value.object, value.installation, value.catalog, value.transfer, value.instances, value.instance, value.profiles, value.sessions, value.settings, value.resources, value.modJobs, value.modReport, value.modPlan, value.modTransaction, value.modConfirmations, value.modResult, value.modTargets].filter((item) => item !== void 0).length <= 1 && exact(value, ["version", "kind", "id", "ok", ...value.desktop === void 0 ? [] : ["desktop"], ...value.task === void 0 ? [] : ["task"], ...value.object === void 0 ? [] : ["object"], ...value.installation === void 0 ? [] : ["installation"], ...value.catalog === void 0 ? [] : ["catalog"], ...value.transfer === void 0 ? [] : ["transfer"], ...value.instances === void 0 ? [] : ["instances"], ...value.instance === void 0 ? [] : ["instance"], ...value.profiles === void 0 ? [] : ["profiles"], ...value.sessions === void 0 ? [] : ["sessions"], ...value.settings === void 0 ? [] : ["settings"], ...value.resources === void 0 ? [] : ["resources"], ...value.modJobs === void 0 ? [] : ["modJobs"], ...value.modReport === void 0 ? [] : ["modReport"], ...value.modPlan === void 0 ? [] : ["modPlan"], ...value.modTransaction === void 0 ? [] : ["modTransaction"], ...value.modConfirmations === void 0 ? [] : ["modConfirmations"], ...value.modResult === void 0 ? [] : ["modResult"], ...value.modTargets === void 0 ? [] : ["modTargets"]]));
      let modTransaction;
      let modResult;
      if (value.modResult !== void 0) {
        requireMessage(object2(value.modResult) && exact(value.modResult, ["schemaVersion", "revision", "data"]) && value.modResult.schemaVersion === 1 && integer5(value.modResult.revision) && value.modResult.revision >= 1);
        modResult = { schemaVersion: 1, revision: value.modResult.revision, data: parseModInstallResult(value.modResult.data) };
      }
      if (value.modTransaction !== void 0) {
        requireMessage(object2(value.modTransaction) && exact(value.modTransaction, ["schemaVersion", "revision", "data"]) && value.modTransaction.schemaVersion === 1 && integer5(value.modTransaction.revision) && value.modTransaction.revision >= 1);
        modTransaction = { schemaVersion: 1, revision: value.modTransaction.revision, data: parseModTransaction(value.modTransaction.data) };
      }
      let modPlan;
      if (value.modPlan !== void 0) {
        requireMessage(object2(value.modPlan) && exact(value.modPlan, ["schemaVersion", "revision", "data"]) && value.modPlan.schemaVersion === 1 && (value.modPlan.revision === 1 || value.modPlan.revision === 2));
        const data = parseStoredModPlan(value.modPlan.data);
        requireMessage(value.modPlan.revision === (data.status === "preview" ? 1 : 2));
        modPlan = { schemaVersion: 1, revision: value.modPlan.revision, data };
      }
      let modJobs;
      let modReport;
      if (value.modJobs !== void 0) {
        requireMessage(object2(value.modJobs) && exact(value.modJobs, ["schemaVersion", "revision", "data"]) && value.modJobs.schemaVersion === 1 && integer5(value.modJobs.revision) && value.modJobs.revision > 0);
        modJobs = { schemaVersion: 1, revision: value.modJobs.revision, data: parseModJobs(value.modJobs.data) };
      }
      if (value.modReport !== void 0) {
        requireMessage(object2(value.modReport) && exact(value.modReport, ["schemaVersion", "revision", "data"]) && value.modReport.schemaVersion === 1 && value.modReport.revision === 1);
        modReport = { schemaVersion: 1, revision: 1, data: parseStoredModReport(value.modReport.data) };
      }
      let resources;
      if (value.resources !== void 0) {
        requireMessage(object2(value.resources) && exact(value.resources, ["schemaVersion", "revision", "data"]) && value.resources.schemaVersion === 1 && integer5(value.resources.revision) && value.resources.revision > 0);
        resources = { schemaVersion: 1, revision: value.resources.revision, data: parseResourceLibrary(value.resources.data) };
      }
      let desktop;
      if (value.desktop !== void 0) {
        requireMessage(object2(value.desktop) && exact(value.desktop, ["schemaVersion", "revision", "data"]) && value.desktop.schemaVersion === 1 && integer5(value.desktop.revision) && value.desktop.revision > 0);
        desktop = { schemaVersion: 1, revision: value.desktop.revision, data: parseDesktop(value.desktop.data) };
      }
      let settings;
      if (value.settings !== void 0) {
        requireMessage(object2(value.settings) && exact(value.settings, ["schemaVersion", "revision", "data"]) && value.settings.schemaVersion === 1 && integer5(value.settings.revision) && value.settings.revision > 0);
        settings = { schemaVersion: 1, revision: value.settings.revision, data: parseSettings(value.settings.data) };
      }
      let sessions;
      if (value.sessions !== void 0) {
        requireMessage(object2(value.sessions) && exact(value.sessions, ["schemaVersion", "revision", "data"]) && value.sessions.schemaVersion === 1 && integer5(value.sessions.revision) && value.sessions.revision > 0);
        sessions = { schemaVersion: 1, revision: value.sessions.revision, data: parseGameSessions(value.sessions.data) };
      }
      let profiles;
      if (value.profiles !== void 0) {
        requireMessage(object2(value.profiles) && exact(value.profiles, ["schemaVersion", "revision", "data"]) && value.profiles.schemaVersion === 1 && integer5(value.profiles.revision) && value.profiles.revision > 0);
        profiles = { schemaVersion: 1, revision: value.profiles.revision, data: parseLaunchProfiles(value.profiles.data) };
      }
      let installation;
      if (value.installation !== void 0) {
        requireMessage(object2(value.installation) && exact(value.installation, ["schemaVersion", "revision", "data"]) && value.installation.schemaVersion === 1 && integer5(value.installation.revision) && value.installation.revision > 0);
        installation = { schemaVersion: 1, revision: value.installation.revision, data: parseInstallation(value.installation.data) };
      }
      let catalog;
      if (value.catalog !== void 0) {
        requireMessage(object2(value.catalog) && exact(value.catalog, ["schemaVersion", "revision", "data"]) && value.catalog.schemaVersion === 1 && integer5(value.catalog.revision) && value.catalog.revision > 0);
        catalog = { schemaVersion: 1, revision: value.catalog.revision, data: parseCatalogCache(value.catalog.data) };
      }
      let instances;
      if (value.instances !== void 0) {
        requireMessage(object2(value.instances) && exact(value.instances, ["schemaVersion", "revision", "data"]) && value.instances.schemaVersion === 1 && integer5(value.instances.revision) && value.instances.revision > 0);
        instances = { schemaVersion: 1, revision: value.instances.revision, data: parseInstanceIndex(value.instances.data) };
      }
      let instance;
      if (value.instance !== void 0) {
        requireMessage(object2(value.instance) && exact(value.instance, ["schemaVersion", "revision", "data"]) && value.instance.schemaVersion === 1 && integer5(value.instance.revision) && value.instance.revision > 0);
        const data = parseInstanceRecord(value.instance.data);
        requireMessage(data.summary.revision === value.instance.revision);
        instance = { schemaVersion: 1, revision: value.instance.revision, data };
      }
      return {
        version: 1,
        kind: "response",
        id: value.id,
        ok: true,
        ...value.task === void 0 ? {} : { task: parseTask(value.task) },
        ...value.object === void 0 ? {} : { object: parseIndexed(value.object) },
        ...installation === void 0 ? {} : { installation },
        ...catalog === void 0 ? {} : { catalog },
        ...value.transfer === void 0 ? {} : { transfer: parseTransferRecord(value.transfer) },
        ...instances === void 0 ? {} : { instances },
        ...instance === void 0 ? {} : { instance },
        ...profiles === void 0 ? {} : { profiles },
        ...sessions === void 0 ? {} : { sessions },
        ...settings === void 0 ? {} : { settings },
        ...desktop === void 0 ? {} : { desktop },
        ...resources === void 0 ? {} : { resources },
        ...modJobs === void 0 ? {} : { modJobs },
        ...modReport === void 0 ? {} : { modReport },
        ...modPlan === void 0 ? {} : { modPlan },
        ...modTransaction === void 0 ? {} : { modTransaction },
        ...value.modConfirmations === void 0 ? {} : { modConfirmations: parseModConfirmations(value.modConfirmations) },
        ...modResult === void 0 ? {} : { modResult },
        ...value.modTargets === void 0 ? {} : { modTargets: parseModTargets(value.modTargets) }
      };
    }
    requireMessage(value.ok === false && exact(value, ["version", "kind", "id", "ok", "code"]) && typeof value.code === "string" && CODES.includes(value.code));
    return { version: 1, kind: "response", id: value.id, ok: false, code: value.code };
  }
  if (value.kind === "hash-job-failed") {
    requireMessage(exact(value, ["version", "kind", "jobId", "code"]) && uuid11(value.jobId) && typeof value.code === "string" && CODES.includes(value.code));
    return { version: 1, kind: "hash-job-failed", jobId: value.jobId, code: value.code };
  }
  if (value.kind === "hash-progress" || value.kind === "hash-job-progress") {
    requireMessage(exact(value, value.kind === "hash-progress" ? ["version", "kind", "bytesDone", "bytesTotal"] : ["version", "kind", "jobId", "bytesDone", "bytesTotal"]) && integer5(value.bytesDone) && integer5(value.bytesTotal) && value.bytesDone <= value.bytesTotal);
    if (value.kind === "hash-job-progress") {
      requireMessage(uuid11(value.jobId));
      return { version: 1, kind: "hash-job-progress", jobId: value.jobId, bytesDone: value.bytesDone, bytesTotal: value.bytesTotal };
    }
    return { version: 1, kind: "hash-progress", bytesDone: value.bytesDone, bytesTotal: value.bytesTotal };
  }
  requireMessage((value.kind === "hash-result" || value.kind === "hash-job-result") && exact(value, value.kind === "hash-result" ? ["version", "kind", "result"] : ["version", "kind", "jobId", "result"]) && object2(value.result));
  const result2 = value.result;
  requireMessage(exact(result2, ["size", "sha1", "sha256"]) && integer5(result2.size) && typeof result2.sha1 === "string" && /^[a-f0-9]{40}$/.test(result2.sha1) && typeof result2.sha256 === "string" && /^[a-f0-9]{64}$/.test(result2.sha256));
  const parsed = { size: result2.size, sha1: result2.sha1, sha256: result2.sha256 };
  if (value.kind === "hash-job-result") {
    requireMessage(uuid11(value.jobId));
    return { version: 1, kind: "hash-job-result", jobId: value.jobId, result: parsed };
  }
  return { version: 1, kind: "hash-result", result: parsed };
}

// src/services/storage/owner-guard.ts
var import_node_sqlite = require("node:sqlite");
var import_node_crypto8 = require("node:crypto");
var import_promises3 = require("node:fs/promises");
var import_node_path4 = __toESM(require("node:path"), 1);
var GUARD_NAME = "owner.guard.sqlite";
var APPLICATION_ID = 1330987847;
var MARKER = /^oucl-owner-v2:([a-f0-9-]{36}):(\d+):(\d+)$/;
var OwnerGuard = class _OwnerGuard {
  constructor(db, marker2, markerPath) {
    this.db = db;
    this.marker = marker2;
    this.markerPath = markerPath;
  }
  db;
  marker;
  markerPath;
  static async acquire(directory2) {
    if (process.platform !== "win32") throw new StorageError("NEEDS_RECOVERY");
    const root = await guardDirectory(directory2);
    const markerPath = import_node_path4.default.join(root, "owner.lock");
    const prior = await readRegular(markerPath, 200);
    if (prior && !MARKER.test(prior.toString("utf8"))) throw new StorageError("STORE_BUSY");
    const file = import_node_path4.default.join(root, GUARD_NAME);
    let exists2 = await guardDatabase(file);
    if (!exists2 && prior) throw new StorageError("NEEDS_RECOVERY");
    if (!exists2 && (await (0, import_promises3.readdir)(root)).some((name2) => name2 !== GUARD_NAME && isOwnerGuardFile(name2))) throw new StorageError("NEEDS_RECOVERY");
    if (!exists2) {
      try {
        const handle = await (0, import_promises3.open)(file, "wx");
        await handle.close();
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw new StorageError("STORAGE_IO");
        exists2 = true;
      }
    }
    const before = await (0, import_promises3.lstat)(file, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.ino === 0n) throw new StorageError("UNSAFE_PATH");
    let db;
    try {
      db = new import_node_sqlite.DatabaseSync(file);
      db.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE;");
      const after = await (0, import_promises3.lstat)(file, { bigint: true });
      if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1n || before.dev !== after.dev || before.ino !== after.ino) throw new StorageError("UNSAFE_PATH");
      if (exists2) {
        if (db.prepare("PRAGMA application_id").get()?.application_id !== APPLICATION_ID || db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") throw new StorageError("NEEDS_RECOVERY");
      } else {
        db.exec(`CREATE TABLE guard (id TEXT NOT NULL); INSERT INTO guard VALUES ('${(0, import_node_crypto8.randomUUID)()}'); PRAGMA application_id=${APPLICATION_ID}; COMMIT; BEGIN IMMEDIATE;`);
      }
      const row = db.prepare("SELECT id FROM guard").all();
      const id2 = row.length === 1 ? row[0]?.id : void 0;
      if (typeof id2 !== "string" || !/^[a-f0-9-]{36}$/.test(id2)) throw new StorageError("NEEDS_RECOVERY");
      const marker2 = `oucl-owner-v2:${id2}:${after.dev}:${after.ino}`;
      const current = await readRegular(markerPath, 200);
      if (current) {
        if (current.toString("utf8") !== marker2) throw new StorageError("STORE_BUSY");
      } else {
        let handle;
        try {
          handle = await (0, import_promises3.open)(markerPath, "wx");
        } catch (error) {
          throw new StorageError(hasCode(error, "EEXIST") ? "STORE_BUSY" : "STORAGE_IO");
        }
        try {
          await handle.writeFile(marker2);
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
      return new _OwnerGuard(db, marker2, markerPath);
    } catch (error) {
      try {
        db?.close();
      } catch {
      }
      if (error instanceof StorageError) throw error;
      if (typeof error === "object" && error !== null && "errcode" in error && typeof error.errcode === "number" && (error.errcode & 255) === 5) throw new StorageError("STORE_BUSY");
      throw new StorageError("NEEDS_RECOVERY");
    }
  }
  /** The worker may use this marker but must not remove it. */
  get token() {
    return this.marker;
  }
  /** Releases the operating-system lock while preserving recovery evidence. */
  abandon() {
    this.db.exec("ROLLBACK");
    this.db.close();
  }
  /** Called only after all work and the storage worker have stopped normally. */
  async close() {
    if ((await readRegular(this.markerPath, 200))?.toString("utf8") !== this.marker) throw new StorageError("NEEDS_RECOVERY");
    await (0, import_promises3.unlink)(this.markerPath);
    this.db.exec("ROLLBACK");
    this.db.close();
  }
};
function isOwnerGuardFile(name2) {
  return [GUARD_NAME, `${GUARD_NAME}-journal`, `${GUARD_NAME}-wal`, `${GUARD_NAME}-shm`].includes(name2);
}

// src/services/workers/storage-client.ts
var StorageClient = class _StorageClient {
  constructor(worker, timeoutMs, owner) {
    this.worker = worker;
    this.timeoutMs = timeoutMs;
    this.owner = owner;
    this.ended = new Promise((resolve) => {
      worker.once("exit", () => {
        this.fail();
        resolve();
      });
    });
    worker.on("error", () => {
      this.fail();
    });
  }
  worker;
  timeoutMs;
  owner;
  pending = /* @__PURE__ */ new Map();
  stopped = false;
  targetFeature = false;
  /** True only after a new storage worker explicitly advertises its target reader. */
  get supportsModTargets() {
    return this.targetFeature;
  }
  closing = false;
  ended;
  /** Starts only the repository-owned worker entry; directory is supplied by a trusted platform adapter. */
  static async open(entry, directory2, timeoutMs = 1e4) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12e4) throw new WorkerError("INVALID_MESSAGE");
    let owner;
    try {
      if (process.platform === "win32") owner = await OwnerGuard.acquire(directory2);
    } catch (error) {
      throw new WorkerError(error instanceof StorageError ? error.code : "STORAGE_IO");
    }
    let worker;
    try {
      worker = new import_node_worker_threads.Worker(entry, { workerData: { version: 1, kind: "storage", directory: directory2, ...owner ? { ownerToken: owner.token } : {} }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
    } catch (error) {
      owner?.abandon();
      throw error;
    }
    const client2 = new _StorageClient(worker, timeoutMs, owner);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new WorkerError("TIMEOUT"));
        }, timeoutMs);
        const finish = (error) => {
          clearTimeout(timer);
          worker.off("message", receive);
          worker.off("exit", exited);
          worker.off("error", failed);
          if (error) reject(error);
          else resolve();
        };
        const exited = () => {
          finish(new WorkerError("WORKER_FAILED"));
        };
        const failed = () => {
          finish(new WorkerError("WORKER_FAILED"));
        };
        const receive = (input) => {
          try {
            const reply = parseReply(input);
            if (reply.kind === "ready") {
              client2.targetFeature = reply.features?.includes("mod-targets.read.v1") ?? false;
              finish();
            } else finish(new WorkerError(reply.kind === "startup-failed" ? reply.code : "INVALID_MESSAGE"));
          } catch {
            finish(new WorkerError("INVALID_MESSAGE"));
          }
        };
        worker.on("message", receive);
        worker.once("exit", exited);
        worker.once("error", failed);
      });
      worker.on("message", (input) => {
        client2.receive(input);
      });
      return client2;
    } catch (error) {
      await worker.terminate();
      await client2.ended;
      owner?.abandon();
      throw error;
    }
  }
  fail() {
    this.stopped = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new WorkerError("WORKER_FAILED"));
    }
    this.pending.clear();
  }
  receive(input) {
    try {
      const reply = parseReply(input);
      if (reply.kind !== "response") {
        this.fail();
        void this.worker.terminate();
        return;
      }
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      this.pending.delete(reply.id);
      clearTimeout(pending.timer);
      if (reply.ok) pending.resolve({
        ...reply.task === void 0 ? {} : { task: reply.task },
        ...reply.object === void 0 ? {} : { object: reply.object },
        ...reply.installation === void 0 ? {} : { installation: reply.installation },
        ...reply.catalog === void 0 ? {} : { catalog: reply.catalog },
        ...reply.transfer === void 0 ? {} : { transfer: reply.transfer },
        ...reply.instances === void 0 ? {} : { instances: reply.instances },
        ...reply.instance === void 0 ? {} : { instance: reply.instance },
        ...reply.profiles === void 0 ? {} : { profiles: reply.profiles },
        ...reply.sessions === void 0 ? {} : { sessions: reply.sessions },
        ...reply.settings === void 0 ? {} : { settings: reply.settings },
        ...reply.desktop === void 0 ? {} : { desktop: reply.desktop },
        ...reply.resources === void 0 ? {} : { resources: reply.resources },
        ...reply.modJobs === void 0 ? {} : { modJobs: reply.modJobs },
        ...reply.modReport === void 0 ? {} : { modReport: reply.modReport },
        ...reply.modPlan === void 0 ? {} : { modPlan: reply.modPlan },
        ...reply.modTransaction === void 0 ? {} : { modTransaction: reply.modTransaction },
        ...reply.modConfirmations === void 0 ? {} : { modConfirmations: reply.modConfirmations },
        ...reply.modResult === void 0 ? {} : { modResult: reply.modResult },
        ...reply.modTargets === void 0 ? {} : { modTargets: reply.modTargets }
      });
      else pending.reject(new WorkerError(reply.code));
    } catch {
      this.fail();
      void this.worker.terminate();
    }
  }
  request(command, shuttingDown = false, untilReply = false) {
    if (this.stopped || this.closing && !shuttingDown) return Promise.reject(new WorkerError("WORKER_FAILED"));
    if (this.pending.size >= 32 && !shuttingDown) return Promise.reject(new WorkerError("QUEUE_FULL"));
    const request = parseStorageRequest({ version: 1, id: (0, import_node_crypto9.randomUUID)(), command });
    return new Promise((resolve, reject) => {
      const timer = untilReply ? void 0 : setTimeout(() => {
        reject(new WorkerError("TIMEOUT"));
      }, this.timeoutMs);
      this.pending.set(request.id, { resolve, reject, timer });
      try {
        this.worker.postMessage(request);
      } catch {
        this.pending.delete(request.id);
        clearTimeout(timer);
        reject(new WorkerError("INVALID_MESSAGE"));
      }
    });
  }
  /** Loads only the request-correlated saved Mod plan domain. */
  async readModTransaction(taskId) {
    return (await this.request({ kind: "mod-txn:get", taskId })).modTransaction;
  }
  async readModResult(taskId) {
    return (await this.request({ kind: "mod-result:get", taskId })).modResult;
  }
  async writeModResult(taskId, expectedRevision, data) {
    const result2 = (await this.request({ kind: "mod-result:set", taskId, expectedRevision, data })).modResult;
    if (!result2) throw new WorkerError("INVALID_MESSAGE");
    return result2;
  }
  async writeModTransaction(taskId, expectedRevision, data) {
    const result2 = (await this.request({ kind: "mod-txn:set", taskId, expectedRevision, data })).modTransaction;
    if (!result2) throw new WorkerError("INVALID_MESSAGE");
    return result2;
  }
  async readModPlan(requestId) {
    return (await this.request({ kind: "mod-plan:get", requestId })).modPlan;
  }
  /** Durable admission only; executors must separately revalidate and run the accepted task. */
  async acceptModConfirmation(planRequestId, planId, confirmed) {
    const result2 = (await this.request({ kind: "mod-confirm:accept", planRequestId, planId, confirmed })).task;
    if (!result2 || result2.kind !== "mod-install") throw new WorkerError("INVALID_MESSAGE");
    return result2;
  }
  /** Reads proven targets only when the worker has advertised the matching protocol. */
  async readModTargets(input) {
    if (!this.targetFeature) throw new WorkerError("WORKER_FAILED");
    const result2 = (await this.request({ kind: "mod-targets:read", ...input }, false, true)).modTargets;
    if (!result2 || result2.rootId !== input.rootId.toLowerCase() || result2.rootRevision !== input.rootRevision || result2.items.some((item) => item.instanceId !== input.instanceId.toLowerCase() || !input.kinds.some((kind) => kind === item.task.kind)))
      throw new WorkerError("INVALID_MESSAGE");
    return result2;
  }
  async readModConfirmations() {
    const result2 = (await this.request({ kind: "mod-confirm:list" })).modConfirmations;
    if (!result2) throw new WorkerError("INVALID_MESSAGE");
    return result2;
  }
  async writeModPlan(requestId, expectedRevision, data) {
    const result2 = (await this.request({ kind: "mod-plan:set", requestId, expectedRevision, data })).modPlan;
    if (!result2) throw new WorkerError("INVALID_MESSAGE");
    return result2;
  }
  /** Reads the fixed Mod inspection index. */
  async readModJobs() {
    return (await this.request({ kind: "mod-jobs:get" })).modJobs;
  }
  async writeModJobs(expectedRevision, data) {
    const result2 = (await this.request({ kind: "mod-jobs:set", expectedRevision, data })).modJobs;
    if (!result2) throw new WorkerError("INVALID_MESSAGE");
    return result2;
  }
  async readModReport(taskId) {
    return (await this.request({ kind: "mod-report:get", taskId })).modReport;
  }
  /** Immutable reports have one atomic JSON commit and cannot overwrite an existing observation. */
  async writeModReport(taskId, data) {
    const result2 = (await this.request({ kind: "mod-report:set", taskId, expectedRevision: 0, data })).modReport;
    if (!result2) throw new WorkerError("INVALID_MESSAGE");
    return result2;
  }
  /** Reads the fixed resource ownership index. */
  async readResources() {
    return (await this.request({ kind: "resources:get" })).resources;
  }
  /** CAS-writes bounded resource ownership metadata through the JSON commit journal. */
  async writeResources(expectedRevision, data) {
    const result2 = (await this.request({ kind: "resources:set", expectedRevision, data })).resources;
    if (!result2) throw new WorkerError("INVALID_MESSAGE");
    return result2;
  }
  /** Reads only the fixed launch settings domain. */
  async readDesktop() {
    return (await this.request({ kind: "desktop:get" })).desktop;
  }
  /** Fixed desktop CAS write using the existing JSON journal and worker. */
  async writeDesktop(expectedRevision, data) {
    const result2 = (await this.request({ kind: "desktop:set", expectedRevision, data })).desktop;
    if (!result2) throw new WorkerError("INVALID_MESSAGE");
    return result2;
  }
  /** Reads launch preferences independently of appearance. */
  async readSettings() {
    return (await this.request({ kind: "settings:get" })).settings;
  }
  /** Atomically persists a revision-checked settings change. */
  async writeSettings(expectedRevision, data) {
    const value = (await this.request({ kind: "settings:set", expectedRevision, data })).settings;
    if (!value) throw new WorkerError("INVALID_MESSAGE");
    return value;
  }
  /** Reads fixed private session metadata, never arbitrary records or process identifiers. */
  async readGameSessions() {
    return (await this.request({ kind: "sessions:get" })).sessions;
  }
  /** CAS commit of fixed game-session metadata; does not accept arbitrary record IDs or paths. */
  async writeGameSessions(expectedRevision, data) {
    const result2 = (await this.request({ kind: "sessions:set", expectedRevision, data })).sessions;
    if (!result2) throw new WorkerError("INVALID_MESSAGE");
    return result2;
  }
  /** Reads only the fixed private Java/offline identity record. */
  async readLaunchProfiles() {
    return (await this.request({ kind: "profiles:get" })).profiles;
  }
  /** CAS commit of the fixed typed Java/offline profile domain, never arbitrary JSON. */
  async writeLaunchProfiles(expectedRevision, data) {
    const result2 = (await this.request({ kind: "profiles:set", expectedRevision, data })).profiles;
    if (!result2) throw new WorkerError("INVALID_MESSAGE");
    return result2;
  }
  /** Durable idempotent acceptance; retry with the same business requestId after an unknown outcome. */
  async accept(ownerId, requestId, taskKind, payloadDigest) {
    const { task } = await this.request({ kind: "accept", ownerId, requestId, taskKind, payloadDigest });
    if (!task) throw new WorkerError("INVALID_MESSAGE");
    return task;
  }
  /** Recovers an exact accepted request without admitting a new task, even after a renderer restart. */
  async findAccepted(ownerId, requestId, taskKind, payloadDigest) {
    const { task } = await this.request({ kind: "find-accepted", ownerId, requestId, taskKind, payloadDigest });
    if (task && (task.ownerId !== ownerId || task.kind !== taskKind)) throw new WorkerError("INVALID_MESSAGE");
    return task;
  }
  /** Queries only the stable owner's task, including after a caller timeout. */
  async get(ownerId, taskId) {
    return (await this.request({ kind: "get", ownerId, taskId })).task;
  }
  /** Saves a transition before its effects run outside the storage worker. */
  async update(ownerId, taskId, expectedRevision, execution) {
    const { task } = await this.request({ kind: "update", ownerId, taskId, expectedRevision, execution });
    if (!task) throw new WorkerError("INVALID_MESSAGE");
    return task;
  }
  /** Gets a disposable object hint, never a trust decision. */
  async lookup(sourceKey2) {
    return (await this.request({ kind: "object:lookup", sourceKey: sourceKey2 })).object;
  }
  /** Saves a search hint after authoritative object/provenance verification. */
  async remember(sourceKey2, object4) {
    await this.request({ kind: "object:remember", sourceKey: sourceKey2, object: object4 });
  }
  /** Resets only the independent search cache for a provenance-based rebuild. */
  async clear() {
    await this.request({ kind: "object:clear" });
  }
  /** Reads the fixed data-directory registration, privately within the main process. */
  async readInstallation() {
    return (await this.request({ kind: "installation:get" })).installation;
  }
  /** Registers once; migration/overwriting an existing data location is intentionally unavailable. */
  async createInstallation(data) {
    const result2 = (await this.request({ kind: "installation:set", data })).installation;
    if (!result2) throw new WorkerError("INVALID_MESSAGE");
    return result2;
  }
  /** Reads the validated official catalog cache privately in the main process. */
  async readCatalog() {
    return (await this.request({ kind: "catalog:get" })).catalog;
  }
  /** Atomically updates the fixed cache record through the existing recovery journal. */
  async writeCatalog(expectedRevision, data) {
    const result2 = (await this.request({ kind: "catalog:set", expectedRevision, data })).catalog;
    if (!result2) throw new WorkerError("INVALID_MESSAGE");
    return result2;
  }
  /** Reads authoritative transfer identity and its fsynced prefix, never a disposable search hint. */
  async getTransfer(key) {
    return (await this.request({ kind: "transfer:get", key })).transfer;
  }
  /** Persists a revision-checked transfer checkpoint in SQLite before acknowledging it to the downloader. */
  async saveTransfer(expectedRevision, record3) {
    await this.request({ kind: "transfer:set", expectedRevision, record: record3 });
  }
  /** Reads the fixed instance index without interpreting a list entry as proof of completed installation. */
  async readInstances() {
    return (await this.request({ kind: "instances:get" })).instances;
  }
  /** CAS-writes only the bounded typed instance index, through the existing JSON commit journal. */
  async writeInstances(expectedRevision, data) {
    const result2 = (await this.request({ kind: "instances:set", expectedRevision, data })).instances;
    if (!result2) throw new WorkerError("INVALID_MESSAGE");
    return result2;
  }
  /** Reads one UUID-bound installation record; no caller-controlled record name is accepted. */
  async readInstance(instanceId) {
    const result2 = (await this.request({ kind: "instance:get", instanceId })).instance;
    if (result2 && result2.data.summary.instanceId !== instanceId.toLowerCase()) throw new WorkerError("INVALID_MESSAGE");
    return result2;
  }
  /** CAS-writes a private installation checkpoint, keeping its summary revision equal to its envelope. */
  async writeInstance(instanceId, expectedRevision, data) {
    const result2 = (await this.request({ kind: "instance:set", instanceId, expectedRevision, data })).instance;
    if (!result2 || result2.data.summary.instanceId !== instanceId.toLowerCase()) throw new WorkerError("INVALID_MESSAGE");
    return result2;
  }
  /** Drains earlier requests, closes the database, releases its own lease and waits for thread exit. */
  async close() {
    if (this.stopped) {
      await this.ended;
      return;
    }
    if (this.closing) {
      await this.ended;
      return;
    }
    this.closing = true;
    try {
      await this.request({ kind: "close" }, true);
      await this.ended;
      await this.owner?.close();
    } catch (error) {
      await this.worker.terminate();
      await this.ended;
      throw error;
    }
  }
};

// src/services/install/installer.ts
var import_node_crypto19 = require("node:crypto");
var import_promises17 = require("node:fs/promises");
var import_node_path26 = __toESM(require("node:path"), 1);
var import_node_os = require("node:os");

// src/services/workers/hash-pool.ts
var import_node_worker_threads2 = require("node:worker_threads");
var import_node_crypto10 = require("node:crypto");
var HashPool = class {
  constructor(entry, concurrency = 2) {
    this.entry = entry;
    this.concurrency = concurrency;
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new WorkerError("INVALID_MESSAGE");
  }
  entry;
  concurrency;
  queue = [];
  slots = /* @__PURE__ */ new Set();
  closed = false;
  closing;
  spawned = 0;
  /** Number of actual worker constructions, including replacements, for bounded diagnostic evidence. */
  get spawnedWorkers() {
    return this.spawned;
  }
  /** Hashes an approved staging path; cancellation waits for the owning session to terminate. */
  hash(file, options) {
    if (this.closed) return Promise.reject(new WorkerError("WORKER_FAILED"));
    const id2 = (0, import_node_crypto10.randomUUID)();
    try {
      parseHashJobRequest({ version: 1, kind: "hash-job", jobId: id2, file, maximumBytes: options.maximumBytes });
    } catch {
      return Promise.reject(new WorkerError("INVALID_MESSAGE"));
    }
    if (options.signal?.aborted) return Promise.reject(new WorkerError("CANCELLED"));
    if (this.queue.length >= 32) return Promise.reject(new WorkerError("QUEUE_FULL"));
    return new Promise((resolve, reject) => {
      const job = { id: id2, file, options, resolve, reject, abort: () => {
        this.cancel(job);
      } };
      options.signal?.addEventListener("abort", job.abort, { once: true });
      this.queue.push(job);
      this.pump();
    });
  }
  cancel(job) {
    job.error ??= new WorkerError("CANCELLED");
    if (job.slot) {
      this.retire(job.slot);
      return;
    }
    const index = this.queue.indexOf(job);
    if (index >= 0) this.queue.splice(index, 1);
    job.options.signal?.removeEventListener("abort", job.abort);
    job.reject(job.error);
  }
  spawn() {
    const worker = new import_node_worker_threads2.Worker(this.entry, { workerData: { version: 1, kind: "hash-session" }, resourceLimits: { maxOldGenerationSizeMb: 64 } });
    this.spawned++;
    let ended = () => {
    };
    const slot = { worker, ready: false, retiring: false, ended: new Promise((resolve) => {
      ended = resolve;
    }) };
    this.slots.add(slot);
    worker.on("message", (input) => {
      this.receive(slot, input);
    });
    worker.once("error", () => {
      if (slot.job) slot.job.error ??= new WorkerError("WORKER_FAILED");
      this.retire(slot);
    });
    worker.once("exit", () => {
      this.slots.delete(slot);
      if (slot.job) this.finish(slot, void 0, slot.job.error ?? new WorkerError("WORKER_FAILED"));
      ended();
      this.pump();
    });
    return slot;
  }
  retire(slot) {
    if (slot.retiring) return;
    slot.retiring = true;
    void slot.worker.terminate();
  }
  send(slot) {
    const job = slot.job;
    if (!slot.ready || slot.retiring || !job) return;
    try {
      slot.worker.postMessage({ version: 1, kind: "hash-job", jobId: job.id, file: job.file, maximumBytes: job.options.maximumBytes });
    } catch {
      job.error = new WorkerError("WORKER_FAILED");
      this.retire(slot);
    }
  }
  receive(slot, input) {
    if (slot.retiring) return;
    try {
      const reply = parseReply(input);
      if (reply.kind === "hash-ready") {
        if (slot.ready) throw new WorkerError("INVALID_MESSAGE");
        slot.ready = true;
        this.send(slot);
        return;
      }
      if (reply.kind === "startup-failed") throw new WorkerError(reply.code);
      if (!["hash-job-progress", "hash-job-result", "hash-job-failed"].includes(reply.kind) || !("jobId" in reply)) throw new WorkerError("INVALID_MESSAGE");
      const job = slot.job;
      if (!job || reply.jobId !== job.id) return;
      if (reply.kind === "hash-job-progress") job.options.onProgress?.(reply.bytesDone, reply.bytesTotal);
      else if (reply.kind === "hash-job-result") this.finish(slot, reply.result);
      else if (reply.kind === "hash-job-failed") this.finish(slot, void 0, new WorkerError(reply.code));
    } catch (error) {
      if (slot.job) slot.job.error ??= error instanceof WorkerError ? error : new WorkerError("WORKER_FAILED");
      this.retire(slot);
    }
  }
  pump() {
    while (!this.closed && this.queue.length) {
      let slot = [...this.slots].find((item) => !item.retiring && !item.job);
      if (!slot && this.slots.size >= this.concurrency) return;
      const job = this.queue.shift();
      try {
        slot ??= this.spawn();
      } catch {
        job.options.signal?.removeEventListener("abort", job.abort);
        job.reject(new WorkerError("WORKER_FAILED"));
        continue;
      }
      slot.job = job;
      job.slot = slot;
      const owned = slot;
      job.timer = setTimeout(() => {
        job.error ??= new WorkerError("TIMEOUT");
        this.retire(owned);
      }, 12e4);
      this.send(slot);
    }
  }
  finish(slot, result2, error) {
    const job = slot.job;
    if (!job) return;
    clearTimeout(job.timer);
    job.options.signal?.removeEventListener("abort", job.abort);
    delete slot.job;
    delete job.slot;
    if (job.error || error) job.reject(job.error ?? error);
    else if (result2) job.resolve(result2);
    else job.reject(new WorkerError("WORKER_FAILED"));
    this.pump();
  }
  /** Cancels queued/active work, terminates idle sessions and joins all threads before resolving. */
  close() {
    if (this.closing) return this.closing;
    this.closed = true;
    for (const job of [...this.queue]) this.cancel(job);
    const slots = [...this.slots];
    for (const slot of slots) {
      if (slot.job) this.cancel(slot.job);
      else this.retire(slot);
    }
    this.closing = Promise.all(slots.map((slot) => slot.ended)).then(() => {
    });
    return this.closing;
  }
};

// src/services/workers/native-extractor.ts
var import_node_worker_threads3 = require("node:worker_threads");

// src/services/workers/native-protocol.ts
var import_node_path5 = __toESM(require("node:path"), 1);
var NATIVE_CODES = ["INVALID_ARCHIVE", "UNSAFE_ARCHIVE", "ARCHIVE_LIMIT", "HASH_MISMATCH", "ARCHIVE_IO"];
var absolute = (value) => typeof value === "string" && value.length <= 32760 && import_node_path5.default.isAbsolute(value);
function parseNativeRequest(value) {
  if (!exactObject(value, ["version", "kind", "destination", "archives"]) || value.version !== 1 || value.kind !== "native-extract" || !absolute(value.destination) || !Array.isArray(value.archives) || value.archives.length > 64) throw new Error("INVALID_ARCHIVE");
  const archives = value.archives.map((item) => {
    if (!exactObject(item, ["file", "sha256", "size", "exclude"]) || !absolute(item.file) || typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256) || typeof item.size !== "number" || !Number.isSafeInteger(item.size) || item.size < 0 || item.size > 64 * 1024 * 1024 || !Array.isArray(item.exclude) || item.exclude.length > 64 || !item.exclude.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 1024)) throw new Error("INVALID_ARCHIVE");
    return { file: item.file, sha256: item.sha256, size: item.size, exclude: [...item.exclude] };
  });
  return { version: 1, kind: "native-extract", destination: value.destination, archives };
}
function parseNativeReply(value) {
  if (exactObject(value, ["version", "kind", "files", "bytes"]) && value.version === 1 && value.kind === "native-result" && typeof value.files === "number" && Number.isSafeInteger(value.files) && value.files >= 0 && value.files <= 4096 && typeof value.bytes === "number" && Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.bytes <= 256 * 1024 * 1024) return value;
  if (exactObject(value, ["version", "kind", "code"]) && value.version === 1 && value.kind === "native-failed" && typeof value.code === "string" && NATIVE_CODES.includes(value.code)) return value;
  throw new Error("INVALID_ARCHIVE");
}

// src/services/workers/native-extractor.ts
var ExtractionError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "ExtractionError";
    this.category = code3 === "CANCELLED" ? "cancelled" : code3 === "EXTRACTION_BUSY" ? "biz" : code3 === "HASH_MISMATCH" ? "network" : code3 === "ARCHIVE_IO" ? "disk" : code3 === "WORKER_FAILED" || code3 === "EXTRACTION_TIMEOUT" ? "system" : "validation";
  }
  code;
  category;
};
var NativeExtractor = class {
  constructor(entry, timeoutMs = 12e4) {
    this.entry = entry;
    this.timeoutMs = timeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12e4) throw new ExtractionError("INVALID_ARCHIVE");
  }
  entry;
  timeoutMs;
  active;
  closed = false;
  /** Extracts into an empty installer-owned staging directory; no existing natives/player directory is accepted. */
  run(destination, archives, options = {}) {
    if (this.closed) return Promise.reject(new ExtractionError("WORKER_FAILED"));
    if (this.active) return Promise.reject(new ExtractionError("EXTRACTION_BUSY"));
    let request;
    try {
      request = parseNativeRequest({ version: 1, kind: "native-extract", destination, archives });
    } catch {
      return Promise.reject(new ExtractionError("INVALID_ARCHIVE"));
    }
    if (options.signal?.aborted) return Promise.reject(new ExtractionError("CANCELLED"));
    let worker;
    try {
      worker = new import_node_worker_threads3.Worker(this.entry, { workerData: request, resourceLimits: { maxOldGenerationSizeMb: 128 } });
    } catch {
      return Promise.reject(new ExtractionError("WORKER_FAILED"));
    }
    let failure3;
    let result2;
    let finish = () => {
    };
    const done = new Promise((resolve) => {
      finish = resolve;
    });
    const stop = (error = new ExtractionError("CANCELLED")) => {
      failure3 ??= error;
      void worker.terminate().catch(() => {
      });
    };
    const abort = () => stop();
    const timer = setTimeout(() => stop(new ExtractionError("EXTRACTION_TIMEOUT")), this.timeoutMs);
    this.active = { done, stop: abort };
    return new Promise((resolve, reject) => {
      worker.on("message", (value) => {
        if (result2 || failure3) {
          if (!failure3) stop(new ExtractionError("WORKER_FAILED"));
          return;
        }
        try {
          const reply = parseNativeReply(value);
          if (reply.kind === "native-failed") failure3 = new ExtractionError(reply.code);
          else result2 = { files: reply.files, bytes: reply.bytes };
        } catch {
          stop(new ExtractionError("WORKER_FAILED"));
        }
      });
      worker.once("error", () => {
        failure3 ??= new ExtractionError("WORKER_FAILED");
      });
      worker.once("exit", (code3) => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        delete this.active;
        finish();
        if (failure3) reject(failure3);
        else if (code3 !== 0 || !result2) reject(new ExtractionError("WORKER_FAILED"));
        else resolve(result2);
      });
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
    });
  }
  /** Stops admission and waits for all worker-held handles to be released before the caller may remove staging. */
  async close() {
    this.closed = true;
    const active = this.active;
    active?.stop();
    await active?.done;
  }
};

// src/services/objects/store.ts
var import_promises5 = require("node:fs/promises");
var import_node_crypto12 = require("node:crypto");
var import_node_path7 = __toESM(require("node:path"), 1);

// src/core/download/integrity.ts
function verifyArtifact(expected, observed) {
  const hex3 = (value, length) => value.length === length && /^[a-fA-F0-9]+$/.test(value);
  if (!["sha1", "sha256"].includes(expected.algorithm) || !Number.isSafeInteger(expected.size) || expected.size < 0 || !Number.isSafeInteger(observed.size) || observed.size < 0 || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(expected.provenanceId) || !hex3(expected.digest, expected.algorithm === "sha1" ? 40 : 64) || !hex3(observed.sha1, 40) || !hex3(observed.sha256, 64)) {
    return { ok: false, code: "INVALID_INTEGRITY_FACTS" };
  }
  if (expected.size !== observed.size) return { ok: false, code: "SIZE_MISMATCH" };
  if (expected.digest.toLowerCase() !== observed[expected.algorithm].toLowerCase()) return { ok: false, code: "HASH_MISMATCH" };
  return { ok: true, objectDigest: observed.sha256.toLowerCase(), provenanceId: expected.provenanceId };
}

// src/services/objects/owner-lease.ts
var import_node_sqlite2 = require("node:sqlite");
var import_node_crypto11 = require("node:crypto");
var import_promises4 = require("node:fs/promises");
var import_node_path6 = __toESM(require("node:path"), 1);
var MARKER_NAME = "objects.owner.lock";
var GUARD_NAME2 = "objects.owner.guard.sqlite";
var APPLICATION_ID2 = 1330990919;
var DOMAIN = "oucl.object-store.v1";
var PREFIX = "oucl-object-owner-v1:";
var MARKER2 = /^oucl-object-owner-v1:([a-f0-9-]{36}):(\d+):(\d+):(\d+):(\d+)$/;
var SIDECARS = ["-journal", "-wal", "-shm"];
async function identity(file, directory2 = false) {
  const info = await (0, import_promises4.lstat)(file, { bigint: true });
  if (info.isSymbolicLink() || info.ino === 0n || (directory2 ? !info.isDirectory() : !info.isFile() || info.nlink !== 1n)) throw new ObjectError("NEEDS_RECOVERY");
  return { dev: info.dev, ino: info.ino };
}
function same2(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}
async function present(file) {
  try {
    await identity(file);
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}
async function marker(file) {
  let before;
  try {
    before = await identity(file);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return void 0;
    throw error;
  }
  const bytes = await readRegular(file, 512);
  if (!bytes || !same2(before, await identity(file))) throw new ObjectError("NEEDS_RECOVERY");
  return { text: bytes.toString("utf8"), identity: before };
}
function accepted(value) {
  const match = MARKER2.exec(value);
  if (!match || !UUID_PATTERN.test(match[1])) throw new ObjectError(value.startsWith(PREFIX) ? "NEEDS_RECOVERY" : "STORE_BUSY");
}
function failure(error) {
  if (error instanceof ObjectError) return error;
  if (typeof error === "object" && error !== null && "errcode" in error && typeof error.errcode === "number" && (error.errcode & 255) === 5) return new ObjectError("STORE_BUSY");
  return new ObjectError("NEEDS_RECOVERY");
}
function combined(error, cleanup) {
  return Object.assign(new ObjectError("NEEDS_RECOVERY"), { cause: new AggregateError([error, cleanup], "OBJECT_LEASE_CLEANUP_FAILED") });
}
var ObjectOwnerLease = class _ObjectOwnerLease {
  constructor(root, rootIdentity, owned, db, guardIdentity, guardId) {
    this.root = root;
    this.rootIdentity = rootIdentity;
    this.owned = owned;
    this.db = db;
    this.guardIdentity = guardIdentity;
    this.guardId = guardId;
  }
  root;
  rootIdentity;
  owned;
  db;
  guardIdentity;
  guardId;
  invalid = false;
  closed = false;
  /** Windows reclaims only identity-bound object markers after obtaining the same OS lock; other platforms keep UUID exclusion. */
  static async acquire(root) {
    try {
      return await _ObjectOwnerLease.acquireRoot(root);
    } catch (error) {
      throw failure(error);
    }
  }
  static async acquireRoot(root) {
    const canonical = await guardDirectory(root);
    const rootIdentity = await identity(canonical, true);
    const markerPath = import_node_path6.default.join(canonical, MARKER_NAME);
    if (process.platform !== "win32") {
      const token = (0, import_node_crypto11.randomUUID)();
      let handle;
      try {
        handle = await (0, import_promises4.open)(markerPath, "wx");
      } catch (error) {
        throw new ObjectError(hasCode(error, "EEXIST") ? "STORE_BUSY" : "OBJECT_IO");
      }
      try {
        await handle.writeFile(token);
        await handle.sync();
      } finally {
        await handle.close();
      }
      const owned = await marker(markerPath);
      if (!owned || owned.text !== token) throw new ObjectError("NEEDS_RECOVERY");
      return new _ObjectOwnerLease(canonical, rootIdentity, owned);
    }
    const prior = await marker(markerPath);
    if (prior) accepted(prior.text);
    const file = import_node_path6.default.join(canonical, GUARD_NAME2);
    let exists2 = await present(file);
    for (const suffix of SIDECARS) {
      if (await present(file + suffix)) throw new ObjectError("NEEDS_RECOVERY");
    }
    if (!exists2 && prior) throw new ObjectError("NEEDS_RECOVERY");
    if (!exists2) {
      try {
        const handle = await (0, import_promises4.open)(file, "wx");
        await handle.close();
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
        exists2 = true;
      }
    }
    const before = await identity(file);
    let db;
    try {
      db = new import_node_sqlite2.DatabaseSync(file);
      db.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE;");
      if (!same2(before, await identity(file)) || !same2(rootIdentity, await identity(canonical, true))) throw new ObjectError("NEEDS_RECOVERY");
      if (db.prepare("PRAGMA journal_mode").get()?.journal_mode !== "delete") throw new ObjectError("NEEDS_RECOVERY");
      if (!exists2) {
        db.exec("CREATE TABLE object_owner (id TEXT NOT NULL, domain TEXT NOT NULL);");
        db.prepare("INSERT INTO object_owner VALUES (?, ?)").run((0, import_node_crypto11.randomUUID)(), DOMAIN);
        db.exec(`PRAGMA application_id=${APPLICATION_ID2}; PRAGMA user_version=1; COMMIT; BEGIN IMMEDIATE;`);
      }
      if (db.prepare("PRAGMA application_id").get()?.application_id !== APPLICATION_ID2 || db.prepare("PRAGMA user_version").get()?.user_version !== 1 || db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") throw new ObjectError("NEEDS_RECOVERY");
      const schema = db.prepare("SELECT type, name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
      if (schema.length !== 1 || schema[0]?.type !== "table" || schema[0]?.name !== "object_owner") throw new ObjectError("NEEDS_RECOVERY");
      const rows = db.prepare("SELECT id, domain FROM object_owner").all();
      const id2 = rows[0]?.id;
      if (rows.length !== 1 || typeof id2 !== "string" || !UUID_PATTERN.test(id2) || rows[0]?.domain !== DOMAIN) throw new ObjectError("NEEDS_RECOVERY");
      const text4 = `${PREFIX}${id2}:${before.dev}:${before.ino}:${rootIdentity.dev}:${rootIdentity.ino}`;
      let current = await marker(markerPath);
      if (current) {
        accepted(current.text);
        if (current.text !== text4) throw new ObjectError("NEEDS_RECOVERY");
      } else {
        let handle;
        try {
          handle = await (0, import_promises4.open)(markerPath, "wx");
        } catch (error) {
          throw new ObjectError(hasCode(error, "EEXIST") ? "STORE_BUSY" : "OBJECT_IO");
        }
        try {
          await handle.writeFile(text4);
          await handle.sync();
        } finally {
          await handle.close();
        }
        current = await marker(markerPath);
      }
      if (!current || current.text !== text4) throw new ObjectError("NEEDS_RECOVERY");
      const lease = new _ObjectOwnerLease(canonical, rootIdentity, current, db, before, id2);
      await lease.verify();
      return lease;
    } catch (error) {
      try {
        db?.close();
      } catch (cleanup) {
        throw combined(error, cleanup);
      }
      throw failure(error);
    }
  }
  /** Check before effects and after asynchronous boundaries; once evidence is lost this instance stays invalid. */
  async verify() {
    if (this.closed || this.invalid) throw new ObjectError("NEEDS_RECOVERY");
    try {
      if (await guardDirectory(this.root) !== this.root || !same2(this.rootIdentity, await identity(this.root, true))) throw new ObjectError("NEEDS_RECOVERY");
      const current = await marker(import_node_path6.default.join(this.root, MARKER_NAME));
      if (!current || current.text !== this.owned.text || !same2(current.identity, this.owned.identity)) throw new ObjectError("NEEDS_RECOVERY");
      if (this.db) {
        const file = import_node_path6.default.join(this.root, GUARD_NAME2);
        if (!this.guardIdentity || !same2(this.guardIdentity, await identity(file))) throw new ObjectError("NEEDS_RECOVERY");
        for (const suffix of SIDECARS) if (await present(file + suffix)) throw new ObjectError("NEEDS_RECOVERY");
        const rows = this.db.prepare("SELECT id, domain FROM object_owner").all();
        if (rows.length !== 1 || rows[0]?.id !== this.guardId || rows[0]?.domain !== DOMAIN) throw new ObjectError("NEEDS_RECOVERY");
      }
    } catch (error) {
      this.invalid = true;
      throw error instanceof ObjectError ? error : new ObjectError("NEEDS_RECOVERY");
    }
  }
  release() {
    const db = this.db;
    if (!db) return;
    let rollbackError;
    try {
      db.exec("ROLLBACK");
    } catch (error) {
      rollbackError = error;
    }
    try {
      db.close();
      this.db = void 0;
    } catch (error) {
      if (rollbackError) throw combined(rollbackError, error);
      throw error;
    }
    if (rollbackError) throw rollbackError;
  }
  /** Caller must first drain all object work. Invalid evidence is preserved, even when the OS handle is released. */
  async close() {
    if (this.closed) return;
    let original;
    try {
      await this.verify();
      await (0, import_promises4.unlink)(import_node_path6.default.join(this.root, MARKER_NAME));
    } catch (error) {
      original = error;
    }
    this.closed = true;
    try {
      this.release();
    } catch (cleanup) {
      throw original ? combined(original, cleanup) : failure(cleanup);
    }
    if (original) throw original;
  }
};

// src/services/objects/store.ts
async function directory(parent, name2) {
  await guardDirectory(parent);
  const target = import_node_path7.default.join(parent, name2);
  try {
    await (0, import_promises5.mkdir)(target);
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
  }
  return guardDirectory(target);
}
async function exists(file) {
  try {
    const info = await (0, import_promises5.lstat)(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new ObjectError("NEEDS_RECOVERY");
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}
var ObjectStore = class _ObjectStore {
  constructor(root, lease, index, hasher) {
    this.root = root;
    this.lease = lease;
    this.index = index;
    this.hasher = hasher;
  }
  root;
  lease;
  index;
  hasher;
  tail = Promise.resolve();
  closed = false;
  closing;
  /** Claims a dedicated registered store directory; stale/foreign owners remain fail-closed. */
  static async open(root, index, hasher) {
    let canonical;
    try {
      canonical = await guardDirectory(root);
    } catch {
      throw new ObjectError("OBJECT_IO");
    }
    const lease = await ObjectOwnerLease.acquire(canonical);
    try {
      await lease.verify();
      await directory(canonical, "staging");
      await lease.verify();
      await directory(await directory(canonical, "objects"), "sha256");
      await lease.verify();
      return new _ObjectStore(canonical, lease, index, hasher);
    } catch (error) {
      try {
        await lease.close();
      } catch (cleanup) {
        throw Object.assign(new ObjectError("NEEDS_RECOVERY"), { cause: new AggregateError([error, cleanup], "OBJECT_OPEN_CLEANUP_FAILED") });
      }
      throw error instanceof ObjectError ? error : new ObjectError("OBJECT_IO");
    }
  }
  serial(work) {
    if (this.closed || this.closing) return Promise.reject(new ObjectError("OBJECT_IO"));
    const pending = this.tail.then(async () => {
      if (this.closed) throw new ObjectError("OBJECT_IO");
      try {
        await this.lease.verify();
        const result2 = await work();
        await this.lease.verify();
        return result2;
      } catch (error) {
        throw error instanceof ObjectError ? error : new ObjectError(hasCode(error, "NEEDS_RECOVERY") || hasCode(error, "UNSAFE_PATH") ? "NEEDS_RECOVERY" : "OBJECT_IO");
      }
    });
    this.tail = pending.then(() => {
    }, () => {
    });
    return pending;
  }
  staging(id2) {
    if (!UUID_PATTERN.test(id2)) throw new ObjectError("INVALID_ARTIFACT");
    return import_node_path7.default.join(this.root, "staging", `${id2}.part`);
  }
  objectFile(digest3) {
    if (!/^[a-f0-9]{64}$/.test(digest3)) throw new ObjectError("INVALID_ARTIFACT");
    return import_node_path7.default.join(this.root, "objects", "sha256", digest3.slice(0, 2), digest3);
  }
  /** Allocates a private writable file for the downloader; this path must never cross renderer IPC. */
  createStaging() {
    return this.serial(async () => {
      await guardDirectory(import_node_path7.default.join(this.root, "staging"));
      await this.lease.verify();
      const id2 = (0, import_node_crypto12.randomUUID)();
      const file = this.staging(id2);
      const handle = await (0, import_promises5.open)(file, "wx");
      await handle.close();
      return { id: id2, file };
    });
  }
  /** Resolves only a known durable staging UUID; unknown or linked entries never become writable targets. */
  resumeStaging(id2) {
    return this.serial(async () => {
      const file = this.staging(id2);
      await guardDirectory(import_node_path7.default.dirname(file));
      if (!await exists(file)) throw new ObjectError("NEEDS_RECOVERY");
      return file;
    });
  }
  async verify(file, expected, digest3) {
    const bytes = await this.hasher.hash(file, { maximumBytes: 64 * 1024 ** 3 });
    await this.lease.verify();
    const result2 = verifyArtifact(expected, bytes);
    if (!result2.ok) throw new ObjectError("HASH_MISMATCH");
    if (digest3 !== void 0 && bytes.sha256 !== digest3) throw new ObjectError("NEEDS_RECOVERY");
    return bytes;
  }
  async proof(objectDigest, key) {
    const folder = `${this.objectFile(objectDigest)}.sources`;
    try {
      await guardDirectory(folder);
    } catch (error) {
      if (hasCode(error, "ENOENT")) return void 0;
      throw error;
    }
    const bytes = await readRegular(import_node_path7.default.join(folder, `${key}.json`), 65536);
    if (bytes === void 0) return void 0;
    const value = parseProvenance(bytes);
    if (value.objectDigest !== objectDigest || sourceKey(value.expected, value.anchor) !== key) throw new ObjectError("NEEDS_RECOVERY");
    return value;
  }
  /** Uses hints only after verifying their exact provenance sidecar and actual object bytes. */
  lookup(expected, anchor) {
    return this.serial(async () => {
      const facts = definition(expected, anchor);
      const key = sourceKey(facts.expected, facts.anchor);
      const found = await this.index.lookup(key);
      if (!found) return void 0;
      const proof = await this.proof(found.digest, key);
      if (!proof) return void 0;
      if (proof.expected.size !== found.size || found.size !== facts.expected.size) throw new ObjectError("NEEDS_RECOVERY");
      await this.verify(this.objectFile(found.digest), facts.expected, found.digest);
      return { ...found, sourceKey: key };
    });
  }
  async saveProof(digest3, facts) {
    const key = sourceKey(facts.expected, facts.anchor);
    const target = this.objectFile(digest3);
    const proof = { schemaVersion: 1, objectDigest: digest3, ...facts };
    await this.lease.verify();
    const sources = await directory(import_node_path7.default.dirname(target), import_node_path7.default.basename(target) + ".sources");
    const old = await this.proof(digest3, key);
    if (!old) {
      await this.lease.verify();
      const temporary = import_node_path7.default.join(sources, `${(0, import_node_crypto12.randomUUID)()}.tmp`);
      const handle = await (0, import_promises5.open)(temporary, "wx");
      try {
        await handle.writeFile(JSON.stringify(proof) + "\n");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.lease.verify();
      await (0, import_promises5.rename)(temporary, import_node_path7.default.join(sources, `${key}.json`));
    }
    return key;
  }
  /** Rechecks existing content against another independently trusted source before recording its own proof. */
  adopt(digest3, expected, anchor) {
    return this.serial(async () => {
      const facts = definition(expected, anchor);
      const bytes = await this.verify(this.objectFile(digest3), facts.expected, digest3);
      const key = await this.saveProof(digest3, facts);
      const object4 = { digest: digest3, size: bytes.size };
      await this.lease.verify();
      await this.index.remember(key, object4);
      return { ...object4, sourceKey: key };
    });
  }
  /** Commits only fully verified staging bytes; equal existing content is checked and shared, never overwritten. */
  commit(id2, expected, anchor, checkpoint = async () => {
  }) {
    return this.serial(async () => {
      const facts = definition(expected, anchor);
      const key = sourceKey(facts.expected, facts.anchor);
      const staging = this.staging(id2);
      await guardDirectory(import_node_path7.default.dirname(staging));
      if (!await exists(staging)) throw new ObjectError("INVALID_ARTIFACT");
      const observed = await this.verify(staging, facts.expected);
      const target = this.objectFile(observed.sha256);
      await this.lease.verify();
      await directory(import_node_path7.default.dirname(import_node_path7.default.dirname(target)), observed.sha256.slice(0, 2));
      if (await exists(target)) {
        await this.verify(target, facts.expected, observed.sha256);
        await this.lease.verify();
        await (0, import_promises5.unlink)(staging);
      } else {
        const handle = await (0, import_promises5.open)(staging, "r+");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
        await this.lease.verify();
        await (0, import_promises5.rename)(staging, target);
      }
      await this.lease.verify();
      await (0, import_promises5.chmod)(target, 292);
      await checkpoint("object-committed");
      await this.lease.verify();
      await this.saveProof(observed.sha256, facts);
      await checkpoint("proof-committed");
      await this.lease.verify();
      const object4 = { digest: observed.sha256, size: observed.size };
      await this.index.remember(key, object4);
      return { ...object4, sourceKey: key };
    });
  }
  /** Rebuilds search hints from sidecars plus actual bytes. Orphan bytes are retained without acquiring trust. */
  rebuildIndex() {
    return this.serial(async () => {
      await this.index.clear();
      await this.lease.verify();
      let count = 0;
      const objects2 = import_node_path7.default.join(this.root, "objects", "sha256");
      await guardDirectory(objects2);
      for (const prefix of await (0, import_promises5.readdir)(objects2)) {
        if (!/^[a-f0-9]{2}$/.test(prefix)) throw new ObjectError("NEEDS_RECOVERY");
        const folder = import_node_path7.default.join(objects2, prefix);
        await guardDirectory(folder);
        for (const name2 of await (0, import_promises5.readdir)(folder)) {
          if (!/^[a-f0-9]{64}\.sources$/.test(name2)) continue;
          const digest3 = name2.slice(0, 64);
          if (!digest3.startsWith(prefix)) throw new ObjectError("NEEDS_RECOVERY");
          const sources = import_node_path7.default.join(folder, name2);
          await guardDirectory(sources);
          for (const entry of await (0, import_promises5.readdir)(sources)) {
            if (entry.endsWith(".tmp")) continue;
            if (!/^[a-f0-9]{64}\.json$/.test(entry)) throw new ObjectError("NEEDS_RECOVERY");
            const key = entry.slice(0, 64);
            const proof = await this.proof(digest3, key);
            if (!proof) throw new ObjectError("NEEDS_RECOVERY");
            await this.verify(this.objectFile(digest3), proof.expected, digest3);
            await this.lease.verify();
            await this.index.remember(key, { digest: digest3, size: proof.expected.size });
            count++;
          }
        }
      }
      return count;
    });
  }
  /** Deletes one known staging entry, never an object or a linked target. */
  discardStaging(id2) {
    return this.serial(async () => {
      const file = this.staging(id2);
      await guardDirectory(import_node_path7.default.dirname(file));
      if (await exists(file)) {
        await this.lease.verify();
        await (0, import_promises5.unlink)(file);
      }
    });
  }
  /** Releases this owner after all admitted commits finish. Does not close externally owned index/hasher. */
  close() {
    this.closing ??= this.tail.then(async () => {
      this.closed = true;
      await this.lease.close();
    });
    return this.closing;
  }
};

// src/services/download/coordinator.ts
var CoordinatorError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "CoordinatorError";
    this.category = code3 === "CALLBACK_FAILED" ? "system" : "biz";
  }
  code;
  category;
};
var DownloadCoordinator = class {
  constructor(physical, attestor, concurrency = 4, maxJobs = 128, maxConsumers = 1024) {
    this.physical = physical;
    this.attestor = attestor;
    this.concurrency = concurrency;
    this.maxJobs = maxJobs;
    this.maxConsumers = maxConsumers;
    const limit = this.limit();
    if (![maxJobs, maxConsumers].every(Number.isSafeInteger) || maxJobs < limit || maxJobs > 4096 || maxConsumers < 1 || maxConsumers > 1e4) throw new CoordinatorError("INVALID_CONSUMER");
  }
  physical;
  attestor;
  concurrency;
  maxJobs;
  maxConsumers;
  jobs = /* @__PURE__ */ new Map();
  consumers = /* @__PURE__ */ new Map();
  deliveries = /* @__PURE__ */ new Set();
  active = 0;
  closed = false;
  limit() {
    const value = typeof this.concurrency === "number" ? this.concurrency : this.concurrency();
    if (!Number.isSafeInteger(value) || value < 1 || value > 16) throw new CoordinatorError("INVALID_CONSUMER");
    return value;
  }
  /** Registers a stable internal consumer; UI event unsubscribe must never call cancel. */
  request(spec, options) {
    if (this.closed || !UUID_PATTERN.test(options.consumerId) || this.consumers.has(options.consumerId) || !isArtifactUrl(spec.url)) throw new CoordinatorError("INVALID_CONSUMER");
    const canonical = { url: spec.url, ...definition(spec.expected, spec.anchor) };
    const realm = canonical.anchor.kind.startsWith("mojang-") ? "mojang" : canonical.anchor.kind === "modrinth-version" ? "modrinth" : canonical.anchor.kind.startsWith("loader-") ? "loader" : "adoptium";
    const key = `${realm}:${canonical.expected.algorithm}:${canonical.expected.digest}:${canonical.expected.size}`;
    let job = this.jobs.get(key);
    if (this.consumers.size >= this.maxConsumers || !job && this.jobs.size >= this.maxJobs) throw new CoordinatorError("QUEUE_FULL");
    if (!job) {
      job = { key, spec: canonical, consumers: /* @__PURE__ */ new Set(), proofs: /* @__PURE__ */ new Map() };
      this.jobs.set(key, job);
    }
    let resolve = () => {
    };
    let reject = () => {
    };
    const result2 = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void result2.catch(() => {
    });
    const consumer = {
      id: options.consumerId,
      spec: canonical,
      state: "active",
      options,
      job,
      resolve,
      reject,
      abort: () => {
        void this.cancel(consumer).catch(() => {
        });
      }
    };
    const handle = Object.freeze({
      id: consumer.id,
      result: result2,
      state: () => consumer.state,
      pause: () => this.pause(consumer),
      resume: () => this.resume(consumer),
      cancel: () => this.cancel(consumer)
    });
    this.consumers.set(consumer.id, consumer);
    job.consumers.add(consumer);
    options.signal?.addEventListener("abort", consumer.abort, { once: true });
    if (options.signal?.aborted) void this.cancel(consumer);
    else if (job.object) this.deliver(consumer);
    this.pump();
    return handle;
  }
  demand(job) {
    return [...job.consumers].some((consumer) => consumer.state === "active");
  }
  settle(consumer, state2, value) {
    consumer.state = state2;
    consumer.options.signal?.removeEventListener("abort", consumer.abort);
    this.consumers.delete(consumer.id);
    consumer.job.consumers.delete(consumer);
    if (state2 === "completed") consumer.resolve({ ...value });
    else consumer.reject(value);
    this.clean(consumer.job);
  }
  clean(job) {
    if (!job.cycle && job.consumers.size === 0 && this.jobs.get(job.key) === job) this.jobs.delete(job.key);
  }
  pump() {
    if (this.closed) return;
    for (const job of this.jobs.values()) {
      if (this.active >= this.limit()) break;
      if (!job.cycle && !job.object && this.demand(job)) this.start(job);
    }
  }
  start(job) {
    const controller = new AbortController();
    job.controller = controller;
    this.active++;
    let release2 = () => {
    };
    job.cycle = new Promise((resolve) => {
      release2 = resolve;
    });
    void (async () => {
      let failure3;
      try {
        job.object = await this.physical.run(job.spec, { signal: controller.signal, onProgress: (done, total) => {
          if (job.controller !== controller || controller.signal.aborted) return;
          for (const consumer of [...job.consumers]) {
            if (consumer.state !== "active") continue;
            try {
              consumer.options.onProgress?.(done, total);
            } catch {
              this.settle(consumer, "failed", new CoordinatorError("CALLBACK_FAILED"));
            }
          }
          if (!this.demand(job)) controller.abort();
        } });
      } catch (error) {
        if (!(controller.signal.aborted && error instanceof DownloadError && error.code === "CANCELLED")) failure3 = error instanceof DownloadError ? error : new DownloadError("TRANSFER_IO");
      } finally {
        this.active--;
        delete job.controller;
        delete job.cycle;
        for (const consumer of [...job.consumers]) {
          if (failure3) {
            consumer.failure = failure3;
            this.settle(consumer, "failed", failure3);
          } else if (consumer.state === "cancelling") this.settle(consumer, "cancelled", new DownloadError("CANCELLED"));
          else if (consumer.state === "pausing") consumer.state = "paused";
        }
        if (job.object) {
          for (const consumer of job.consumers) if (consumer.state === "active") this.deliver(consumer);
        }
        this.clean(job);
        release2();
        this.pump();
      }
    })();
  }
  deliver(consumer) {
    const job = consumer.job;
    if (!job.object || consumer.delivery || consumer.state !== "active") return;
    const key = sourceKey(consumer.spec.expected, consumer.spec.anchor);
    let proof = job.proofs.get(key);
    if (!proof) {
      proof = key === job.object.sourceKey ? Promise.resolve(job.object) : this.attestor.adopt(job.object.digest, consumer.spec.expected, consumer.spec.anchor);
      job.proofs.set(key, proof);
    }
    const delivery = (async () => {
      try {
        const object4 = await proof;
        if (object4.digest !== job.object?.digest || object4.size !== consumer.spec.expected.size || object4.sourceKey !== key) throw new DownloadError("NEEDS_RECOVERY");
        if (consumer.state === "active") this.settle(consumer, "completed", object4);
      } catch (error) {
        consumer.failure = error instanceof DownloadError ? error : new DownloadError("TRANSFER_IO");
        if (consumer.state === "active" || consumer.state === "paused") this.settle(consumer, "failed", consumer.failure);
      } finally {
        if (consumer.delivery) this.deliveries.delete(consumer.delivery);
        delete consumer.delivery;
      }
    })();
    consumer.delivery = delivery;
    this.deliveries.add(delivery);
  }
  async pause(consumer) {
    if (this.closed) throw new CoordinatorError("INVALID_STATE");
    if (consumer.state === "pausing") {
      await consumer.job.cycle;
      return;
    }
    if (consumer.state === "paused") return;
    if (consumer.state !== "active") throw new CoordinatorError("INVALID_STATE");
    consumer.state = "paused";
    if (!this.demand(consumer.job) && consumer.job.cycle) {
      consumer.state = "pausing";
      consumer.job.controller?.abort();
      await consumer.job.cycle;
      if (consumer.state === "pausing") consumer.state = "paused";
    }
  }
  async resume(consumer) {
    if (consumer.state === "pausing") await consumer.job.cycle;
    if (consumer.state === "paused") await consumer.delivery;
    if (this.closed) throw new CoordinatorError("INVALID_STATE");
    if (consumer.state === "active") return;
    if (consumer.state !== "paused") throw new CoordinatorError("INVALID_STATE");
    consumer.state = "active";
    if (consumer.job.object) {
      consumer.job.proofs.clear();
      consumer.job.proofs.set(sourceKey(consumer.spec.expected, consumer.spec.anchor), this.attestor.adopt(consumer.job.object.digest, consumer.spec.expected, consumer.spec.anchor));
      this.deliver(consumer);
    } else this.pump();
  }
  async cancel(consumer) {
    if (consumer.state === "cancelled") return;
    if (consumer.state === "completed") throw new CoordinatorError("CANCEL_TOO_LATE");
    if (consumer.state === "failed") throw new CoordinatorError("INVALID_STATE");
    consumer.state = "cancelling";
    const job = consumer.job;
    if (!this.demand(job)) job.controller?.abort();
    if (!this.demand(job)) await job.cycle;
    await consumer.delivery;
    if (consumer.failure) {
      if (consumer.state === "cancelling") this.settle(consumer, "failed", consumer.failure);
      throw consumer.failure;
    }
    if (consumer.state === "cancelling") this.settle(consumer, "cancelled", new DownloadError("CANCELLED"));
  }
  /** Stops admission and joins physical work plus source-proof writes before resolving. */
  async close() {
    this.closed = true;
    const cancellations = await Promise.allSettled([...this.consumers.values()].map((consumer) => this.cancel(consumer)));
    await Promise.all([...this.jobs.values()].map((job) => job.cycle));
    await Promise.all(this.deliveries);
    const failed = cancellations.find((result2) => result2.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
};

// src/services/download/artifact-transfer.ts
var ArtifactTransfer = class {
  constructor(http, journal, objects2) {
    this.http = http;
    this.journal = journal;
    this.objects = objects2;
  }
  http;
  journal;
  objects;
  active = /* @__PURE__ */ new Set();
  /** Downloads official anchored bytes, resumes a durable prefix and verifies before shared-object commit. */
  async run(spec, options = {}) {
    if (!isArtifactUrl(spec.url)) throw new DownloadError("INVALID_TRANSFER");
    let canonical;
    try {
      canonical = { url: spec.url, ...definition(spec.expected, spec.anchor) };
    } catch {
      throw new DownloadError("INVALID_TRANSFER");
    }
    const key = sourceKey(canonical.expected, canonical.anchor);
    if (this.active.has(key)) throw new DownloadError("TRANSFER_BUSY");
    this.active.add(key);
    let record3;
    try {
      if (options.signal?.aborted) throw new DownloadError("CANCELLED");
      const cached = await this.objects.lookup(canonical.expected, canonical.anchor);
      record3 = await this.journal.getTransfer(key);
      if (options.signal?.aborted) throw new DownloadError("CANCELLED");
      if (cached) {
        if (record3?.state === "committed" && record3.objectDigest !== cached.digest) throw new DownloadError("NEEDS_RECOVERY");
        if (record3?.state === "complete") await this.journal.saveTransfer(
          record3.revision,
          parseTransferRecord({ ...record3, revision: record3.revision + 1, state: "committed", objectDigest: cached.digest })
        );
        options.onProgress?.(canonical.expected.size, canonical.expected.size);
        return cached;
      }
      if (record3?.state === "committed") throw new DownloadError("NEEDS_RECOVERY");
      let file;
      if (!record3) {
        const staged = await this.objects.createStaging();
        file = staged.file;
        record3 = parseTransferRecord({ ...canonical, key, stagingId: staged.id, revision: 1, bytesDone: 0, state: "partial" });
        await this.journal.saveTransfer(0, record3);
      } else {
        file = await this.objects.resumeStaging(record3.stagingId);
        if (record3.url !== canonical.url) {
          const base = { ...record3 };
          delete base.etag;
          delete base.lastModified;
          record3 = parseTransferRecord({ ...base, url: canonical.url, revision: record3.revision + 1, bytesDone: 0, state: "partial" });
          await this.journal.saveTransfer(record3.revision - 1, record3);
        }
      }
      record3 = await this.http.run(file, record3, (revision, next) => this.journal.saveTransfer(revision, next), options);
      if (options.signal?.aborted) throw new DownloadError("CANCELLED");
      let object4;
      try {
        object4 = await this.objects.commit(record3.stagingId, canonical.expected, canonical.anchor);
      } catch (error) {
        if (!hasCode(error, "HASH_MISMATCH") || record3.transportSource !== "bmclapi") throw error;
        const base = { ...record3 };
        delete base.etag;
        delete base.lastModified;
        const reset = parseTransferRecord({ ...base, transportSource: "official", revision: record3.revision + 1, bytesDone: 0, state: "partial" });
        await this.journal.saveTransfer(record3.revision, reset);
        record3 = reset;
        record3 = await this.http.run(file, record3, (revision, next) => this.journal.saveTransfer(revision, next), { ...options, officialOnly: true });
        if (options.signal?.aborted) throw new DownloadError("CANCELLED");
        object4 = await this.objects.commit(record3.stagingId, canonical.expected, canonical.anchor);
      }
      const committed = parseTransferRecord({ ...record3, revision: record3.revision + 1, state: "committed", objectDigest: object4.digest });
      await this.journal.saveTransfer(record3.revision, committed);
      return object4;
    } catch (error) {
      if (hasCode(error, "HASH_MISMATCH")) {
        if (record3?.state === "complete") {
          const base = { ...record3 };
          delete base.etag;
          delete base.lastModified;
          await this.journal.saveTransfer(record3.revision, parseTransferRecord({ ...base, revision: record3.revision + 1, bytesDone: 0, state: "partial" }));
        }
        throw new DownloadError("HASH_MISMATCH");
      }
      if (error instanceof DownloadError) throw error;
      throw new DownloadError(hasCode(error, "NEEDS_RECOVERY") ? "NEEDS_RECOVERY" : "TRANSFER_IO");
    } finally {
      this.active.delete(key);
    }
  }
};

// src/core/download/sources.ts
function bmclapiArtifactUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return void 0;
  if (url.hostname === "resources.download.minecraft.net") return `https://bmclapi2.bangbang93.com/assets${url.pathname}`;
  if (["libraries.minecraft.net", "maven.fabricmc.net", "maven.quiltmc.org", "maven.minecraftforge.net"].includes(url.hostname)) return `https://bmclapi2.bangbang93.com/maven${url.pathname}`;
  if (["piston-data.mojang.com", "launcher.mojang.com"].includes(url.hostname) && url.pathname.startsWith("/objects/")) return `https://bmclapi2.bangbang93.com${url.pathname}`;
  return void 0;
}
var MIRROR_HOSTS = ["bmclapi2.bangbang93.com", "mirrors.cernet.edu.cn", "mirrors.qlu.edu.cn"];
function isMirrorArtifactUrl(value) {
  try {
    const url = new URL(value);
    return value.length <= 2048 && url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash && !url.search && MIRROR_HOSTS.includes(url.hostname) && (url.hostname === "bmclapi2.bangbang93.com" ? ["/maven/", "/assets/", "/objects/"].some((prefix) => url.pathname.startsWith(prefix)) : url.pathname.startsWith("/bmclapi/"));
  } catch {
    return false;
  }
}

// src/services/download/http.ts
var import_promises6 = require("node:fs/promises");
var import_node_path8 = __toESM(require("node:path"), 1);
var CHECKPOINT_BYTES = 1024 * 1024;
function diskError(error) {
  if (error instanceof DownloadError) return error;
  if (hasCode(error, "ENOSPC")) return new DownloadError("DISK_FULL");
  if (hasCode(error, "UNSAFE_PATH") || hasCode(error, "ENOENT")) return new DownloadError("NEEDS_RECOVERY");
  if (hasCode(error, "EACCES") || hasCode(error, "EPERM")) return new DownloadError("DISK_PERMISSION");
  return new DownloadError("TRANSFER_IO");
}
function validators(response) {
  const etag = response.headers.get("etag");
  const modified = response.headers.get("last-modified");
  if (etag !== null && /^"[\x21\x23-\x7e]{0,180}"$/.test(etag)) return { etag };
  if (modified !== null && modified.length <= 80 && Number.isFinite(Date.parse(modified)) && new Date(modified).toUTCString() === modified) return { lastModified: modified };
  return {};
}
function retryAfter(response) {
  const value = response.headers.get("retry-after");
  if (value === null || value.length > 80) return void 0;
  const delay2 = /^\d+$/.test(value) ? Number(value) * 1e3 : Date.parse(value) - Date.now();
  return Number.isFinite(delay2) && delay2 >= 0 ? Math.min(delay2, 24 * 60 * 60 * 1e3) : void 0;
}
function contentLength(response) {
  const text4 = response.headers.get("content-length");
  if (text4 === null) return void 0;
  if (!/^\d+$/.test(text4) || !Number.isSafeInteger(Number(text4))) throw new DownloadError("BAD_RESPONSE");
  return Number(text4);
}
async function writableStaging(file, bytesDone) {
  try {
    await guardDirectory(import_node_path8.default.dirname(file));
    const before = await (0, import_promises6.lstat)(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size < bytesDone) throw new DownloadError("NEEDS_RECOVERY");
    const handle = await (0, import_promises6.open)(file, "r+");
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size < bytesDone) throw new DownloadError("NEEDS_RECOVERY");
      if (opened.size > bytesDone) {
        await handle.truncate(bytesDone);
        await handle.sync();
      }
      return handle;
    } catch (error) {
      await handle.close();
      throw error;
    }
  } catch (error) {
    throw diskError(error);
  }
}
async function closeStaging(handle) {
  try {
    await handle.close();
  } catch (error) {
    throw diskError(error);
  }
}
var HttpTransfer = class {
  constructor(request = fetch, timeouts = {}) {
    this.request = request;
    this.headersMs = timeouts.headersMs ?? 15e3;
    this.idleMs = timeouts.idleMs ?? 3e4;
    for (const value of [this.headersMs, this.idleMs]) if (!Number.isSafeInteger(value) || value < 1 || value > 12e4) throw new DownloadError("INVALID_TRANSFER");
  }
  request;
  headersMs;
  idleMs;
  /** Writes only to an already allocated staging file; fsync precedes every durable progress checkpoint. */
  async run(file, record3, checkpoint, options = {}) {
    let current = parseTransferRecord(record3);
    if (current.state === "committed") throw new DownloadError("INVALID_TRANSFER");
    if (options.signal?.aborted) throw new DownloadError("CANCELLED");
    const handle = await writableStaging(file, current.bytesDone);
    let position = current.bytesDone;
    let journalFailed = false;
    const save = async (changes, clearValidators = false) => {
      try {
        await handle.sync();
      } catch (error) {
        throw diskError(error);
      }
      const next = { ...current };
      if (clearValidators) {
        delete next.etag;
        delete next.lastModified;
      }
      Object.assign(next, changes);
      next.revision = current.revision + 1;
      const validated = parseTransferRecord(next);
      try {
        await checkpoint(current.revision, validated);
      } catch {
        journalFailed = true;
        throw new DownloadError("NEEDS_RECOVERY");
      }
      current = validated;
    };
    const reset = async () => {
      await save({ bytesDone: 0, state: "partial" }, true);
      position = 0;
      try {
        await handle.truncate(0);
        await handle.sync();
      } catch (error) {
        throw diskError(error);
      }
    };
    try {
      if (current.state === "complete") return current;
      if (position > 0 && !current.etag && !current.lastModified) await reset();
      for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        let timedOut = false;
        let timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, this.headersMs);
        const cancel = () => {
          controller.abort();
        };
        options.signal?.addEventListener("abort", cancel, { once: true });
        if (options.signal?.aborted) controller.abort();
        let response;
        try {
          const headers = { "accept-encoding": "identity" };
          const offset = position;
          const validator = current.etag ?? current.lastModified;
          if (offset > 0 && validator) {
            headers.range = `bytes=${offset}-`;
            headers["if-range"] = validator;
          }
          response = await this.request(current.url, { headers, signal: controller.signal, redirect: "error", credentials: "omit" });
          clearTimeout(timer);
          if (options.signal?.aborted) throw new DownloadError("CANCELLED");
          if ([408, 429, 500, 502, 503, 504].includes(response.status)) throw new DownloadError("RETRY_LATER", retryAfter(response));
          const encoding = response.headers.get("content-encoding");
          if (encoding !== null && encoding.toLowerCase() !== "identity") throw new DownloadError("BAD_RESPONSE");
          let badRange = false;
          let end = current.expected.size;
          if (response.status === 416) {
            const total = /^bytes \*\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
            if (offset === current.expected.size && total && Number(total[1]) === current.expected.size) {
              await save({ bytesDone: position, state: "complete" });
              return current;
            }
            badRange = true;
          } else if (response.status === 206) {
            const range2 = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
            const begin = Number(range2?.[1]);
            const last = Number(range2?.[2]);
            const total = Number(range2?.[3]);
            const receivedValidator = validators(response);
            badRange = offset === 0 || !range2 || ![begin, last, total].every(Number.isSafeInteger) || begin !== offset || last < begin || last >= total || total !== current.expected.size || current.etag !== void 0 && receivedValidator.etag !== current.etag || current.etag === void 0 && current.lastModified !== void 0 && response.headers.get("last-modified") !== current.lastModified;
            if (!badRange) {
              end = last + 1;
              const length = contentLength(response);
              if (length !== void 0 && length !== end - offset) badRange = true;
            }
          } else if (response.status === 200) {
            if (offset > 0) await reset();
            const length = contentLength(response);
            if (length !== void 0 && length !== current.expected.size) throw new DownloadError("BAD_RESPONSE");
            const receivedValidator = validators(response);
            await save({ ...receivedValidator, bytesDone: 0 }, true);
          } else throw new DownloadError("BAD_RESPONSE");
          if (badRange) {
            if (attempt > 0) throw new DownloadError("BAD_RESPONSE");
            controller.abort();
            await reset();
            continue;
          }
          if (!response.body) {
            if (current.expected.size !== 0) throw new DownloadError("BAD_RESPONSE");
          } else {
            const reader = response.body.getReader();
            const readChunk = async () => {
              let abort = () => {
              };
              const aborted = new Promise((_resolve, reject) => {
                abort = () => {
                  reject(new DownloadError(timedOut ? "TIMEOUT" : "CANCELLED"));
                };
                controller.signal.addEventListener("abort", abort, { once: true });
                if (controller.signal.aborted) abort();
              });
              try {
                return await Promise.race([reader.read(), aborted]);
              } finally {
                controller.signal.removeEventListener("abort", abort);
              }
            };
            const armIdle = () => {
              clearTimeout(timer);
              timer = setTimeout(() => {
                timedOut = true;
                controller.abort();
              }, this.idleMs);
            };
            armIdle();
            try {
              while (true) {
                const chunk = await readChunk();
                if (chunk.done) break;
                armIdle();
                if (position + chunk.value.byteLength > end || position + chunk.value.byteLength > current.expected.size) throw new DownloadError("BAD_RESPONSE");
                let written = 0;
                while (written < chunk.value.byteLength) {
                  let amount;
                  try {
                    amount = (await handle.write(chunk.value, written, chunk.value.byteLength - written, position)).bytesWritten;
                  } catch (error) {
                    throw diskError(error);
                  }
                  if (amount <= 0) throw new DownloadError("TRANSFER_IO");
                  written += amount;
                  position += amount;
                }
                options.onProgress?.(position, current.expected.size);
                if (position - current.bytesDone >= CHECKPOINT_BYTES) await save({ bytesDone: position });
                if (options.signal?.aborted) throw new DownloadError("CANCELLED");
              }
            } finally {
              clearTimeout(timer);
              controller.abort();
              await reader.cancel().catch(() => {
              });
              reader.releaseLock();
            }
          }
          if (options.signal?.aborted) throw new DownloadError("CANCELLED");
          if (timedOut) throw new DownloadError("TIMEOUT");
          if (position !== end || position !== current.expected.size) throw new DownloadError("NETWORK_FAILED");
          await save({ bytesDone: position, state: "complete" });
          return current;
        } catch (error) {
          if (journalFailed || error instanceof DownloadError && error.category === "disk") throw error instanceof DownloadError ? error : new DownloadError("NEEDS_RECOVERY");
          if (options.signal?.aborted && !journalFailed) throw new DownloadError("CANCELLED");
          if (timedOut) throw new DownloadError("TIMEOUT");
          throw error instanceof DownloadError ? error : new DownloadError("NETWORK_FAILED");
        } finally {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", cancel);
          controller.abort();
          if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {
          });
        }
      }
      throw new DownloadError("BAD_RESPONSE");
    } finally {
      try {
        if (!journalFailed && position !== current.bytesDone) await save({ bytesDone: position, state: "partial" });
      } finally {
        await closeStaging(handle);
      }
    }
  }
};

// src/services/download/request-budget.ts
var RequestBudget = class {
  constructor(total = 16, perHost = 8) {
    this.total = total;
    this.perHost = perHost;
    if (![total, perHost].every(Number.isSafeInteger) || total < 1 || total > 64 || perHost < 1 || perHost > total) throw new DownloadError("INVALID_TRANSFER");
  }
  total;
  perHost;
  active = 0;
  hosts = /* @__PURE__ */ new Map();
  queue = [];
  async run(host, signal, work) {
    const release2 = await this.acquire(host, signal);
    try {
      if (signal?.aborted) throw new DownloadError("CANCELLED");
      return await work();
    } finally {
      release2();
    }
  }
  acquire(host, signal) {
    if (signal?.aborted) return Promise.reject(new DownloadError("CANCELLED"));
    if (this.queue.length >= 256) return Promise.reject(new DownloadError("TRANSFER_BUSY"));
    return new Promise((resolve, reject) => {
      const item = { host, start: () => {
        signal?.removeEventListener("abort", item.cancel);
        this.active++;
        this.hosts.set(host, (this.hosts.get(host) ?? 0) + 1);
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.active--;
          const remaining = (this.hosts.get(host) ?? 1) - 1;
          if (remaining) this.hosts.set(host, remaining);
          else this.hosts.delete(host);
          this.pump();
        });
      }, cancel: () => {
        const index = this.queue.indexOf(item);
        if (index >= 0) this.queue.splice(index, 1);
        signal?.removeEventListener("abort", item.cancel);
        reject(new DownloadError("CANCELLED"));
        this.pump();
      } };
      this.queue.push(item);
      signal?.addEventListener("abort", item.cancel, { once: true });
      if (signal?.aborted) item.cancel();
      else this.pump();
    });
  }
  pump() {
    for (let index = 0; index < this.queue.length && this.active < this.total; ) {
      const item = this.queue[index];
      if ((this.hosts.get(item.host) ?? 0) >= this.perHost) {
        index++;
        continue;
      }
      this.queue.splice(index, 1);
      item.start();
    }
  }
};

// src/services/download/parallel-http.ts
var PIECE = 4 * 1024 ** 2;
var strongTag = (value) => value !== null && /^"[\x21\x23-\x7e]{0,180}"$/.test(value);
function responseRange(response, start, end, size, tag) {
  const expected = `bytes ${start}-${end}/${size}`;
  const length = response.headers.get("content-length");
  const encoding = response.headers.get("content-encoding");
  return response.status === 206 && response.headers.get("content-range") === expected && (length === null || length === String(end - start + 1)) && (encoding === null || encoding.toLowerCase() === "identity") && (tag === void 0 || response.headers.get("etag") === tag);
}
var ParallelHttpTransfer = class {
  constructor(request = fetch, budget2 = new RequestBudget(), headerMs = 15e3, idleMs = 3e4) {
    this.request = request;
    this.budget = budget2;
    this.headerMs = headerMs;
    this.idleMs = idleMs;
  }
  request;
  budget;
  headerMs;
  idleMs;
  async run(file, record3, checkpoint, options = {}, connections = 4) {
    let current = parseTransferRecord(record3);
    if (!Number.isSafeInteger(connections) || connections < 1 || connections > 8) throw new DownloadError("INVALID_TRANSFER");
    const host = new URL(current.url).hostname;
    const single = () => this.budget.run(host, options.signal, () => new HttpTransfer(this.request).run(file, current, checkpoint, options));
    if (connections === 1 || current.expected.size - current.bytesDone < 8 * 1024 ** 2 || current.state !== "partial") return single();
    const probe = await this.budget.run(host, options.signal, async () => {
      const controller2 = new AbortController();
      const abort2 = () => controller2.abort();
      options.signal?.addEventListener("abort", abort2, { once: true });
      if (options.signal?.aborted) controller2.abort();
      const timer = setTimeout(abort2, this.headerMs);
      let response;
      try {
        response = await this.request(current.url, {
          redirect: "error",
          credentials: "omit",
          signal: controller2.signal,
          headers: { Range: `bytes=${current.bytesDone}-${current.bytesDone}`, "accept-encoding": "identity" }
        });
        if ([408, 429, 500, 502, 503, 504].includes(response.status)) throw new DownloadError("RETRY_LATER", retryAfter(response));
        const tag = response.headers.get("etag");
        return responseRange(response, current.bytesDone, current.bytesDone, current.expected.size) && strongTag(tag) ? tag : void 0;
      } catch (error) {
        throw options.signal?.aborted ? new DownloadError("CANCELLED") : error instanceof DownloadError ? error : new DownloadError(controller2.signal.aborted ? "TIMEOUT" : "NETWORK_FAILED");
      } finally {
        controller2.abort();
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort2);
        await response?.body?.cancel().catch(() => {
        });
      }
    });
    if (!probe) return single();
    const handle = await writableStaging(file, current.bytesDone);
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    let writes = Promise.resolve();
    let journalFailed = false;
    let failure3;
    const save = async (done, state2, reset = false) => {
      await handle.sync().catch((error) => {
        throw diskError(error);
      });
      const base = { ...current };
      delete base.lastModified;
      const next = parseTransferRecord({ ...base, bytesDone: done, state: state2, etag: probe, revision: current.revision + 1 });
      try {
        await checkpoint(current.revision, next);
      } catch {
        journalFailed = true;
        throw new DownloadError("NEEDS_RECOVERY");
      }
      current = next;
      if (reset) {
        await handle.truncate(0).catch((error) => {
          throw diskError(error);
        });
        await handle.sync().catch((error) => {
          throw diskError(error);
        });
      }
    };
    try {
      if (current.bytesDone > 0 && current.etag !== probe) await save(0, "partial", true);
      else await save(current.bytesDone, "partial");
      const origin = current.bytesDone;
      const count = Math.ceil((current.expected.size - origin) / PIECE);
      const completed = /* @__PURE__ */ new Set();
      let transferred = origin;
      let next = 0;
      let prefix = 0;
      const piece = async (index) => {
        const start = origin + index * PIECE;
        const end = Math.min(current.expected.size, start + PIECE) - 1;
        let observed = 0;
        await this.budget.run(host, controller.signal, () => this.readPiece(handle, current.url, start, end, current.expected.size, probe, controller.signal, (done) => {
          transferred += done - observed;
          observed = done;
          options.onProgress?.(transferred, current.expected.size);
        }));
        completed.add(index);
        const operation = writes.then(async () => {
          while (completed.has(prefix)) prefix++;
          const done = Math.min(current.expected.size, origin + prefix * PIECE);
          if (done > current.bytesDone) await save(done, done === current.expected.size ? "complete" : "partial");
        });
        writes = operation;
        await operation;
      };
      const lane = async () => {
        try {
          while (next < count && !controller.signal.aborted) await piece(next++);
        } catch (error) {
          if (failure3 === void 0 || error instanceof DownloadError && ["NEEDS_RECOVERY", "TRANSFER_IO", "DISK_FULL", "DISK_PERMISSION"].includes(error.code)) failure3 = error;
          controller.abort();
        }
      };
      await Promise.allSettled(Array.from({ length: Math.min(connections, count) }, lane));
      await writes.catch((error) => {
        failure3 = error;
      });
      if (journalFailed) throw new DownloadError("NEEDS_RECOVERY");
      if (failure3 !== void 0) throw failure3;
      if (options.signal?.aborted) throw new DownloadError("CANCELLED");
      if (current.bytesDone !== current.expected.size) throw new DownloadError("BAD_RESPONSE");
      return current;
    } finally {
      controller.abort();
      options.signal?.removeEventListener("abort", abort);
      await handle.close().catch((error) => {
        throw diskError(error);
      });
    }
  }
  async readPiece(handle, url, start, end, size, tag, signal, progress) {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    let timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.headerMs);
    let response;
    try {
      response = await this.request(url, {
        redirect: "error",
        credentials: "omit",
        signal: controller.signal,
        headers: { Range: `bytes=${start}-${end}`, "if-range": tag, "accept-encoding": "identity" }
      });
      if (!responseRange(response, start, end, size, tag) || !response.body) throw new DownloadError("BAD_RESPONSE");
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, this.idleMs);
      };
      arm();
      let position = start;
      const reader = response.body.getReader();
      try {
        while (true) {
          let cancelRead = () => {
          };
          const aborted = new Promise((_resolve, reject) => {
            cancelRead = () => reject(new DownloadError(timedOut ? "TIMEOUT" : "CANCELLED"));
            controller.signal.addEventListener("abort", cancelRead, { once: true });
            if (controller.signal.aborted) cancelRead();
          });
          let chunk;
          try {
            chunk = await Promise.race([reader.read(), aborted]);
          } finally {
            controller.signal.removeEventListener("abort", cancelRead);
          }
          if (chunk.done) break;
          const bytes = chunk.value;
          if (controller.signal.aborted) throw new DownloadError(timedOut ? "TIMEOUT" : "CANCELLED");
          arm();
          if (position + bytes.byteLength > end + 1) throw new DownloadError("BAD_RESPONSE");
          let offset = 0;
          while (offset < bytes.byteLength) {
            const written = await handle.write(bytes, offset, bytes.byteLength - offset, position).catch((error) => {
              throw diskError(error);
            });
            if (written.bytesWritten <= 0) throw new DownloadError("TRANSFER_IO");
            offset += written.bytesWritten;
            position += written.bytesWritten;
          }
          progress(position - start);
        }
      } finally {
        controller.abort();
        await reader.cancel().catch(() => {
        });
        reader.releaseLock();
      }
      if (position !== end + 1) throw new DownloadError("BAD_RESPONSE");
    } catch (error) {
      throw error instanceof DownloadError ? error : new DownloadError(signal.aborted ? "CANCELLED" : timedOut ? "TIMEOUT" : "NETWORK_FAILED");
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      controller.abort();
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {
      });
    }
  }
};

// src/services/download/source-transfer.ts
function mirrorFetch(request) {
  return async (input, init) => {
    let url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    for (let hop = 0; hop <= 3; hop++) {
      if (!isMirrorArtifactUrl(url)) throw new DownloadError("BAD_RESPONSE");
      const response = await request(url, { ...init, redirect: "manual", credentials: "omit" });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {
      });
      if (!location) throw new DownloadError("BAD_RESPONSE");
      try {
        url = new URL(location, url).href;
      } catch {
        throw new DownloadError("BAD_RESPONSE");
      }
    }
    throw new DownloadError("BAD_RESPONSE");
  };
}
var SourceTransfer = class {
  constructor(preferences = () => DEFAULT_DOWNLOAD_PREFERENCES, request = fetch, budget2 = new RequestBudget()) {
    this.preferences = preferences;
    this.request = request;
    this.budget = budget2;
  }
  preferences;
  request;
  budget;
  /** Retries only transient transport failures, always from the latest acknowledged durable prefix. */
  async run(file, record3, checkpoint, options = {}) {
    const preferences = { ...this.preferences() };
    if (!isDownloadPreferences(preferences)) throw new DownloadError("INVALID_TRANSFER");
    let current = parseTransferRecord(record3);
    const save = async (revision, next) => {
      await checkpoint(revision, next);
      current = next;
    };
    for (let attempt = 0; ; attempt++) {
      if (options.signal?.aborted) throw new DownloadError("CANCELLED");
      try {
        return await this.transfer(file, current, save, options, preferences);
      } catch (error) {
        if (error instanceof DownloadError && error.category === "disk") throw error;
        if (options.signal?.aborted) throw new DownloadError("CANCELLED");
        if (!(error instanceof DownloadError) || !["NETWORK_FAILED", "TIMEOUT", "RETRY_LATER"].includes(error.code) || attempt >= 2 || (error.retryAfterMs ?? 0) > 3e4) throw error;
        try {
          await retryDelay(attempt, options.signal, error.retryAfterMs);
        } catch {
          throw new DownloadError("CANCELLED");
        }
      }
    }
  }
  async transfer(file, record3, checkpoint, options, preferences) {
    let current = parseTransferRecord(record3);
    if (current.state !== "partial") return current;
    const save = async (revision, next) => {
      try {
        await checkpoint(revision, next);
      } catch {
        throw new DownloadError("NEEDS_RECOVERY");
      }
      current = next;
    };
    const route = async (source) => {
      if (current.transportSource === source || current.transportSource === void 0 && source === "official") return;
      const next = { ...current };
      delete next.etag;
      delete next.lastModified;
      await save(current.revision, parseTransferRecord({ ...next, transportSource: source, revision: current.revision + 1, bytesDone: 0, state: "partial" }));
    };
    const mirror = preferences.source === "bmclapi" && !options.officialOnly ? bmclapiArtifactUrl(current.url) : void 0;
    if (mirror) {
      await route("bmclapi");
      try {
        const request = (_url, init) => mirrorFetch(this.request)(mirror, init);
        return await this.budget.run(new URL(mirror).hostname, options.signal, () => new HttpTransfer(request).run(file, current, save, options));
      } catch (error) {
        if (!(error instanceof DownloadError) || !["NETWORK_FAILED", "BAD_RESPONSE", "TIMEOUT", "RETRY_LATER"].includes(error.code) || options.signal?.aborted) throw error;
      }
    }
    await route("official");
    try {
      return await new ParallelHttpTransfer(this.request, this.budget).run(file, current, save, options, preferences.connectionsPerFile);
    } catch (error) {
      if (!(error instanceof DownloadError) || error.code !== "BAD_RESPONSE" || options.signal?.aborted) throw error;
      return this.budget.run(new URL(current.url).hostname, options.signal, () => new HttpTransfer(this.request).run(file, current, save, options));
    }
  }
};

// src/services/install/downloads.ts
var import_node_crypto14 = require("node:crypto");

// src/services/loaders/installer-install-metadata.ts
function rebuildPreparedInstallerPlan(metadata2) {
  const loader2 = metadata2.loader;
  const profile = parseStoredInstallerProfile(
    loader2.kind,
    metadata2.version.ancestry[0] ?? "",
    loader2.version,
    loader2.profileBody,
    loader2.profileSha256,
    loader2.versionBody,
    loader2.versionSha256
  );
  return composeInstallerInstall({
    baseVersionDocuments: metadata2.versionDocuments,
    baseMetadataSha1ByVersion: metadata2.metadataSha1ByVersion,
    assets: metadata2.assets,
    profile,
    profileSha256: loader2.profileSha256,
    environment: metadata2.environment
  }).plan;
}

// src/services/install/metadata-object.ts
var import_node_crypto13 = require("node:crypto");
var import_promises7 = require("node:fs/promises");
function artifactSpec(artifact, proof = artifact.proofs[0]) {
  if (!proof) throw new DownloadError("INVALID_TRANSFER");
  return {
    url: artifact.url,
    expected: { algorithm: "sha1", digest: artifact.sha1, size: artifact.size, provenanceId: proof.provenanceId },
    anchor: { kind: proof.source.kind, algorithm: proof.source.algorithm, digest: proof.source.digest }
  };
}
async function importAssetIndex(objects2, artifact, body, signal) {
  try {
    return await importIndex(objects2, artifact, body, signal);
  } catch (error) {
    if (error instanceof DownloadError || error instanceof ObjectError) throw error;
    throw new DownloadError(hasCode(error, "ENOSPC") ? "DISK_FULL" : hasCode(error, "EACCES") || hasCode(error, "EPERM") ? "DISK_PERMISSION" : "TRANSFER_IO");
  }
}
async function importIndex(objects2, artifact, body, signal) {
  const spec = artifactSpec(artifact);
  const bytes = Buffer.from(body, "utf8");
  if (bytes.length !== artifact.size || (0, import_node_crypto13.createHash)("sha1").update(bytes).digest("hex") !== artifact.sha1) throw new DownloadError("HASH_MISMATCH");
  if (signal?.aborted) throw new DownloadError("CANCELLED");
  const cached = await objects2.lookup(spec.expected, spec.anchor);
  if (signal?.aborted) throw new DownloadError("CANCELLED");
  if (cached) return cached;
  const staging = await objects2.createStaging();
  try {
    if (signal?.aborted) throw new DownloadError("CANCELLED");
    const before = await (0, import_promises7.lstat)(staging.file);
    if (!before.isFile() || before.isSymbolicLink() || before.size !== 0) throw new DownloadError("NEEDS_RECOVERY");
    const handle = await (0, import_promises7.open)(staging.file, "r+");
    try {
      const opened = await handle.stat();
      if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== 0) throw new DownloadError("NEEDS_RECOVERY");
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (signal?.aborted) throw new DownloadError("CANCELLED");
    return await objects2.commit(staging.id, spec.expected, spec.anchor);
  } finally {
    await objects2.discardStaging(staging.id);
  }
}

// src/services/install/downloads.ts
function installerMetadata(value) {
  return "loader" in value && (value.loader.kind === "forge" || value.loader.kind === "neoforge");
}
var InstallDownloadService = class {
  constructor(downloads, objects2, concurrency = 4) {
    this.downloads = downloads;
    this.objects = objects2;
    this.concurrency = concurrency;
    this.limit();
  }
  downloads;
  objects;
  concurrency;
  limit() {
    const value = typeof this.concurrency === "number" ? this.concurrency : this.concurrency();
    if (!Number.isSafeInteger(value) || value < 1 || value > 16) throw new DownloadError("INVALID_TRANSFER");
    return value;
  }
  /** Returns only after every artifact and independent proof is committed, or all owned consumers have joined. */
  async run(metadata2, options = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    try {
      const body = metadata2.assetIndexBody;
      let rawAssets;
      try {
        rawAssets = JSON.parse(body);
      } catch {
        throw new DownloadError("INVALID_TRANSFER");
      }
      const plan = installerMetadata(metadata2) ? rebuildPreparedInstallerPlan({ ...metadata2, assets: parseAssetIndex(rawAssets) }) : "loader" in metadata2 ? rebuildPreparedLoaderPlan({ ...metadata2, assets: parseAssetIndex(rawAssets) }) : planVanillaInstall(metadata2.version, metadata2.metadataSha1ByVersion, parseAssetIndex(rawAssets));
      const index = metadata2.version.assetIndex;
      const indexView = plan.views.find((view) => view.area === "assets" && view.path === `indexes/${index?.id}.json`);
      const indexArtifact = plan.artifacts.find((artifact) => artifact.artifactId === indexView?.artifactId);
      if (!indexArtifact || indexArtifact.sha1 !== index?.sha1 || indexArtifact.size !== index.size) throw new DownloadError("INVALID_TRANSFER");
      const objects2 = /* @__PURE__ */ new Map();
      let verifiedBytes = 0;
      const progress = () => {
        try {
          options.onProgress?.({ totalArtifacts: plan.artifacts.length, completedArtifacts: objects2.size, totalBytes: plan.totalBytes, verifiedBytes });
        } catch {
          throw new CoordinatorError("CALLBACK_FAILED");
        }
      };
      const cancelled2 = () => {
        if (controller.signal.aborted) throw new DownloadError("CANCELLED");
      };
      const complete = async (artifact, object4) => {
        for (const proof of artifact.proofs.slice(1)) {
          cancelled2();
          const spec = artifactSpec(artifact, proof);
          await this.objects.adopt(object4.digest, spec.expected, spec.anchor);
        }
        cancelled2();
        objects2.set(artifact.artifactId, object4);
        verifiedBytes += artifact.size;
        progress();
      };
      cancelled2();
      progress();
      await complete(indexArtifact, await importAssetIndex(this.objects, indexArtifact, body, controller.signal));
      const queue = plan.artifacts.filter((artifact) => artifact !== indexArtifact);
      let next = 0;
      const failures = [];
      const lane = async () => {
        try {
          while (next < queue.length) {
            cancelled2();
            const artifact = queue[next++];
            const consumer = this.downloads.request(artifactSpec(artifact), { consumerId: options.consumerId?.(artifact.artifactId) ?? (0, import_node_crypto14.randomUUID)(), signal: controller.signal });
            await complete(artifact, await consumer.result);
          }
        } catch (error) {
          failures.push(error);
          controller.abort();
        }
      };
      await Promise.all(Array.from({ length: Math.min(this.limit(), queue.length) }, lane));
      const failure3 = failures.find((error) => !(error instanceof DownloadError && error.code === "CANCELLED")) ?? failures[0];
      if (failure3 !== void 0) throw failure3;
      cancelled2();
      return { plan, objects: objects2 };
    } finally {
      options.signal?.removeEventListener("abort", abort);
    }
  }
};

// src/services/install/file-views.ts
var import_promises8 = require("node:fs/promises");
var import_node_path9 = __toESM(require("node:path"), 1);
var FileViewError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "FileViewError";
    this.category = code3 === "INVALID_VIEW" ? "validation" : code3 === "CANCELLED" ? "cancelled" : code3 === "VIEW_CONFLICT" ? "biz" : "disk";
  }
  code;
  category;
};
var FileViewService = class {
  constructor(storeDirectory, objects2, hasher, link = async (target, file) => (0, import_promises8.symlink)(target, file, "file")) {
    this.storeDirectory = storeDirectory;
    this.objects = objects2;
    this.hasher = hasher;
    this.link = link;
  }
  storeDirectory;
  objects;
  hasher;
  link;
  tail = Promise.resolve();
  /** Creates one new projection, or verifies an explicitly recorded receipt. Unknown entries fail closed. */
  materialize(directory2, relative, spec, object4, options) {
    const run = this.tail.then(() => this.perform(directory2, relative, spec, object4, options));
    this.tail = run.then(() => {
    }, () => {
    });
    return run;
  }
  async perform(directory2, relative, spec, object4, options) {
    const cancelled2 = () => {
      if (options.signal?.aborted) throw new FileViewError("CANCELLED");
    };
    try {
      try {
        installRelativePath(relative);
      } catch {
        throw new FileViewError("INVALID_VIEW");
      }
      if (!/^[a-f0-9]{64}$/.test(object4.digest) || !Number.isSafeInteger(object4.size) || object4.size < 0 || options.mode !== "copy" && options.mode !== "prefer-link") throw new FileViewError("INVALID_VIEW");
      const root = await guardDirectory(directory2);
      const store = await guardDirectory(this.storeDirectory);
      const source = import_node_path9.default.join(store, "objects", "sha256", object4.digest.slice(0, 2), object4.digest);
      cancelled2();
      const trusted = await this.objects.lookup(spec.expected, spec.anchor);
      cancelled2();
      if (!trusted || trusted.digest !== object4.digest || trusted.size !== object4.size || trusted.sourceKey !== object4.sourceKey) throw new FileViewError("NEEDS_RECOVERY");
      await guardDirectory(import_node_path9.default.dirname(source));
      const parts = relative.split("/");
      const name2 = parts.pop();
      let parent = root;
      for (const part of parts) {
        await guardDirectory(parent);
        parent = import_node_path9.default.join(parent, part);
        try {
          await (0, import_promises8.mkdir)(parent);
        } catch (error) {
          if (!hasCode(error, "EEXIST")) throw error;
        }
        await guardDirectory(parent);
        cancelled2();
      }
      const target = import_node_path9.default.join(parent, name2);
      let old;
      try {
        old = await (0, import_promises8.lstat)(target);
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw error;
      }
      const receipt = options.existing;
      if (receipt && (receipt.relativePath !== relative || receipt.objectDigest !== object4.digest || receipt.size !== object4.size || !["copy", "symlink"].includes(receipt.mode))) throw new FileViewError("INVALID_VIEW");
      if (old) {
        if (!receipt) throw new FileViewError("VIEW_CONFLICT");
        if (receipt.mode === "symlink") {
          if (!old.isSymbolicLink() || import_node_path9.default.resolve(parent, await (0, import_promises8.readlink)(target)) !== source || await (0, import_promises8.realpath)(target) !== await (0, import_promises8.realpath)(source)) throw new FileViewError("NEEDS_RECOVERY");
        } else {
          if (!old.isFile() || old.isSymbolicLink() || old.nlink !== 1) throw new FileViewError("NEEDS_RECOVERY");
          await this.verify(target, object4, options.signal);
        }
        cancelled2();
        return { ...receipt };
      }
      if (receipt) throw new FileViewError("NEEDS_RECOVERY");
      cancelled2();
      let mode = "copy";
      if (options.mode === "prefer-link") {
        try {
          await this.link(source, target);
          const linked = await (0, import_promises8.lstat)(target);
          if (!linked.isSymbolicLink() || import_node_path9.default.resolve(parent, await (0, import_promises8.readlink)(target)) !== source) throw new FileViewError("NEEDS_RECOVERY");
          mode = "symlink";
        } catch (error) {
          if (!["EPERM", "EACCES", "ENOTSUP", "EOPNOTSUPP", "EINVAL"].some((code3) => hasCode(error, code3))) throw error;
          try {
            await (0, import_promises8.lstat)(target);
            throw new FileViewError("NEEDS_RECOVERY");
          } catch (check2) {
            if (!hasCode(check2, "ENOENT")) throw check2;
          }
        }
      }
      if (mode === "copy") await this.copy(source, target, object4, options.signal);
      return { relativePath: relative, objectDigest: object4.digest, size: object4.size, mode };
    } catch (error) {
      if (error instanceof FileViewError) throw error;
      throw new FileViewError(hasCode(error, "CANCELLED") ? "CANCELLED" : hasCode(error, "UNSAFE_PATH") || hasCode(error, "NEEDS_RECOVERY") || hasCode(error, "HASH_MISMATCH") ? "NEEDS_RECOVERY" : hasCode(error, "EEXIST") ? "VIEW_CONFLICT" : "VIEW_IO");
    }
  }
  async verify(file, object4, signal) {
    const result2 = await this.hasher.hash(file, { maximumBytes: object4.size, ...signal ? { signal } : {} });
    if (result2.sha256 !== object4.digest || result2.size !== object4.size) throw new FileViewError("NEEDS_RECOVERY");
  }
  async copy(source, target, object4, signal) {
    const info = await (0, import_promises8.lstat)(source);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== object4.size) throw new FileViewError("NEEDS_RECOVERY");
    const input = await (0, import_promises8.open)(source, "r");
    let output;
    let created = false;
    try {
      const opened = await input.stat();
      if (opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== object4.size) throw new FileViewError("NEEDS_RECOVERY");
      output = await (0, import_promises8.open)(target, "wx");
      created = true;
      const block = Buffer.alloc(256 * 1024);
      let position = 0;
      while (position < object4.size) {
        if (signal?.aborted) throw new FileViewError("CANCELLED");
        const { bytesRead } = await input.read(block, 0, Math.min(block.length, object4.size - position), position);
        if (!bytesRead) throw new FileViewError("NEEDS_RECOVERY");
        let written = 0;
        while (written < bytesRead) {
          const result2 = await output.write(block, written, bytesRead - written, position + written);
          if (!result2.bytesWritten) throw new FileViewError("VIEW_IO");
          written += result2.bytesWritten;
        }
        position += bytesRead;
      }
      await output.sync();
      await output.close();
      output = void 0;
      await this.verify(target, object4, signal);
      await (0, import_promises8.chmod)(target, 292);
      created = false;
    } finally {
      await output?.close();
      await input.close();
      if (created) await (0, import_promises8.unlink)(target);
    }
  }
};

// src/services/install/instance-files.ts
var import_promises9 = require("node:fs/promises");
var import_node_crypto15 = require("node:crypto");
var import_node_path10 = __toESM(require("node:path"), 1);
function dependencyId(metadata2) {
  const client2 = metadata2.version.client.sha1.toLowerCase();
  const index = `indexes/${assetIndexAlias(metadata2.version)}.json`;
  if (!metadata2.plan.views.some((view) => view.area === "assets" && view.path === index)) return `dep-${client2}`;
  const proof = metadata2.metadataSha1ByVersion[metadata2.version.jarVersionId];
  if (!proof || !/^[a-f0-9]{40}$/i.test(proof)) throw new FileViewError("NEEDS_RECOVERY");
  return `dep-${client2}-${proof.toLowerCase()}`;
}
async function removeTemporaryFile(file) {
  try {
    await (0, import_promises9.unlink)(file);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
}
async function removeNativeWorkspace(directory2, temporary) {
  if (import_node_path10.default.dirname(temporary) !== directory2 || !import_node_path10.default.basename(temporary).startsWith(".oucl-natives-")) throw new FileViewError("NEEDS_RECOVERY");
  try {
    await guardDirectory(temporary);
    await (0, import_promises9.rm)(temporary, { recursive: true });
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
}
async function ensureChildDirectory(parent, ...parts) {
  let current = await guardDirectory(parent);
  for (const part of parts) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(part) || part === "." || part === "..") throw new FileViewError("INVALID_VIEW");
    current = import_node_path10.default.join(current, part);
    try {
      await (0, import_promises9.mkdir)(current);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
    current = await guardDirectory(current);
  }
  return current;
}
async function projection(gameRoot, name2, view) {
  const target = import_node_path10.default.join(gameRoot, name2);
  let info;
  try {
    info = await (0, import_promises9.lstat)(target);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
  if (info?.isSymbolicLink()) {
    if (import_node_path10.default.resolve(gameRoot, await (0, import_promises9.readlink)(target)) !== view) throw new FileViewError("NEEDS_RECOVERY");
    return guardDirectory(view);
  }
  if (info) {
    if (!info.isDirectory()) throw new FileViewError("VIEW_CONFLICT");
    return guardDirectory(target);
  }
  try {
    await (0, import_promises9.symlink)(view, target, process.platform === "win32" ? "junction" : "dir");
    return view;
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOTSUP", "EOPNOTSUPP"].some((code3) => hasCode(error, code3))) throw error;
    return ensureChildDirectory(gameRoot, name2);
  }
}
function instanceGameLayout(dataDirectory, summary, metadata2) {
  const inherited = metadata2.version.jarVersionId !== metadata2.version.id;
  const jarId = inherited ? dependencyId(metadata2) : summary.instanceId;
  return planGameLayout({
    dataDirectory,
    rootId: summary.rootId,
    instanceId: summary.instanceId,
    mcVersionId: summary.mcVersionId,
    directoryId: summary.instanceId,
    versionRecordId: summary.instanceId,
    jar: { directoryId: jarId, versionRecordId: jarId },
    isolation: { globalDefault: true, instance: summary.isolation, pack: false }
  });
}
async function prepareInstanceDirectories(dataDirectory, summary, metadata2) {
  const layout = instanceGameLayout(dataDirectory, summary, metadata2);
  const inherited = metadata2.version.jarVersionId !== metadata2.version.id;
  const jarId = inherited ? dependencyId(metadata2) : summary.instanceId;
  const store = await ensureChildDirectory(dataDirectory, "store");
  const views = await ensureChildDirectory(store, "views", summary.rootId);
  const roots = await ensureChildDirectory(dataDirectory, "roots", summary.rootId, ".minecraft");
  await ensureChildDirectory(roots, "versions", summary.instanceId);
  if (inherited) await ensureChildDirectory(roots, "versions", jarId);
  const assets = await projection(roots, "assets", await ensureChildDirectory(views, "assets"));
  const libraries = await projection(roots, "libraries", await ensureChildDirectory(views, "libraries"));
  return { layout, assets, libraries };
}
function viewTarget(directories, view) {
  if (view.area === "assets" || view.area === "libraries") return { directory: directories[view.area], relative: view.path };
  if (view.area === "resources") return { directory: directories.layout.gameDirectory, relative: `resources/${view.path}` };
  if (view.path !== "client.jar") throw new FileViewError("INVALID_VIEW");
  return { directory: import_node_path10.default.dirname(directories.layout.jar), relative: import_node_path10.default.basename(directories.layout.jar) };
}
async function writeDerivedJson(file, data) {
  await guardDirectory(import_node_path10.default.dirname(file));
  const body = JSON.stringify(data) + "\n";
  const old = await readRegular(file);
  if (old !== void 0) {
    if (old.toString("utf8") !== body) throw new FileViewError("NEEDS_RECOVERY");
    return;
  }
  const temporary = import_node_path10.default.join(import_node_path10.default.dirname(file), `.oucl-${(0, import_node_crypto15.randomUUID)()}.tmp`);
  const handle = await (0, import_promises9.open)(temporary, "wx");
  try {
    try {
      await handle.writeFile(body);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await (0, import_promises9.rename)(temporary, file);
  } finally {
    await removeTemporaryFile(temporary);
  }
}
async function prepareInstanceNatives(directory2, archives, extractor, hasher, signal) {
  await guardDirectory(directory2);
  const temporary = await (0, import_promises9.mkdtemp)(import_node_path10.default.join(directory2, ".oucl-natives-"));
  const target = import_node_path10.default.join(directory2, "natives");
  try {
    await extractor.run(temporary, archives, { signal });
    if (signal.aborted) throw new FileViewError("CANCELLED");
    let exists2 = false;
    try {
      await (0, import_promises9.lstat)(target);
      exists2 = true;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    if (!exists2) {
      await (0, import_promises9.rename)(temporary, target);
      return;
    }
    const compare2 = async (left, right) => {
      await guardDirectory(left);
      await guardDirectory(right);
      const a = (await (0, import_promises9.readdir)(left)).sort();
      const b = (await (0, import_promises9.readdir)(right)).sort();
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new FileViewError("NEEDS_RECOVERY");
      for (const name2 of a) {
        const first = import_node_path10.default.join(left, name2);
        const second = import_node_path10.default.join(right, name2);
        const info = await (0, import_promises9.lstat)(first);
        const other = await (0, import_promises9.lstat)(second);
        if (info.isSymbolicLink() || other.isSymbolicLink() || info.isDirectory() !== other.isDirectory()) throw new FileViewError("NEEDS_RECOVERY");
        if (info.isDirectory()) await compare2(first, second);
        else {
          const options = { maximumBytes: 64 * 1024 * 1024, signal };
          if (!info.isFile() || !other.isFile() || (await hasher.hash(first, options)).sha256 !== (await hasher.hash(second, options)).sha256) throw new FileViewError("NEEDS_RECOVERY");
        }
      }
    };
    await compare2(temporary, target);
  } finally {
    await removeNativeWorkspace(directory2, temporary);
  }
}

// src/services/install/launch-inputs.ts
var import_promises13 = require("node:fs/promises");
var import_node_path14 = __toESM(require("node:path"), 1);
var import_node_util = require("node:util");
var import_node_crypto16 = require("node:crypto");

// src/services/java/probe.ts
var import_node_child_process = require("node:child_process");
var import_promises10 = require("node:fs/promises");
var import_node_path11 = __toESM(require("node:path"), 1);
var JavaProbeError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "JavaProbeError";
    this.category = code3 === "CANCELLED" ? "cancelled" : code3 === "INVALID_JAVA" || code3 === "UNSUPPORTED_JAVA" ? "validation" : "system";
  }
  code;
  category;
};
var MAX_OUTPUT = 64 * 1024;
var PROPERTIES = /* @__PURE__ */ new Set(["java.version", "java.specification.version", "java.vendor", "os.arch", "os.name", "sun.arch.data.model"]);
function parseJavaProperties(output) {
  if (typeof output !== "string" || Buffer.byteLength(output) > MAX_OUTPUT) throw new JavaProbeError("OUTPUT_LIMIT");
  const values = /* @__PURE__ */ new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_.]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || !PROPERTIES.has(match[1])) continue;
    if (values.has(match[1])) throw new JavaProbeError("INVALID_JAVA");
    values.set(match[1], match[2]);
  }
  if ([...PROPERTIES].some((key) => !values.has(key))) throw new JavaProbeError("INVALID_JAVA");
  const version3 = values.get("java.version");
  const specification = values.get("java.specification.version");
  const vendor = values.get("java.vendor");
  const os = values.get("os.name");
  if (!/^\d{1,3}(?:\.\d{1,6}){0,3}(?:_\d{1,6})?(?:[-+][A-Za-z0-9][A-Za-z0-9.+-]{0,63})?$/.test(version3) || vendor.length < 1 || vendor.length > 160 || /[\p{C}]/u.test(vendor)) throw new JavaProbeError("INVALID_JAVA");
  const major = Number(/^(\d+)/.exec(version3.startsWith("1.") ? version3.slice(2) : version3)?.[1]);
  if (![8, 17, 21].includes(major) || major === 8 && !/^1\.8\.0(?:_\d+)?(?:[-+].+)?$/.test(version3) || major !== 8 && !new RegExp(`^${major}(?:[.\\-+]|$)`).test(version3) || specification !== (major === 8 ? "1.8" : String(major))) throw new JavaProbeError("UNSUPPORTED_JAVA");
  if (!/^Windows(?: [A-Za-z0-9(). -]{1,80})?$/i.test(os) || !["amd64", "x86_64"].includes(values.get("os.arch")) || values.get("sun.arch.data.model") !== "64") throw new JavaProbeError("UNSUPPORTED_JAVA");
  return { major, version: version3, vendor, architecture: "x64", os: "windows" };
}
async function inspectJava(file) {
  await guardDirectory(import_node_path11.default.dirname(file));
  const entry = await (0, import_promises10.lstat)(file);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size === 0) throw new JavaProbeError("INVALID_JAVA");
}
var JavaProbe = class {
  inspect;
  start;
  constructor(dependencies = {}) {
    this.inspect = dependencies.inspect ?? inspectJava;
    this.start = dependencies.start ?? ((file, args, options) => (0, import_node_child_process.spawn)(file, [...args], options));
  }
  /** Cancellation, timeout and output overflow terminate the JVM and wait for close before rejecting. */
  async probe(executable, options = {}) {
    const timeout = options.timeoutMs ?? 8e3;
    if (typeof executable !== "string" || executable.length > 32767 || executable.includes("\0") || !import_node_path11.default.isAbsolute(executable) || import_node_path11.default.basename(executable).toLowerCase() !== "java.exe" || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 3e4) throw new JavaProbeError("INVALID_JAVA");
    if (options.signal?.aborted) throw new JavaProbeError("CANCELLED");
    try {
      await this.inspect(executable);
    } catch {
      throw new JavaProbeError("INVALID_JAVA");
    }
    if (options.signal?.aborted) throw new JavaProbeError("CANCELLED");
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (["JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS", "CLASSPATH"].includes(key.toUpperCase())) delete env[key];
    let child;
    try {
      child = this.start(executable, ["-XshowSettings:properties", "-version"], { shell: false, windowsHide: true, cwd: import_node_path11.default.dirname(executable), env, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      throw new JavaProbeError("PROBE_FAILED");
    }
    return new Promise((resolve, reject) => {
      const chunks = [];
      let bytes = 0;
      let failure3;
      let closed = false;
      const stop = (error) => {
        if (closed || failure3) return;
        failure3 = error;
        try {
          child.kill("SIGKILL");
        } catch {
        }
      };
      const abort = () => stop(new JavaProbeError("CANCELLED"));
      const receive = (value) => {
        if (failure3) return;
        if (!Buffer.isBuffer(value) && typeof value !== "string") {
          stop(new JavaProbeError("PROBE_FAILED"));
          return;
        }
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        bytes += chunk.length;
        if (bytes > MAX_OUTPUT) {
          stop(new JavaProbeError("OUTPUT_LIMIT"));
          return;
        }
        chunks.push(chunk);
      };
      const timer = setTimeout(() => stop(new JavaProbeError("TIMEOUT")), timeout);
      child.stdout.on("data", receive);
      child.stderr.on("data", receive);
      child.stdout.once("error", () => stop(new JavaProbeError("PROBE_FAILED")));
      child.stderr.once("error", () => stop(new JavaProbeError("PROBE_FAILED")));
      child.once("error", () => stop(new JavaProbeError("PROBE_FAILED")));
      child.once("close", (code3, signal) => {
        closed = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        if (failure3) {
          reject(failure3);
          return;
        }
        if (code3 !== 0 || signal !== null) {
          reject(new JavaProbeError("PROBE_FAILED"));
          return;
        }
        try {
          const output = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
          resolve({ ...parseJavaProperties(output), executable });
        } catch (error) {
          reject(error instanceof JavaProbeError ? error : new JavaProbeError("INVALID_JAVA"));
        }
      });
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
    });
  }
};

// src/services/launch/process.ts
var GameProcessError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "GameProcessError";
    this.category = code3 === "CANCELLED" ? "cancelled" : code3 === "NEEDS_RECOVERY" ? "disk" : code3 === "LAUNCH_FAILED" ? "system" : "biz";
  }
  code;
  category;
};

// src/services/loaders/processor-outputs.ts
var import_promises11 = require("node:fs/promises");
var import_node_fs = require("node:fs");
var import_node_path12 = __toESM(require("node:path"), 1);
var ProcessorOutputError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "ProcessorOutputError";
    this.category = code3 === "CANCELLED" ? "cancelled" : "disk";
  }
  code;
  category;
};
var cancelled = (signal) => {
  if (signal.aborted) throw new ProcessorOutputError("CANCELLED");
};
async function verify(file, output, hashes, signal) {
  cancelled(signal);
  await guardDirectory(import_node_path12.default.dirname(file));
  const info = await (0, import_promises11.lstat)(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== output.size) throw new ProcessorOutputError("NEEDS_RECOVERY");
  const result2 = await hashes.hash(file, { maximumBytes: output.size, signal });
  if (result2.sha256 !== output.sha256 || result2.sha1 !== output.sha1 || result2.size !== output.size || output.upstreamSha1 !== void 0 && result2.sha1 !== output.upstreamSha1) throw new ProcessorOutputError("NEEDS_RECOVERY");
}
async function publishProcessorOutputs(workspace, libraries, evidence, hashes, signal) {
  await guardDirectory(workspace);
  await guardDirectory(libraries);
  for (const step of evidence) for (const output of step.outputs) {
    cancelled(signal);
    installRelativePath(output.path);
    const source = import_node_path12.default.join(workspace, "libraries", output.path);
    await verify(source, output, hashes, signal);
    const parts = output.path.split("/");
    const name2 = parts.pop();
    let parent = libraries;
    for (const part of parts) {
      await guardDirectory(parent);
      parent = import_node_path12.default.join(parent, part);
      try {
        await (0, import_promises11.mkdir)(parent);
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
      }
      await guardDirectory(parent);
    }
    const target = import_node_path12.default.join(parent, name2);
    cancelled(signal);
    try {
      await (0, import_promises11.copyFile)(source, target, import_node_fs.constants.COPYFILE_EXCL);
      await (0, import_promises11.chmod)(target, 292);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
    await verify(target, output, hashes, signal);
  }
}
async function verifyProcessorOutputs(libraries, evidence, hashes, signal) {
  await guardDirectory(libraries);
  for (const step of evidence) for (const output of step.outputs) {
    installRelativePath(output.path);
    await verify(import_node_path12.default.join(libraries, output.path), output, hashes, signal);
  }
}

// src/services/install/launch-snapshot.ts
var import_promises12 = require("node:fs/promises");
var import_node_path13 = __toESM(require("node:path"), 1);
async function readNativeSnapshot(directory2, hashes, signal) {
  const files = [];
  let count = 0;
  let total = 0;
  const visit = async (folder, relative) => {
    if (signal.aborted) throw new GameProcessError("CANCELLED");
    await guardDirectory(folder);
    const names = (await (0, import_promises12.readdir)(folder)).sort();
    for (const name2 of names) {
      if (signal.aborted) throw new GameProcessError("CANCELLED");
      if (++count > 4096) throw new GameProcessError("NEEDS_RECOVERY");
      const file = import_node_path13.default.join(folder, name2);
      const key = relative ? `${relative}/${name2}` : name2;
      const before = await (0, import_promises12.lstat)(file);
      if (before.isSymbolicLink()) throw new GameProcessError("NEEDS_RECOVERY");
      if (before.isDirectory()) {
        await visit(file, key);
        continue;
      }
      total += before.size;
      if (!before.isFile() || before.size > 64 * 1024 ** 2 || total > 256 * 1024 ** 2) throw new GameProcessError("NEEDS_RECOVERY");
      const measured = await hashes.hash(file, { maximumBytes: before.size, signal });
      const after = await (0, import_promises12.lstat)(file);
      if (after.isSymbolicLink() || !after.isFile() || before.ino !== after.ino || before.dev !== after.dev || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || measured.size !== before.size) throw new GameProcessError("NEEDS_RECOVERY");
      files.push({ relative: key, size: measured.size, sha256: measured.sha256 });
    }
    if (JSON.stringify(names) !== JSON.stringify((await (0, import_promises12.readdir)(folder)).sort())) throw new GameProcessError("NEEDS_RECOVERY");
  };
  await visit(directory2, "");
  return files;
}

// src/services/install/launch-inputs.ts
function matchesLaunchProjection(value, record3, transaction) {
  if ((0, import_node_util.isDeepStrictEqual)(value, record3)) return true;
  if (!transaction || transaction.phase !== "committed" || transaction.taskId !== record3.data.modCommitId || transaction.instanceId !== record3.data.summary.instanceId || transaction.rootId !== record3.data.summary.rootId || transaction.instanceRevision + 1 !== record3.revision || record3.data.summary.revision !== record3.revision || (0, import_node_crypto16.createHash)("sha256").update(JSON.stringify(record3.data)).digest("hex") !== transaction.afterInstanceDigest || !exactObject(value, ["schemaVersion", "revision", "data"]) || value.schemaVersion !== 1 || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision > transaction.instanceRevision) return false;
  try {
    const projected = parseInstanceRecord(value.data);
    if (projected.summary.revision !== value.revision) return false;
    const oldData = structuredClone(projected);
    delete oldData.modCommitId;
    const newData = structuredClone(record3.data);
    delete newData.modCommitId;
    return (0, import_node_util.isDeepStrictEqual)(
      { ...oldData, summary: { ...oldData.summary, revision: 0 } },
      { ...newData, summary: { ...newData.summary, revision: 0 } }
    );
  } catch {
    return false;
  }
}
async function verifyLaunchInputs(runtime, record3, prepared, signal, transaction, nativeBaseline) {
  const check2 = () => {
    if (signal.aborted) throw new GameProcessError("CANCELLED");
  };
  check2();
  const layout = instanceGameLayout(runtime.dataDirectory, record3.data.summary, prepared);
  await guardDirectory(layout.gameDirectory);
  await guardDirectory(layout.versionDirectory);
  const body = await readRegular(layout.instanceJson);
  if (!body || !matchesLaunchProjection(JSON.parse(body.toString("utf8")), record3, transaction)) throw new GameProcessError("NEEDS_RECOVERY");
  const projection2 = async (area) => {
    const file = import_node_path14.default.join(layout.gameRoot, area);
    const entry = await (0, import_promises13.lstat)(file);
    if (!entry.isSymbolicLink()) return guardDirectory(file);
    const expected = await guardDirectory(import_node_path14.default.join(layout.storeDirectory, "views", runtime.rootId, area));
    if (await guardDirectory(import_node_path14.default.resolve(layout.gameRoot, await (0, import_promises13.readlink)(file))) !== expected) throw new GameProcessError("NEEDS_RECOVERY");
    return expected;
  };
  const directories = { layout, assets: await projection2("assets"), libraries: await projection2("libraries") };
  const loader2 = record3.data.metadata?.loader;
  if (loader2?.kind === "forge" || loader2?.kind === "neoforge") {
    if (!loader2.processors) throw new GameProcessError("NEEDS_RECOVERY");
    await verifyProcessorOutputs(directories.libraries, loader2.processors, runtime.hashes, signal);
    check2();
  }
  const required = prepared.plan.views.filter((view) => view.area !== "assets" || view.path.startsWith("indexes/"));
  for (const view of required) {
    check2();
    const receipt = record3.data.receipts?.find((item) => item.area === view.area && item.path === view.path && item.artifactId === view.artifactId);
    const artifact = prepared.plan.artifacts.find((item) => item.artifactId === view.artifactId);
    const object4 = record3.data.objects?.[view.artifactId];
    if (!receipt || !artifact || !object4) throw new GameProcessError("NEEDS_RECOVERY");
    const target = viewTarget(directories, view);
    await (0, import_promises13.lstat)(import_node_path14.default.join(target.directory, target.relative));
    if (nativeBaseline) {
      const file = import_node_path14.default.join(target.directory, target.relative);
      const entry = await (0, import_promises13.lstat)(file);
      const source = import_node_path14.default.join(layout.storeDirectory, "objects", "sha256", object4.digest.slice(0, 2), object4.digest);
      await guardDirectory(import_node_path14.default.dirname(file));
      if (receipt.mode === "symlink") {
        if (!entry.isSymbolicLink() || import_node_path14.default.resolve(import_node_path14.default.dirname(file), await (0, import_promises13.readlink)(file)) !== source) throw new GameProcessError("NEEDS_RECOVERY");
        await guardDirectory(import_node_path14.default.dirname(source));
        const origin = await (0, import_promises13.lstat)(source);
        if (!origin.isFile() || origin.isSymbolicLink()) throw new GameProcessError("NEEDS_RECOVERY");
      } else if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) throw new GameProcessError("NEEDS_RECOVERY");
      const measured = await runtime.hashes.hash(receipt.mode === "symlink" ? source : file, { maximumBytes: object4.size, signal });
      if (measured.size !== object4.size || measured.sha256 !== object4.digest) throw new GameProcessError("NEEDS_RECOVERY");
    } else {
      await runtime.views.materialize(target.directory, target.relative, artifactSpec(artifact), object4, { mode: "prefer-link", signal, existing: {
        relativePath: target.relative,
        mode: receipt.mode,
        objectDigest: object4.digest,
        size: object4.size
      } });
    }
  }
  const archives = prepared.plan.natives.map((native) => {
    const object4 = record3.data.objects?.[native.artifactId];
    if (!object4) throw new GameProcessError("NEEDS_RECOVERY");
    return { file: import_node_path14.default.join(layout.storeDirectory, "objects", "sha256", object4.digest.slice(0, 2), object4.digest), sha256: object4.digest, size: object4.size, exclude: native.exclude };
  });
  if (!nativeBaseline) {
    await prepareInstanceNatives(layout.versionDirectory, archives, runtime.extractor, runtime.hashes, signal);
    check2();
    await ensureChildDirectory(layout.versionDirectory, ".oucl-launch", "jna");
    check2();
    await ensureChildDirectory(layout.versionDirectory, ".oucl-launch", "native-cache");
    check2();
  } else {
    await guardDirectory(import_node_path14.default.join(layout.versionDirectory, ".oucl-launch", "jna"));
    await guardDirectory(import_node_path14.default.join(layout.versionDirectory, ".oucl-launch", "native-cache"));
  }
  const nativeFiles = await readNativeSnapshot(import_node_path14.default.join(layout.versionDirectory, "natives"), runtime.hashes, signal);
  check2();
  if (nativeBaseline && !(0, import_node_util.isDeepStrictEqual)(nativeFiles, nativeBaseline)) throw new GameProcessError("NEEDS_RECOVERY");
  return { layout, prepared, nativeFiles };
}

// src/services/workers/installer-archive-extractor.ts
var import_node_worker_threads4 = require("node:worker_threads");

// src/services/workers/installer-archive-protocol.ts
var import_node_path15 = __toESM(require("node:path"), 1);
var absolute2 = (value) => typeof value === "string" && value.length <= 32760 && import_node_path15.default.isAbsolute(value);
function parseInstallerArchiveRequest(value) {
  if (!exactObject(value, ["version", "kind", "destination", "file", "sha256", "size"]) || value.version !== 1 || value.kind !== "loader-installer-extract" || !absolute2(value.destination) || !absolute2(value.file) || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256) || typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > 64 * 1024 ** 2) throw new Error("INVALID_ARCHIVE");
  return value;
}
function parseInstallerArchiveReply(value) {
  if (exactObject(value, ["version", "kind", "files", "bytes"]) && value.version === 1 && value.kind === "loader-installer-result" && value.files === 3 && typeof value.bytes === "number" && Number.isSafeInteger(value.bytes) && value.bytes >= 1 && value.bytes <= 64 * 1024 ** 2) return value;
  if (exactObject(value, ["version", "kind", "code"]) && value.version === 1 && value.kind === "loader-installer-failed" && typeof value.code === "string" && NATIVE_CODES.includes(value.code)) return value;
  throw new Error("INVALID_ARCHIVE");
}

// src/services/workers/installer-archive-extractor.ts
var InstallerExtractionError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "InstallerExtractionError";
    this.category = code3 === "CANCELLED" ? "cancelled" : code3 === "EXTRACTION_BUSY" ? "biz" : code3 === "HASH_MISMATCH" ? "network" : code3 === "ARCHIVE_IO" ? "disk" : code3 === "WORKER_FAILED" || code3 === "EXTRACTION_TIMEOUT" ? "system" : "validation";
  }
  code;
  category;
};
var InstallerArchiveExtractor = class {
  constructor(entry, timeoutMs = 12e4) {
    this.entry = entry;
    this.timeoutMs = timeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12e4) throw new InstallerExtractionError("INVALID_ARCHIVE");
  }
  entry;
  timeoutMs;
  active;
  closed = false;
  run(destination, archive, options = {}) {
    if (this.closed) return Promise.reject(new InstallerExtractionError("WORKER_FAILED"));
    if (this.active) return Promise.reject(new InstallerExtractionError("EXTRACTION_BUSY"));
    let request;
    try {
      request = parseInstallerArchiveRequest({ version: 1, kind: "loader-installer-extract", destination, ...archive });
    } catch {
      return Promise.reject(new InstallerExtractionError("INVALID_ARCHIVE"));
    }
    if (options.signal?.aborted) return Promise.reject(new InstallerExtractionError("CANCELLED"));
    let worker;
    try {
      worker = new import_node_worker_threads4.Worker(this.entry, { workerData: request, resourceLimits: { maxOldGenerationSizeMb: 128 } });
    } catch {
      return Promise.reject(new InstallerExtractionError("WORKER_FAILED"));
    }
    let failure3;
    let result2;
    let finish = () => {
    };
    const done = new Promise((resolve) => {
      finish = resolve;
    });
    const stop = (error = new InstallerExtractionError("CANCELLED")) => {
      failure3 ??= error;
      void worker.terminate().catch(() => {
      });
    };
    const abort = () => stop();
    const timer = setTimeout(() => stop(new InstallerExtractionError("EXTRACTION_TIMEOUT")), this.timeoutMs);
    this.active = { done, stop: abort };
    return new Promise((resolve, reject) => {
      worker.on("message", (value) => {
        if (result2 || failure3) {
          if (!failure3) stop(new InstallerExtractionError("WORKER_FAILED"));
          return;
        }
        try {
          const reply = parseInstallerArchiveReply(value);
          if (reply.kind === "loader-installer-failed") failure3 = new InstallerExtractionError(reply.code);
          else result2 = { files: reply.files, bytes: reply.bytes };
        } catch {
          stop(new InstallerExtractionError("WORKER_FAILED"));
        }
      });
      worker.once("error", () => {
        failure3 ??= new InstallerExtractionError("WORKER_FAILED");
      });
      worker.once("exit", (code3) => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        delete this.active;
        finish();
        if (failure3) reject(failure3);
        else if (code3 !== 0 || !result2) reject(new InstallerExtractionError("WORKER_FAILED"));
        else resolve(result2);
      });
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
    });
  }
  async close() {
    this.closed = true;
    const active = this.active;
    active?.stop();
    await active?.done;
  }
};

// src/services/loaders/installer-processing.ts
var import_node_path21 = __toESM(require("node:path"), 1);

// src/services/workers/processor-manifest-reader.ts
var import_node_worker_threads5 = require("node:worker_threads");

// src/services/workers/processor-manifest-protocol.ts
var import_node_path16 = __toESM(require("node:path"), 1);
function parseProcessorManifestRequest(value) {
  if (!exactObject(value, ["version", "kind", "file", "sha256", "size"]) || value.version !== 1 || value.kind !== "processor-manifest" || typeof value.file !== "string" || value.file.length > 32760 || !import_node_path16.default.isAbsolute(value.file) || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256) || typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > 64 * 1024 ** 2) throw new Error("INVALID_ARCHIVE");
  return value;
}
function parseProcessorManifestReply(value) {
  if (exactObject(value, ["version", "kind", "mainClass"]) && value.version === 1 && value.kind === "processor-manifest-result" && typeof value.mainClass === "string" && /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(value.mainClass)) return value;
  if (exactObject(value, ["version", "kind", "code"]) && value.version === 1 && value.kind === "processor-manifest-failed" && typeof value.code === "string" && NATIVE_CODES.includes(value.code)) return value;
  throw new Error("INVALID_ARCHIVE");
}

// src/services/workers/processor-manifest-reader.ts
var ProcessorManifestReader = class {
  constructor(entry, timeoutMs = 3e4) {
    this.entry = entry;
    this.timeoutMs = timeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3e4) throw new InstallerExtractionError("INVALID_ARCHIVE");
  }
  entry;
  timeoutMs;
  read(archive, signal) {
    let request;
    try {
      request = parseProcessorManifestRequest({ version: 1, kind: "processor-manifest", ...archive });
    } catch {
      return Promise.reject(new InstallerExtractionError("INVALID_ARCHIVE"));
    }
    if (signal?.aborted) return Promise.reject(new InstallerExtractionError("CANCELLED"));
    let worker;
    try {
      worker = new import_node_worker_threads5.Worker(this.entry, { workerData: request, resourceLimits: { maxOldGenerationSizeMb: 128 } });
    } catch {
      return Promise.reject(new InstallerExtractionError("WORKER_FAILED"));
    }
    return new Promise((resolve, reject) => {
      let result2;
      let failure3;
      let closed = false;
      const stop = (code3) => {
        failure3 ??= new InstallerExtractionError(code3);
        void worker.terminate().catch(() => {
        });
      };
      const abort = () => stop("CANCELLED");
      const timer = setTimeout(() => stop("EXTRACTION_TIMEOUT"), this.timeoutMs);
      worker.on("message", (value) => {
        if (result2 || failure3) {
          if (!failure3) stop("WORKER_FAILED");
          return;
        }
        try {
          const reply = parseProcessorManifestReply(value);
          if (reply.kind === "processor-manifest-failed") failure3 = new InstallerExtractionError(reply.code);
          else result2 = reply.mainClass;
        } catch {
          stop("WORKER_FAILED");
        }
      });
      worker.once("error", () => {
        failure3 ??= new InstallerExtractionError("WORKER_FAILED");
      });
      worker.once("exit", (code3) => {
        closed = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (failure3) reject(failure3);
        else if (code3 !== 0 || !result2) reject(new InstallerExtractionError("WORKER_FAILED"));
        else resolve(result2);
      });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted && !closed) abort();
    });
  }
};

// src/services/workers/archive-validator.ts
var import_node_worker_threads6 = require("node:worker_threads");

// src/services/workers/archive-validation-protocol.ts
var import_node_path17 = __toESM(require("node:path"), 1);
function parseArchiveValidationRequest(value) {
  if (!exactObject(value, ["version", "kind", "file", "sha256", "size"]) || value.version !== 1 || value.kind !== "processor-output-validate" || typeof value.file !== "string" || value.file.length > 32760 || !import_node_path17.default.isAbsolute(value.file) || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256) || typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > 64 * 1024 ** 2) throw new Error("INVALID_ARCHIVE");
  return value;
}
function parseArchiveValidationReply(value) {
  if (exactObject(value, ["version", "kind", "entries", "bytes"]) && value.version === 1 && value.kind === "processor-output-valid" && typeof value.entries === "number" && Number.isSafeInteger(value.entries) && value.entries >= 1 && value.entries <= 65534 && typeof value.bytes === "number" && Number.isSafeInteger(value.bytes) && value.bytes >= 1 && value.bytes <= 256 * 1024 ** 2) return value;
  if (exactObject(value, ["version", "kind", "code"]) && value.version === 1 && value.kind === "processor-output-invalid" && typeof value.code === "string" && NATIVE_CODES.includes(value.code)) return value;
  throw new Error("INVALID_ARCHIVE");
}

// src/services/workers/archive-validator.ts
var ProcessorArchiveValidator = class {
  constructor(entry, timeoutMs = 12e4) {
    this.entry = entry;
    this.timeoutMs = timeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12e4) throw new InstallerExtractionError("INVALID_ARCHIVE");
  }
  entry;
  timeoutMs;
  validate(file, sha256, size, signal) {
    let request;
    try {
      request = parseArchiveValidationRequest({ version: 1, kind: "processor-output-validate", file, sha256, size });
    } catch {
      return Promise.reject(new InstallerExtractionError("INVALID_ARCHIVE"));
    }
    if (signal?.aborted) return Promise.reject(new InstallerExtractionError("CANCELLED"));
    let worker;
    try {
      worker = new import_node_worker_threads6.Worker(this.entry, { workerData: request, resourceLimits: { maxOldGenerationSizeMb: 384 } });
    } catch {
      return Promise.reject(new InstallerExtractionError("WORKER_FAILED"));
    }
    return new Promise((resolve, reject) => {
      let accepted2 = false;
      let failure3;
      const stop = (error) => {
        failure3 ??= error;
        void worker.terminate().catch(() => {
        });
      };
      const abort = () => stop(new InstallerExtractionError("CANCELLED"));
      const timer = setTimeout(() => stop(new InstallerExtractionError("EXTRACTION_TIMEOUT")), this.timeoutMs);
      worker.on("message", (value) => {
        if (accepted2 || failure3) {
          if (!failure3) stop(new InstallerExtractionError("WORKER_FAILED"));
          return;
        }
        try {
          const reply = parseArchiveValidationReply(value);
          if (reply.kind === "processor-output-invalid") failure3 = new InstallerExtractionError(reply.code);
          else accepted2 = true;
        } catch {
          stop(new InstallerExtractionError("WORKER_FAILED"));
        }
      });
      worker.once("error", () => {
        failure3 ??= new InstallerExtractionError("WORKER_FAILED");
      });
      worker.once("exit", (code3) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (failure3) reject(failure3);
        else if (code3 !== 0 || !accepted2) reject(new InstallerExtractionError("WORKER_FAILED"));
        else resolve();
      });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
};

// src/services/loaders/processor-executor.ts
var import_node_child_process2 = require("node:child_process");
var import_promises14 = require("node:fs/promises");
var import_node_path18 = __toESM(require("node:path"), 1);
var ProcessorExecutionError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "ProcessorExecutionError";
    this.category = code3 === "CANCELLED" ? "cancelled" : code3 === "INVALID_PROCESSOR_PLAN" || code3 === "OUTPUT_INVALID" ? "validation" : "system";
  }
  code;
  category;
};
var MAX_OUTPUT_BYTES = 32 * 1024 ** 2;
var MAX_ARTIFACT_BYTES = 1024 ** 3;
async function inspect(file) {
  try {
    const info = await (0, import_promises14.lstat)(file);
    return info.isFile() && !info.isSymbolicLink() ? "file" : "other";
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT" ? "missing" : "other";
  }
}
var InstallerProcessorExecutor = class {
  constructor(dependencies, stepTimeoutMs = 10 * 60 * 1e3, stopTimeoutMs = 5e3) {
    this.dependencies = dependencies;
    this.stepTimeoutMs = stepTimeoutMs;
    this.stopTimeoutMs = stopTimeoutMs;
    if (!Number.isSafeInteger(stepTimeoutMs) || stepTimeoutMs < 1e3 || stepTimeoutMs > 30 * 60 * 1e3 || !Number.isSafeInteger(stopTimeoutMs) || stopTimeoutMs < 1 || stopTimeoutMs > 3e4) throw new ProcessorExecutionError("INVALID_PROCESSOR_PLAN");
    this.start = dependencies.start ?? ((file, args, options) => (0, import_node_child_process2.spawn)(file, args, options));
    this.inspect = dependencies.inspect ?? inspect;
  }
  dependencies;
  stepTimeoutMs;
  stopTimeoutMs;
  start;
  inspect;
  async run(executable, major, plan, signal) {
    const cancel = () => {
      if (signal?.aborted) throw new ProcessorExecutionError("CANCELLED");
    };
    cancel();
    try {
      const runtime = await this.dependencies.probe.probe(executable, { ...signal === void 0 ? {} : { signal } });
      if (runtime.major !== major || runtime.architecture !== "x64") throw new Error();
    } catch {
      cancel();
      throw new ProcessorExecutionError("JAVA_INCOMPATIBLE");
    }
    const evidence = [];
    for (const command of plan.commands) {
      cancel();
      for (const output of command.outputs) if (await this.inspect(output.file) !== "missing") throw new ProcessorExecutionError("OUTPUT_INVALID");
      if (command.role === "download-mojang-mappings") {
        if (!this.dependencies.prepareMojangMappings) throw new ProcessorExecutionError("INVALID_PROCESSOR_PLAN");
        await this.dependencies.prepareMojangMappings(command, signal);
      } else await this.execute(executable, plan.workspace, command, signal);
      cancel();
      const outputs = [];
      for (const output of command.outputs) {
        let result2;
        try {
          result2 = await this.dependencies.hash.hash(output.file, {
            maximumBytes: MAX_ARTIFACT_BYTES,
            ...signal === void 0 ? {} : { signal }
          });
        } catch {
          cancel();
          throw new ProcessorExecutionError("OUTPUT_INVALID");
        }
        if (result2.size < 1 || output.expectedSha1 !== void 0 && result2.sha1 !== output.expectedSha1) throw new ProcessorExecutionError("OUTPUT_INVALID");
        if (/\.(?:jar|zip)$/i.test(output.file)) {
          try {
            await this.dependencies.validateArchive(output.file, result2.sha256, result2.size, signal);
          } catch {
            cancel();
            throw new ProcessorExecutionError("OUTPUT_INVALID");
          }
        }
        outputs.push({ file: output.file, ...result2, ...output.expectedSha1 === void 0 ? {} : { upstreamSha1: output.expectedSha1 } });
      }
      evidence.push({ role: command.role, tool: command.tool, outputs });
    }
    return evidence;
  }
  execute(executable, workspace, command, signal) {
    if (signal?.aborted) return Promise.reject(new ProcessorExecutionError("CANCELLED"));
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (["JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS", "CLASSPATH"].includes(key.toUpperCase())) delete env[key];
    let child;
    try {
      child = this.start(
        executable,
        ["-cp", command.classpath.join(import_node_path18.default.delimiter), command.mainClass, ...command.arguments],
        { cwd: workspace, env, shell: false, windowsHide: true, stdio: "pipe" }
      );
    } catch {
      return Promise.reject(new ProcessorExecutionError("PROCESSOR_FAILED"));
    }
    child.stdin.end();
    return new Promise((resolve, reject) => {
      let bytes = 0;
      let failure3;
      let stopping = false;
      let forceTimer;
      const terminate = (error) => {
        failure3 ??= error;
        if (stopping) return;
        stopping = true;
        try {
          child.kill("SIGTERM");
        } catch {
        }
        forceTimer = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
          }
        }, this.stopTimeoutMs);
      };
      const receive = (value) => {
        if (failure3) return;
        if (!Buffer.isBuffer(value) && typeof value !== "string") {
          terminate(new ProcessorExecutionError("PROCESSOR_FAILED"));
          return;
        }
        bytes += Buffer.byteLength(value);
        if (bytes > MAX_OUTPUT_BYTES) terminate(new ProcessorExecutionError("OUTPUT_LIMIT"));
      };
      const abort = () => terminate(new ProcessorExecutionError("CANCELLED"));
      const timer = setTimeout(() => terminate(new ProcessorExecutionError("PROCESSOR_TIMEOUT")), this.stepTimeoutMs);
      child.stdout.on("data", receive);
      child.stderr.on("data", receive);
      child.stdout.once("error", () => terminate(new ProcessorExecutionError("PROCESSOR_FAILED")));
      child.stderr.once("error", () => terminate(new ProcessorExecutionError("PROCESSOR_FAILED")));
      child.once("error", () => terminate(new ProcessorExecutionError("PROCESSOR_FAILED")));
      child.once("close", (code3, processSignal) => {
        clearTimeout(timer);
        if (forceTimer) clearTimeout(forceTimer);
        signal?.removeEventListener("abort", abort);
        if (failure3) reject(failure3);
        else if (code3 !== 0 || processSignal !== null) reject(new ProcessorExecutionError("PROCESSOR_FAILED"));
        else resolve();
      });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
};

// src/services/loaders/processor-workspace.ts
var import_promises15 = require("node:fs/promises");
var import_node_path20 = __toESM(require("node:path"), 1);

// src/services/loaders/processor-plan.ts
var import_node_path19 = __toESM(require("node:path"), 1);
var ProcessorPlanError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "ProcessorPlanError";
  }
  code;
  category = "validation";
};
var OUTPUTS = {
  "extract-mappings": ["MAPPINGS"],
  "download-mojang-mappings": ["MOJMAPS"],
  "merge-mappings": ["MERGED_MAPPINGS"],
  "split-client": ["MC_SLIM", "MC_EXTRA"],
  "rename-client": ["MC_SRG"],
  "apply-client-patches": ["PATCHED"]
};
var fail = (code3 = "INVALID_PROCESSOR_PLAN") => {
  throw new ProcessorPlanError(code3);
};
function absolute3(value) {
  if (typeof value !== "string" || value.length > 32760 || value.includes("\0") || !import_node_path19.default.isAbsolute(value)) return fail();
  return import_node_path19.default.resolve(value);
}
function inside(root, value) {
  const target = absolute3(value);
  const relative = import_node_path19.default.relative(root, target);
  if (!relative || relative.startsWith("..") || import_node_path19.default.isAbsolute(relative)) return fail();
  return target;
}
function libraryPath(workspace, relative) {
  return inside(workspace, import_node_path19.default.join(workspace, "libraries", ...relative.split("/")));
}
function dataValue2(workspace, value) {
  if (value.kind === "artifact") return libraryPath(workspace, value.path);
  if (value.kind === "embedded") return inside(workspace, import_node_path19.default.join(workspace, "installer", ...value.entry.split("/")));
  return value.value;
}
function planInstallerProcessors(profile, input) {
  const workspace = absolute3(input.workspace);
  const installerFile = inside(workspace, input.installerFile);
  const minecraftJar = absolute3(input.minecraftJar);
  const processors = enforceInstallerProcessorPolicy(profile);
  const libraries = new Map(profile.libraries.map((item) => [item.coordinate, libraryPath(workspace, item.path)]));
  const values = /* @__PURE__ */ new Map([["SIDE", "client"], ["MINECRAFT_JAR", minecraftJar], ["INSTALLER", installerFile], ["ROOT", workspace]]);
  for (const [key, value] of Object.entries(profile.data)) values.set(key, dataValue2(workspace, value));
  const expand = (value) => {
    const artifact = /^\[([^\]]+)\]$/.exec(value);
    if (artifact) return libraries.get(artifact[1]) ?? fail();
    let unknown = false;
    const result2 = value.replace(/\{([A-Z][A-Z0-9_]{0,63})\}/g, (_whole, key) => {
      const replacement = values.get(key);
      if (replacement === void 0) {
        unknown = true;
        return "";
      }
      return replacement;
    });
    if (unknown || /\{[A-Z][A-Z0-9_]{0,63}\}/.test(result2) || result2.includes("\0")) return fail();
    return result2;
  };
  const commands = processors.map((processor2) => {
    const mainClass = input.mainClasses[processor2.tool];
    if (mainClass === void 0) return fail("UNTRUSTED_PROCESSOR");
    try {
      requireProcessorMainClass(profile.kind, processor2.role, mainClass);
    } catch {
      return fail("UNTRUSTED_PROCESSOR");
    }
    const tool = libraries.get(processor2.tool);
    if (tool === void 0) return fail();
    const classpath = [.../* @__PURE__ */ new Set([...processor2.classpath, processor2.tool])].map((coordinate2) => libraries.get(coordinate2) ?? fail());
    const outputs = OUTPUTS[processor2.role].map((key) => {
      const file = values.get(key);
      if (file === void 0) return fail();
      inside(workspace, file);
      const proof = values.get(`${key}_SHA`);
      if (proof !== void 0 && !/^[a-f0-9]{40}$/.test(proof)) return fail();
      return { file, ...proof === void 0 ? {} : { expectedSha1: proof } };
    });
    return { role: processor2.role, tool, mainClass, classpath, arguments: processor2.arguments.map(expand), outputs };
  });
  return { workspace, commands };
}

// src/services/loaders/processor-workspace.ts
var import_node_crypto17 = require("node:crypto");
var ProcessorWorkspaceError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "ProcessorWorkspaceError";
    this.category = code3 === "CANCELLED" ? "cancelled" : "validation";
  }
  code;
  category;
};
var invalid8 = () => {
  throw new ProcessorWorkspaceError("INVALID_PROCESSOR_INPUT");
};
var check = (signal) => {
  if (signal.aborted) throw new ProcessorWorkspaceError("CANCELLED");
};
function clientMappingsSpec(metadata2) {
  const minecraft = metadata2.loader.kind === "forge" ? "1.20.1" : "1.21.1";
  const body = metadata2.versionDocuments[minecraft];
  const digest3 = metadata2.metadataSha1ByVersion[minecraft];
  if (!body || !digest3 || (0, import_node_crypto17.createHash)("sha1").update(body).digest("hex") !== digest3) return invalid8();
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    return invalid8();
  }
  if (!record(value) || value.id !== minecraft || !record(value.downloads)) return invalid8();
  let artifact;
  try {
    artifact = parseArtifact(value.downloads.client_mappings);
  } catch {
    return invalid8();
  }
  if (!/^https:\/\/piston-data\.mojang\.com\/v1\/objects\/[a-f0-9]{40}\/client\.txt$/.test(artifact.url) || !artifact.url.includes(`/${artifact.sha1}/`) || artifact.size < 1 || artifact.size > 64 * 1024 ** 2) return invalid8();
  return { url: artifact.url, expected: {
    algorithm: "sha1",
    digest: artifact.sha1,
    size: artifact.size,
    provenanceId: `version:${digest3}:${artifact.sha1}`
  }, anchor: { kind: "mojang-version", algorithm: "sha1", digest: digest3 } };
}
async function outputDirectories(workspace, relative) {
  installRelativePath(relative);
  let directory2 = await guardDirectory(workspace);
  for (const part of relative.split("/").slice(0, -1)) {
    directory2 = import_node_path20.default.join(directory2, part);
    try {
      await (0, import_promises15.mkdir)(directory2);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
    await guardDirectory(directory2);
  }
}
async function prepareProcessorWorkspace(metadata2, downloaded, workspace, views, manifests, signal) {
  check(signal);
  await guardDirectory(workspace);
  const loader2 = metadata2.loader;
  const profile = parseStoredInstallerProfile(
    loader2.kind,
    profileMinecraft(metadata2),
    loader2.version,
    loader2.profileBody,
    loader2.profileSha256,
    loader2.versionBody,
    loader2.versionSha256
  );
  const pinned = rebuildPreparedInstallerPlan(metadata2);
  const client2 = pinned.views.find((view) => view.area === "version" && view.path === "client.jar");
  if (!client2) return invalid8();
  const copy = async (artifactId, relative) => {
    check(signal);
    const artifact = pinned.artifacts.find((item) => item.artifactId === artifactId);
    const object4 = downloaded.objects.get(artifactId);
    if (!artifact || !object4 || object4.size !== artifact.size) return invalid8();
    await views.materialize(workspace, relative, artifactSpec(artifact), object4, { mode: "copy", signal });
    check(signal);
    return object4;
  };
  await copy(client2.artifactId, "minecraft/client.jar");
  const mainClasses = {};
  const tools = new Set(profile.processors.map((processor2) => processor2.tool));
  for (const library2 of profile.libraries) {
    const object4 = await copy(`sha1-${library2.sha1}`, `libraries/${library2.path}`);
    if (tools.has(library2.coordinate)) mainClasses[library2.coordinate] = await manifests.read({
      file: import_node_path20.default.join(workspace, "libraries", library2.path),
      sha256: object4.digest,
      size: object4.size
    }, signal);
  }
  const plan = planInstallerProcessors(profile, {
    workspace,
    installerFile: import_node_path20.default.join(workspace, "installer.jar"),
    minecraftJar: import_node_path20.default.join(workspace, "minecraft/client.jar"),
    mainClasses
  });
  for (const command of plan.commands) for (const output of command.outputs) {
    check(signal);
    await outputDirectories(workspace, import_node_path20.default.relative(workspace, output.file).split(import_node_path20.default.sep).join("/"));
  }
  return plan;
}
function profileMinecraft(metadata2) {
  return metadata2.loader.kind === "forge" ? "1.20.1" : "1.21.1";
}
function prepareMojangMappings(metadata2, workspace, consumerId, downloads, views) {
  const spec = clientMappingsSpec(metadata2);
  const profile = parseStoredInstallerProfile(
    metadata2.loader.kind,
    profileMinecraft(metadata2),
    metadata2.loader.version,
    metadata2.loader.profileBody,
    metadata2.loader.profileSha256,
    metadata2.loader.versionBody,
    metadata2.loader.versionSha256
  );
  const target = profile.data.MOJMAPS;
  if (target?.kind !== "artifact") return invalid8();
  return async (command, signal) => {
    if (command.role !== "download-mojang-mappings" || command.outputs.length !== 1 || import_node_path20.default.resolve(command.outputs[0].file) !== import_node_path20.default.resolve(workspace, "libraries", target.path)) return invalid8();
    const object4 = await downloads.request(spec, { consumerId, ...signal ? { signal } : {} }).result;
    await views.materialize(workspace, `libraries/${target.path}`, spec, object4, { mode: "copy", ...signal ? { signal } : {} });
  };
}

// src/services/loaders/installer-processing.ts
async function processInstallerWorkspace(metadata2, downloaded, workspace, executable, mappingConsumerId, entry, runtime, signal) {
  const plan = await prepareProcessorWorkspace(metadata2, downloaded, workspace, runtime.views, new ProcessorManifestReader(entry), signal);
  const validator = new ProcessorArchiveValidator(entry);
  const executor = new InstallerProcessorExecutor({
    probe: new JavaProbe(),
    hash: runtime.hashes,
    validateArchive: (file, sha256, size, cancellation) => validator.validate(file, sha256, size, cancellation),
    prepareMojangMappings: prepareMojangMappings(metadata2, workspace, mappingConsumerId, runtime.coordinator, runtime.views)
  });
  const result2 = await executor.run(executable, metadata2.loader.kind === "forge" ? 17 : 21, plan, signal);
  const loader2 = metadata2.loader;
  const profile = parseStoredInstallerProfile(
    loader2.kind,
    loader2.kind === "forge" ? "1.20.1" : "1.21.1",
    loader2.version,
    loader2.profileBody,
    loader2.profileSha256,
    loader2.versionBody,
    loader2.versionSha256
  );
  return result2.map((step, index) => ({
    role: step.role,
    tool: profile.processors[index].tool,
    mainClass: plan.commands[index].mainClass,
    outputs: step.outputs.map((output) => ({
      path: import_node_path21.default.relative(import_node_path21.default.join(workspace, "libraries"), output.file).split(import_node_path21.default.sep).join("/"),
      size: output.size,
      sha1: output.sha1,
      sha256: output.sha256,
      ...output.upstreamSha1 ? { upstreamSha1: output.upstreamSha1 } : {}
    }))
  }));
}

// src/services/mods/inventory.ts
var import_node_crypto18 = require("node:crypto");
var import_promises16 = require("node:fs/promises");
var import_node_path22 = __toESM(require("node:path"), 1);

// src/core/mods/ranges.ts
function numeric(value) {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) return void 0;
  const parts = match.slice(1, 5).filter((part) => part !== void 0).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) return void 0;
  return { parts, prerelease: match[5]?.split(".") ?? [] };
}
function compare(a, b) {
  for (let i = 0; i < Math.max(a.parts.length, b.parts.length); i++) {
    const delta = (a.parts[i] ?? 0) - (b.parts[i] ?? 0);
    if (delta) return Math.sign(delta);
  }
  if (!a.prerelease.length || !b.prerelease.length) return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === y) continue;
    if (x === void 0 || y === void 0) return x === void 0 ? -1 : 1;
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
      if (x.length !== y.length) return Math.sign(x.length - y.length);
    } else if (/^\d+$/.test(x) !== /^\d+$/.test(y)) return /^\d+$/.test(x) ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
function allCompatibility(values) {
  return values.includes("unsatisfied") ? "unsatisfied" : values.includes("unknown") ? "unknown" : "satisfied";
}
function anyCompatibility(values) {
  return values.includes("satisfied") ? "satisfied" : values.includes("unknown") ? "unknown" : "unsatisfied";
}
function result(value) {
  return value ? "satisfied" : "unsatisfied";
}
function predicate(value, version3) {
  if (value === "*") return "satisfied";
  const match = /^(>=|<=|>|<|=|~|\^)?([^\s]+)$/.exec(value);
  if (!match) return "unknown";
  const operator = match[1] ?? "=";
  const base = match[2];
  if (operator === "=" && base === version3) return "satisfied";
  const wild = /^(\d+(?:\.\d+)*)\.([x*])(?:\.[x*])*$/i.exec(base);
  if (wild) {
    const actual2 = numeric(version3);
    if (!actual2 || operator !== "=") return "unknown";
    return result(wild[1].split(".").every((part, i) => Number(part) === actual2.parts[i]));
  }
  const actual = numeric(version3);
  const expected = numeric(base);
  if (!actual || !expected) return "unknown";
  const order = compare(actual, expected);
  switch (operator) {
    case "=":
      return result(order === 0);
    case ">":
      return result(order > 0);
    case ">=":
      return result(order >= 0);
    case "<":
      return result(order < 0);
    case "<=":
      return result(order <= 0);
    case "~":
    case "^": {
      const count = operator === "~" ? 2 : 1;
      return result(order >= 0 && Array.from({ length: count }, (_, index) => index).every((index) => (actual.parts[index] ?? 0) === (expected.parts[index] ?? 0)));
    }
    default:
      return "unknown";
  }
}
function maven(range2, version3) {
  const actual = numeric(version3);
  if (!actual) return "unknown";
  if (!/^[[(]/.test(range2)) return "unknown";
  const intervals = range2.match(/[[(][^()[\]]*[)\]]/g);
  if (!intervals || intervals.join(",").replace(/\s/g, "") !== range2.replace(/\s/g, "")) return "unknown";
  return anyCompatibility(intervals.map((interval) => {
    const body = interval.slice(1, -1).trim();
    if (!body.includes(",")) {
      if (!interval.startsWith("[") || !interval.endsWith("]")) return "unknown";
      const expected = numeric(body);
      return expected ? result(compare(actual, expected) === 0) : "unknown";
    }
    const bounds = body.split(",").map((bound) => bound.trim());
    if (bounds.length !== 2 || bounds.every((bound) => !bound)) return "unknown";
    const low = bounds[0] ? numeric(bounds[0]) : void 0;
    const high = bounds[1] ? numeric(bounds[1]) : void 0;
    if (bounds[0] && !low || bounds[1] && !high || low && high && compare(low, high) > 0) return "unknown";
    return result((!low || compare(actual, low) > 0 || compare(actual, low) === 0 && interval.startsWith("[")) && (!high || compare(actual, high) < 0 || compare(actual, high) === 0 && interval.endsWith("]")));
  }));
}
function matchesModRange(range2, version3, dialect, depth = 0) {
  if (depth > 16 || !version3 || version3.length > 160) return "unknown";
  if (Array.isArray(range2)) {
    if (!range2.length || range2.length > 128 || dialect === "maven") return "unknown";
    return anyCompatibility(range2.map((item) => matchesModRange(item, version3, dialect, depth + 1)));
  }
  if (dialect === "quilt" && typeof range2 === "object" && range2 !== null) {
    const keys2 = Object.keys(range2);
    if (keys2.length !== 1 || !["any", "all"].includes(keys2[0])) return "unknown";
    const raw = range2[keys2[0]];
    if (!Array.isArray(raw) || !raw.length || raw.length > 128) return "unknown";
    const values = raw.map((item) => matchesModRange(item, version3, dialect, depth + 1));
    return keys2[0] === "all" ? allCompatibility(values) : anyCompatibility(values);
  }
  if (typeof range2 !== "string" || !range2.trim() || range2.length > 2048) return "unknown";
  const text4 = range2.trim();
  if (text4 === "*") return "satisfied";
  if (dialect === "maven") return maven(text4, version3);
  if (text4.includes("|") || text4.includes("&") || /[><=~^]\s/.test(text4)) return "unknown";
  const tokens = text4.split(/\s+/);
  if (dialect === "quilt" && tokens.length > 1) return "unknown";
  return allCompatibility(tokens.map((token) => predicate(dialect === "quilt" && numeric(token) ? "^" + token : token, version3)));
}

// src/core/mods/check.ts
var RUNTIME_IDS = /* @__PURE__ */ new Set(["minecraft", "java", "fabricloader", "quilt_loader", "forge", "neoforge"]);
function checkLocalMods(files, environment2) {
  const issues2 = [];
  const providers = [];
  const mods = [];
  const add = (severity, code3, fileId2, modId2 = null, dependencyId2 = null, expected = null, actual = [], via = []) => {
    if (issues2.length >= 4096) return;
    if (issues2.length === 4095) {
      issues2.push({ severity: "unknown", code: "REPORT_LIMIT", fileId: "", modId: null, dependencyId: null, expected: null, actual: [], via: [] });
      return;
    }
    issues2.push({ severity, code: code3, fileId: fileId2, modId: modId2, dependencyId: dependencyId2, expected, actual, via });
  };
  const selected = (archive) => {
    if (environment2.loader === "vanilla") return void 0;
    return archive.declarations.find((item) => item.format === environment2.loader) ?? (environment2.loader === "quilt" ? archive.declarations.find((item) => item.format === "fabric") : void 0);
  };
  const compare2 = (range2, version3, format) => {
    if (range2 === null || typeof version3 !== "string") return "unknown";
    return matchesModRange(range2, version3, format === "forge" || format === "neoforge" ? "maven" : format);
  };
  if (files.length > 256) add("unknown", "INSTANCE_MOD_LIMIT", "");
  for (const file of files.slice(0, 256)) {
    if (!file.enabled) continue;
    for (const issue of file.issues) add("unknown", issue, file.fileId);
    const root = file.archives.find((archive) => archive.entries.length === 0);
    if (!root || file.archives.length > 64) {
      add("unknown", "UNKNOWN_ARCHIVE", file.fileId);
      continue;
    }
    const visited = /* @__PURE__ */ new Set();
    const visit = (archive) => {
      const identity3 = JSON.stringify(archive.entries);
      if (visited.has(identity3)) return;
      visited.add(identity3);
      if (archive.entries.length > 4 || visited.size > 64) {
        add("unknown", "NESTED_MOD_LIMIT", file.fileId);
        return;
      }
      const facts = selected(archive);
      const via = [...archive.entries];
      if (!facts) {
        add(archive.declarations.length ? "error" : "unknown", archive.declarations.length ? "LOADER_MISMATCH" : "UNKNOWN_DECLARATION", file.fileId, null, null, null, [], via);
        return;
      }
      for (const issue of facts.issues) add("unknown", issue, file.fileId, null, null, null, [], via);
      if (!facts.mods.length && !facts.issues.length) add("unknown", "UNKNOWN_DECLARATION", file.fileId, null, null, null, [], via);
      if (archive.jarJar) add("unknown", "JARJAR_SELECTION_REQUIRES_CHECK", file.fileId, null, null, null, [], via);
      for (const mod of facts.mods) {
        if (mod.client === "no") {
          add("warning", "SERVER_ONLY_MOD", file.fileId, mod.id, null, null, [], via);
          continue;
        }
        if (mod.client === "unknown") {
          add("unknown", "UNKNOWN_ENVIRONMENT", file.fileId, mod.id, null, null, [], via);
          continue;
        }
        if (mods.length >= 256) {
          add("unknown", "INSTANCE_MOD_LIMIT", file.fileId);
          break;
        }
        for (const issue of mod.issues) add("unknown", issue, file.fileId, mod.id, null, null, [], via);
        mods.push({ fileId: file.fileId, mod, format: facts.format, via });
        providers.push({ fileId: file.fileId, id: mod.id, ownerId: mod.id, version: mod.version, via });
        for (const alias of mod.provides) providers.push({ fileId: file.fileId, id: alias.id, ownerId: mod.id, version: alias.version, via });
        if (facts.language) {
          const actual = Object.hasOwn(environment2.languageVersions, facts.language.id) ? environment2.languageVersions[facts.language.id] : void 0;
          const outcome = compare2(facts.language.range, actual, facts.format);
          if (outcome !== "satisfied") add(
            outcome === "unknown" ? "unknown" : "error",
            "LANGUAGE_REQUIREMENT",
            file.fileId,
            mod.id,
            facts.language.id,
            facts.language.range,
            actual ? [actual] : [],
            via
          );
        }
      }
      if (!facts.mods.some((mod) => mod.client === "yes")) return;
      for (const path27 of facts.nested) {
        const chain = [...archive.entries, path27];
        const matches = file.archives.filter((child) => JSON.stringify(child.entries) === JSON.stringify(chain));
        if (matches.length !== 1) add("unknown", "NESTED_DECLARATION_MISSING", file.fileId, null, null, null, [], chain);
        else visit(matches[0]);
      }
    };
    visit(root);
  }
  const byId = /* @__PURE__ */ new Map();
  for (const provider of providers) {
    const group = byId.get(provider.id) ?? [];
    group.push(provider);
    byId.set(provider.id, group);
  }
  for (const [id2, group] of byId) {
    if (group.length > 1 || RUNTIME_IDS.has(id2)) {
      const actual = group.slice(0, 16).map((item) => item.version ?? "?");
      for (const provider of group) add("error", "DUPLICATE_MOD_ID", provider.fileId, provider.ownerId, id2, null, actual, provider.via);
    }
  }
  for (const { fileId: fileId2, mod, format, via } of mods) {
    for (const dependency of mod.dependencies) {
      if (dependency.client === "no") continue;
      if (dependency.client === "unknown") {
        add("unknown", "UNKNOWN_DEPENDENCY_ENVIRONMENT", fileId2, mod.id, dependency.id, dependency.range, [], via);
        continue;
      }
      for (const issue of dependency.issues) add("unknown", issue, fileId2, mod.id, dependency.id, dependency.range, [], via);
      const runtime = RUNTIME_IDS.has(dependency.id);
      const group = runtime ? [] : byId.get(dependency.id) ?? [];
      const present2 = runtime ? Object.hasOwn(environment2.versions, dependency.id) : group.length > 0;
      if (!present2) {
        if (dependency.kind === "required") add("error", runtime ? "RUNTIME_DEPENDENCY_MISSING" : "MOD_DEPENDENCY_MISSING", fileId2, mod.id, dependency.id, dependency.range, [], via);
        continue;
      }
      if (!runtime && group.length > 1) continue;
      const actual = runtime ? environment2.versions[dependency.id] : group[0].version;
      const outcome = compare2(dependency.range, actual, format);
      if (outcome === "unknown") add("unknown", "UNKNOWN_DEPENDENCY_RANGE", fileId2, mod.id, dependency.id, dependency.range, actual ? [actual] : [], via);
      else if (dependency.kind === "required" || dependency.kind === "optional") {
        if (outcome === "unsatisfied") add("error", "DEPENDENCY_VERSION_MISMATCH", fileId2, mod.id, dependency.id, dependency.range, actual ? [actual] : [], via);
      } else if (outcome === "satisfied") add(
        dependency.kind === "incompatible" ? "error" : "warning",
        dependency.kind === "incompatible" ? "MOD_CONFLICT" : "MOD_DISCOURAGED",
        fileId2,
        mod.id,
        dependency.id,
        dependency.range,
        actual ? [actual] : [],
        via
      );
    }
  }
  return { state: issues2.some((issue) => issue.severity === "error") ? "unsatisfied" : issues2.some((issue) => issue.severity === "unknown") ? "unknown" : "satisfied", issues: issues2, providers };
}

// src/services/install/native-archive.ts
var MAX_ARCHIVE = 64 * 1024 ** 2;
var MAX_TOTAL = 256 * 1024 ** 2;

// src/core/mods/declarations.ts
function modObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function modText(value, maximum = 160) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && ![...value].some((character) => character.charCodeAt(0) < 32);
}
function modId(value, format) {
  return typeof value === "string" && (format === "forge" || format === "neoforge" ? /^[a-z][a-z0-9_]{1,63}$/ : /^[a-z][a-z0-9_-]{1,63}$/).test(value);
}
function modRange(value, depth = 0, budget2 = { nodes: 0 }) {
  if (depth > 16 || ++budget2.nodes > 256) return null;
  if (modText(value, 2048) && !value.includes("${")) return value;
  if (Array.isArray(value)) {
    if (!value.length || value.length > 128) return null;
    const children = value.map((item) => modRange(item, depth + 1, budget2));
    return children.every((item) => item !== null) ? children : null;
  }
  if (modObject(value) && Object.keys(value).length === 1) {
    const key = Object.keys(value)[0];
    if (key !== "any" && key !== "all" || !Array.isArray(value[key])) return null;
    const list = modRange(value[key], depth + 1, budget2);
    if (!Array.isArray(list)) return null;
    return key === "any" ? { any: list } : { all: list };
  }
  return null;
}
function modNested(value, objectEntries, issues2) {
  if (value === void 0) return [];
  if (!Array.isArray(value) || value.length > 64) {
    issues2.push("UNKNOWN_NESTED_JARS");
    return [];
  }
  const result2 = [];
  for (const item of value) {
    const name2 = objectEntries && modObject(item) ? item.file : item;
    try {
      if (!modText(name2, 4096) || !name2.endsWith(".jar")) throw new Error("INVALID");
      installRelativePath(name2);
      if (result2.includes(name2)) throw new Error("DUPLICATE");
      result2.push(name2);
    } catch {
      issues2.push("UNKNOWN_NESTED_JARS");
    }
  }
  return result2;
}

// ../OUCL/node_modules/.pnpm/smol-toml@1.9.0/node_modules/smol-toml/dist/stringify.js
var HAS_WELLFORMED = !!"".isWellFormed;

// src/services/mods/archive.ts
var MOD_DOCUMENTS = [
  "fabric.mod.json",
  "quilt.mod.json",
  "META-INF/mods.toml",
  "META-INF/neoforge.mods.toml",
  "META-INF/jarjar/metadata.json",
  "META-INF/MANIFEST.MF"
];
var MOD_ARCHIVE_CODES = [
  "INVALID_ARCHIVE",
  "UNSAFE_ARCHIVE",
  "ARCHIVE_LIMIT",
  "ARCHIVE_IO",
  "CANCELLED",
  "SCAN_TIMEOUT",
  "WORKER_FAILED",
  "QUEUE_FULL"
];
var ModArchiveError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "ModArchiveError";
    this.category = code3 === "CANCELLED" ? "cancelled" : code3 === "ARCHIVE_IO" ? "disk" : code3 === "WORKER_FAILED" || code3 === "SCAN_TIMEOUT" ? "system" : code3 === "QUEUE_FULL" ? "biz" : "validation";
  }
  code;
  category;
};

// src/services/mods/facts.ts
function archiveFacts(scan) {
  return scan.archives.map((archive) => ({
    entries: archive.entries,
    declarations: archive.declarations,
    jarJar: archive.documents.some((document) => document.name === "META-INF/jarjar/metadata.json")
  }));
}
function platformFacts(items) {
  return items.map((item) => ({
    fileId: item.fileId,
    enabled: item.enabled,
    size: item.size,
    sha1: item.sha1,
    sha512: item.sha512,
    formats: item.archives.find((archive) => !archive.entries.length)?.declarations.map((declaration) => declaration.format) ?? [],
    unresolvedEmbedded: item.archives.some((archive) => archive.jarJar || archive.entries.length > 0)
  }));
}

// src/services/mods/inventory.ts
var ModInventoryError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "ModInventoryError";
    this.category = code3 === "CANCELLED" ? "cancelled" : code3 === "INVALID_ARGUMENT" ? "validation" : code3 === "MODS_UNSAFE" || code3 === "SCAN_FAILED" ? "disk" : "biz";
  }
  code;
  category;
};
var digest = (value) => (0, import_node_crypto18.createHash)("sha256").update(JSON.stringify(value)).digest("hex");
function modInventoryFingerprint(instanceId, revision, items) {
  return digest({ instanceId, revision, items: [...items].sort((left, right) => left.filename < right.filename ? -1 : left.filename > right.filename ? 1 : 0).map((item) => ({ fileId: item.fileId, filename: item.filename, enabled: item.enabled, size: item.size, sha256: item.sha256, issues: item.issues })) });
}
async function stamp(file) {
  const info = await (0, import_promises16.lstat)(file);
  return {
    size: info.size,
    mtimeMs: info.mtimeMs,
    ctimeMs: info.ctimeMs,
    ino: info.ino,
    dev: info.dev,
    regular: info.isFile() && !info.isSymbolicLink()
  };
}
var ModInventoryService = class {
  constructor(context, scanner) {
    this.context = context;
    this.scanner = scanner;
  }
  context;
  scanner;
  active = false;
  /** A stable observation, not an installation authorization; commit must independently rehash every planned file. */
  async scan(instanceId, expectedRevision, signal) {
    if (!UUID_PATTERN.test(instanceId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new ModInventoryError("INVALID_ARGUMENT");
    if (this.active) throw new ModInventoryError("SCAN_BUSY");
    this.active = true;
    const check2 = () => {
      if (signal?.aborted) throw new ModInventoryError("CANCELLED");
    };
    try {
      check2();
      const context = await this.context(instanceId.toLowerCase(), signal);
      check2();
      if (context.instanceId !== instanceId.toLowerCase() || context.revision !== expectedRevision) throw new ModInventoryError("REVISION_CONFLICT");
      await guardDirectory(import_node_path22.default.dirname(context.modsDirectory));
      const names = await this.names(context.modsDirectory, check2);
      const items = [];
      const stamps = /* @__PURE__ */ new Map();
      let factsBytes = 0;
      for (const filename of names) {
        check2();
        const target = import_node_path22.default.join(context.modsDirectory, filename);
        const before = await stamp(target);
        const item = {
          fileId: digest({ instanceId: context.instanceId, filename }),
          filename,
          enabled: !filename.toLowerCase().endsWith(".disabled"),
          size: before.size,
          sha1: null,
          sha256: null,
          sha512: null,
          archives: [],
          issues: []
        };
        if (!before.regular) item.issues.push("UNSAFE_ARCHIVE");
        else {
          try {
            const scan = await this.scanner.read(target, signal);
            check2();
            item.size = scan.size;
            item.sha1 = scan.sha1;
            item.sha256 = scan.sha256;
            item.sha512 = scan.sha512;
            item.archives = archiveFacts(scan);
          } catch (error) {
            check2();
            if (!(error instanceof ModArchiveError)) throw error;
            item.issues.push(error.code);
          }
        }
        const after = await stamp(target);
        if (digest(before) !== digest(after)) throw new ModInventoryError("FILES_CHANGED");
        stamps.set(filename, after);
        factsBytes += Buffer.byteLength(JSON.stringify(item));
        if (factsBytes > 8 * 1024 ** 2) throw new ModInventoryError("MOD_LIMIT");
        items.push(item);
      }
      check2();
      if (digest(names) !== digest(await this.names(context.modsDirectory, check2))) throw new ModInventoryError("FILES_CHANGED");
      for (const filename of names) {
        check2();
        if (digest(stamps.get(filename)) !== digest(await stamp(import_node_path22.default.join(context.modsDirectory, filename)))) throw new ModInventoryError("FILES_CHANGED");
      }
      const latest = await this.context(instanceId.toLowerCase(), signal);
      check2();
      if (digest(latest) !== digest(context)) throw new ModInventoryError("REVISION_CONFLICT");
      const fingerprint = modInventoryFingerprint(context.instanceId, expectedRevision, items);
      return { instanceId: context.instanceId, revision: expectedRevision, fingerprint, items, local: checkLocalMods(items, context.environment) };
    } catch (error) {
      if (error instanceof ModInventoryError) throw error;
      if (signal?.aborted) throw new ModInventoryError("CANCELLED");
      if (hasCode(error, "ENOENT")) throw new ModInventoryError("FILES_CHANGED");
      if (hasCode(error, "UNSAFE_PATH")) throw new ModInventoryError("MODS_UNSAFE");
      throw new ModInventoryError("SCAN_FAILED");
    } finally {
      this.active = false;
    }
  }
  async names(directory2, check2) {
    try {
      await guardDirectory(directory2);
    } catch (error) {
      if (hasCode(error, "ENOENT")) return [];
      throw error;
    }
    const names = [];
    let entries = 0;
    for await (const entry of await (0, import_promises16.opendir)(directory2)) {
      check2();
      if (++entries > 4096) throw new ModInventoryError("MOD_LIMIT");
      if (!/\.jar(?:\.disabled)?$/i.test(entry.name)) continue;
      try {
        validateComponent(entry.name);
      } catch {
        throw new ModInventoryError("MODS_UNSAFE");
      }
      names.push(entry.name);
      if (names.length > 256) throw new ModInventoryError("MOD_LIMIT");
    }
    return names.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  }
};

// src/services/mods/context.ts
var import_node_path23 = __toESM(require("node:path"), 1);
function modInventoryContext(storage, languages, java) {
  return async (instanceId, signal) => {
    const root = await storage.readInstallation();
    const record3 = await storage.readInstance(instanceId);
    if (!root || !record3 || record3.data.summary.rootId !== root.data.rootId || record3.data.phase !== "ready") throw new ModInventoryError("INVALID_ARGUMENT");
    const prepared = restoreInstallMetadata(record3.data);
    const layout = instanceGameLayout(root.data.dataDirectory, record3.data.summary, prepared);
    const loader2 = record3.data.loader ?? { kind: "vanilla" };
    const versions = { minecraft: record3.data.summary.mcVersionId, java: null };
    if (loader2.kind !== "vanilla") versions[{ fabric: "fabricloader", quilt: "quilt_loader", forge: "forge", neoforge: "neoforge" }[loader2.kind]] = loader2.version;
    if (loader2.kind === "quilt") versions.fabricloader = languages?.readRuntime ? await languages.readRuntime(root.data.dataDirectory, record3.data, signal) : null;
    const languageVersions = languages ? await languages.read(root.data.dataDirectory, record3.data, signal) : {};
    if (java) versions.java = await java.read(prepared.version.javaMajor, signal);
    return {
      instanceId,
      revision: record3.revision,
      modsDirectory: import_node_path23.default.join(layout.gameDirectory, "mods"),
      environment: { loader: loader2.kind, versions, languageVersions }
    };
  };
}

// src/services/mods/languages.ts
var import_node_path24 = __toESM(require("node:path"), 1);

// src/core/loaders/languages.ts
function loaderLanguageCandidates(kind, minecraft, loaderVersion, paths) {
  if (paths.length > 256) return [];
  if (kind === "forge" && minecraft === "1.20.1" && /^47\.\d+\.\d+$/.test(loaderVersion)) {
    const version3 = `${minecraft}-${loaderVersion}`;
    return [["javafmllanguage", "javafml"], ["lowcodelanguage", "lowcodefml"]].flatMap(([artifact, id2]) => {
      const expected = `net/minecraftforge/${artifact}/${version3}/${artifact}-${version3}.jar`;
      return paths.filter((path27) => path27 === expected).length === 1 ? [{ path: expected, versions: { [id2]: "47" } }] : [];
    });
  }
  if (kind === "neoforge" && minecraft === "1.21.1" && /^21\.1\.\d+$/.test(loaderVersion)) {
    const matching = paths.flatMap((path27) => {
      const match = /^net\/neoforged\/fancymodloader\/loader\/(4\.0\.\d+)\/loader-\1\.jar$/.exec(path27);
      return match ? [{ path: path27, versions: { javafml: match[1], lowcodefml: match[1] } }] : [];
    });
    return matching.length === 1 ? matching : [];
  }
  return [];
}

// src/services/mods/languages.ts
var InstalledLanguageReader = class {
  constructor(scanner) {
    this.scanner = scanner;
  }
  scanner;
  async read(dataDirectory, record3, signal) {
    const loader2 = record3.metadata?.loader;
    if (!loader2 || loader2.kind !== "forge" && loader2.kind !== "neoforge") return {};
    const candidates = loaderLanguageCandidates(loader2.kind, record3.summary.mcVersionId, loader2.version, loader2.libraries.map((library2) => library2.path));
    const result2 = {};
    for (const candidate of candidates) {
      const library2 = loader2.libraries.find((library3) => library3.path === candidate.path);
      const object4 = record3.objects?.[`sha1-${library2.spec.expected.digest}`];
      if (!object4 || object4.size !== library2.spec.expected.size) throw new ModInventoryError("SCAN_FAILED");
      const file = import_node_path24.default.join(dataDirectory, "store/objects/sha256", object4.digest.slice(0, 2), object4.digest);
      const scan = await this.scanner.read(file, signal);
      if (scan.sha256 !== object4.digest || scan.sha1 !== library2.spec.expected.digest || scan.size !== object4.size) throw new ModInventoryError("SCAN_FAILED");
      Object.assign(result2, candidate.versions);
    }
    return result2;
  }
  /** Reads Quilt's explicitly provided Fabric Loader version from its verified official JAR. */
  async readRuntime(dataDirectory, record3, signal) {
    const loader2 = record3.metadata?.loader;
    if (!loader2 || loader2.kind !== "quilt") return null;
    const expectedPath = `org/quiltmc/quilt-loader/${loader2.version}/quilt-loader-${loader2.version}.jar`;
    const matches = loader2.libraries.filter((library3) => library3.path === expectedPath);
    if (matches.length !== 1) return null;
    const library2 = matches[0];
    const object4 = record3.objects?.[`sha1-${library2.spec.expected.digest}`];
    if (!object4 || object4.size !== library2.spec.expected.size) return null;
    const file = import_node_path24.default.join(dataDirectory, "store/objects/sha256", object4.digest.slice(0, 2), object4.digest);
    const scan = await this.scanner.read(file, signal);
    if (scan.sha256 !== object4.digest || scan.sha1 !== library2.spec.expected.digest || scan.size !== object4.size) throw new ModInventoryError("SCAN_FAILED");
    const declarations = scan.archives.filter((archive) => archive.entries.length === 0).flatMap((archive) => archive.declarations).filter((declaration) => declaration.format === "quilt" && declaration.issues.length === 0);
    const mods = declarations.flatMap((declaration) => declaration.mods).filter((mod) => mod.id === "quilt_loader" && mod.version === loader2.version && mod.issues.length === 0);
    if (mods.length !== 1) return null;
    const provided = mods[0].provides.filter((item) => item.id === "fabricloader");
    return provided.length === 1 ? provided[0].version : null;
  }
};

// src/services/workers/mod-archive-reader.ts
var import_node_worker_threads7 = require("node:worker_threads");

// src/services/workers/mod-archive-protocol.ts
var import_node_path25 = __toESM(require("node:path"), 1);

// src/services/workers/mod-declarations-protocol.ts
var issues = (value) => Array.isArray(value) && value.length <= 2048 && value.every((item) => typeof item === "string" && /^[A-Z_]{1,64}$/.test(item));
var client = (value) => typeof value === "string" && ["yes", "no", "unknown"].includes(value);
var version2 = (value) => value === null || modText(value) && !value.includes("${");
var range = (value) => value === null || modRange(value) !== null;
function invalid9() {
  throw new Error("INVALID_MESSAGE");
}
function parseModDeclarationFacts(value) {
  if (!exactObject(value, ["format", "mods", "nested", "language", "issues"]) || typeof value.format !== "string" || !["fabric", "quilt", "forge", "neoforge"].includes(value.format) || !issues(value.issues) || !Array.isArray(value.mods) || value.mods.length > 256 || !Array.isArray(value.nested)) invalid9();
  const format = value.format;
  const pathIssues = [];
  if (modNested(value.nested, false, pathIssues).length !== value.nested.length || pathIssues.length) invalid9();
  if (value.language !== null && (!exactObject(value.language, ["id", "range"]) || !modText(value.language.id) || !range(value.language.range))) invalid9();
  for (const mod of value.mods) {
    if (!exactObject(mod, ["id", "version", "name", "client", "provides", "dependencies", "issues"]) || !modId(mod.id, format) || !version2(mod.version) || !modText(mod.name, 256) || !client(mod.client) || !issues(mod.issues) || !Array.isArray(mod.provides) || mod.provides.length > 128 || !Array.isArray(mod.dependencies) || mod.dependencies.length > 257) invalid9();
    for (const provide of mod.provides) if (!exactObject(provide, ["id", "version"]) || !modId(provide.id, format) || !version2(provide.version)) invalid9();
    for (const dependency of mod.dependencies) {
      if (!exactObject(dependency, ["id", "range", "kind", "client", "issues"]) || !modId(dependency.id, format) || !range(dependency.range) || typeof dependency.kind !== "string" || !["required", "optional", "incompatible", "discouraged"].includes(dependency.kind) || !client(dependency.client) || !issues(dependency.issues)) invalid9();
    }
  }
  return value;
}

// src/services/workers/mod-archive-protocol.ts
function invalid10() {
  throw new Error("INVALID_MESSAGE");
}
var digest2 = (value, length) => typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
function parseModArchiveRequest(value) {
  if (!exactObject(value, ["version", "kind", "file"]) || value.version !== 1 || value.kind !== "mod-archive" || typeof value.file !== "string" || !value.file.length || value.file.length > 32760 || !import_node_path25.default.isAbsolute(value.file)) invalid10();
  return value;
}
function parseModArchiveReply(value) {
  if (exactObject(value, ["version", "kind", "code"]) && value.version === 1 && value.kind === "mod-archive-failed" && typeof value.code === "string" && MOD_ARCHIVE_CODES.includes(value.code)) return value;
  if (!exactObject(value, ["version", "kind", "result"]) || value.version !== 1 || value.kind !== "mod-archive-result") invalid10();
  const result2 = value.result;
  if (!exactObject(result2, ["size", "sha1", "sha256", "sha512", "archives"]) || typeof result2.size !== "number" || !Number.isSafeInteger(result2.size) || result2.size < 1 || result2.size > 64 * 1024 ** 2 || !digest2(result2.sha1, 40) || !digest2(result2.sha256, 64) || !digest2(result2.sha512, 128) || !Array.isArray(result2.archives) || result2.archives.length < 1 || result2.archives.length > 64) invalid10();
  let total = 0;
  const seen = /* @__PURE__ */ new Set();
  for (const [index, archive] of result2.archives.entries()) {
    if (!exactObject(archive, ["entries", "sha256", "documents", "declarations"]) || !digest2(archive.sha256, 64) || !Array.isArray(archive.entries) || archive.entries.length > 4 || index === 0 !== (archive.entries.length === 0) || !Array.isArray(archive.documents) || archive.documents.length > MOD_DOCUMENTS.length || !Array.isArray(archive.declarations) || archive.declarations.length > 4) invalid10();
    for (const entry of archive.entries) {
      if (typeof entry !== "string" || entry.length > 4096 || !entry.endsWith(".jar")) invalid10();
      try {
        installRelativePath(entry);
      } catch {
        invalid10();
      }
    }
    const identity3 = JSON.stringify(archive.entries);
    if (seen.has(identity3)) invalid10();
    seen.add(identity3);
    if (index === 0 && archive.sha256 !== result2.sha256) invalid10();
    if (index > 0 && !seen.has(JSON.stringify(archive.entries.slice(0, -1)))) invalid10();
    const names = /* @__PURE__ */ new Set();
    for (const document of archive.documents) {
      if (!exactObject(document, ["name", "body"]) || typeof document.name !== "string" || !MOD_DOCUMENTS.includes(document.name) || names.has(document.name) || typeof document.body !== "string" || Buffer.byteLength(document.body) > 1024 ** 2) invalid10();
      names.add(document.name);
      total += Buffer.byteLength(document.body);
      if (total > 4 * 1024 ** 2) invalid10();
    }
    const formats = /* @__PURE__ */ new Set();
    for (const declaration of archive.declarations) {
      const facts = parseModDeclarationFacts(declaration);
      const name2 = { fabric: "fabric.mod.json", quilt: "quilt.mod.json", forge: "META-INF/mods.toml", neoforge: "META-INF/neoforge.mods.toml" }[facts.format];
      if (formats.has(facts.format) || !names.has(name2)) invalid10();
      formats.add(facts.format);
    }
    if (formats.size !== [...names].filter((name2) => name2.endsWith("mods.toml") || name2.endsWith("mod.json")).length) invalid10();
  }
  try {
    if (Buffer.byteLength(JSON.stringify(result2)) > 8 * 1024 ** 2) invalid10();
  } catch {
    invalid10();
  }
  return value;
}

// src/services/workers/mod-archive-reader.ts
var ModArchiveReader = class {
  constructor(entry, timeoutMs = 3e4) {
    this.entry = entry;
    this.timeoutMs = timeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3e4) throw new ModArchiveError("WORKER_FAILED");
  }
  entry;
  timeoutMs;
  active = false;
  /** Joins worker exit on success, cancellation, timeout and malformed replies. */
  async read(file, signal) {
    let request;
    try {
      request = parseModArchiveRequest({ version: 1, kind: "mod-archive", file });
    } catch {
      throw new ModArchiveError("UNSAFE_ARCHIVE");
    }
    if (signal?.aborted) throw new ModArchiveError("CANCELLED");
    if (this.active) throw new ModArchiveError("QUEUE_FULL");
    this.active = true;
    try {
      const worker = new import_node_worker_threads7.Worker(this.entry, { workerData: request, resourceLimits: { maxOldGenerationSizeMb: 128 } });
      return await new Promise((resolve, reject) => {
        let result2;
        let failure3;
        const stop = (code3) => {
          failure3 ??= new ModArchiveError(code3);
          void worker.terminate().catch(() => {
          });
        };
        const abort = () => stop("CANCELLED");
        const timer = setTimeout(() => stop("SCAN_TIMEOUT"), this.timeoutMs);
        worker.on("message", (value) => {
          if (result2 || failure3) {
            stop("WORKER_FAILED");
            return;
          }
          try {
            const reply = parseModArchiveReply(value);
            if (reply.kind === "mod-archive-failed") failure3 = new ModArchiveError(reply.code);
            else result2 = reply.result;
          } catch {
            stop("WORKER_FAILED");
          }
        });
        worker.once("error", () => {
          failure3 ??= new ModArchiveError("WORKER_FAILED");
        });
        worker.once("exit", (code3) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          if (failure3) reject(failure3);
          else if (code3 !== 0 || !result2) reject(new ModArchiveError("WORKER_FAILED"));
          else resolve(result2);
        });
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
    } catch (error) {
      throw error instanceof ModArchiveError ? error : new ModArchiveError("WORKER_FAILED");
    } finally {
      this.active = false;
    }
  }
};

// src/services/install/installer.ts
var InstallerError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "InstallerError";
    this.category = code3 === "CANCELLED" ? "cancelled" : code3 === "NEEDS_RECOVERY" || code3 === "ROOT_UNAVAILABLE" ? "disk" : code3 === "INSTALL_FAILED" ? "system" : "biz";
  }
  code;
  category;
};
function canonicalLoaderInput(input) {
  return {
    rootId: input.rootId.toLowerCase(),
    mcVersionId: input.mcVersionId,
    displayName: input.displayName,
    isolation: input.isolation,
    loader: { ...input.loader }
  };
}
function isInstallerMetadata(value) {
  return "loader" in value && (value.loader.kind === "forge" || value.loader.kind === "neoforge");
}
function installIdentity(namespace, name2) {
  if (!UUID_PATTERN.test(namespace)) throw new InstallerError("NEEDS_RECOVERY");
  const hash2 = (0, import_node_crypto19.createHash)("sha1").update(Buffer.from(namespace.replaceAll("-", ""), "hex")).update(name2).digest();
  hash2[6] = hash2[6] & 15 | 80;
  hash2[8] = hash2[8] & 63 | 128;
  const hex3 = hash2.subarray(0, 16).toString("hex");
  return `${hex3.slice(0, 8)}-${hex3.slice(8, 12)}-${hex3.slice(12, 16)}-${hex3.slice(16, 20)}-${hex3.slice(20)}`;
}
function restoreInstallMetadata(record3) {
  const stored = record3.metadata;
  if (!stored) throw new InstallerError("NEEDS_RECOVERY");
  const documents = Object.fromEntries(Object.entries(stored.versionDocuments).map(([id2, body]) => [id2, JSON.parse(body)]));
  const version3 = resolveClientVersion(record3.summary.mcVersionId, documents, stored.environment ?? { os: "windows", arch: "x64", osVersion: "10.0", features: {} });
  const assets = parseAssetIndex(JSON.parse(stored.assetIndexBody));
  const projection2 = (result2) => {
    const index = result2.version.assetIndex;
    if (!index) throw new InstallerError("NEEDS_RECOVERY");
    const artifactId = `sha1-${index.sha1.toLowerCase()}`;
    const legacy = `indexes/${index.id}.json`;
    const aliased = `indexes/${assetIndexAlias(result2.version)}.json`;
    const candidates = (record3.receipts ?? []).filter((item) => item.area === "assets" && item.artifactId === artifactId && (item.path === legacy || item.path === aliased));
    if (candidates.length > 1 || record3.phase === "ready" && candidates.length !== 1) throw new InstallerError("NEEDS_RECOVERY");
    return candidates[0]?.path === aliased ? { ...result2, plan: aliasAssetViews(result2.plan, result2.version) } : result2;
  };
  if (!stored.loader) return projection2({ version: version3, assets, plan: planVanillaInstall(version3, stored.metadataSha1ByVersion, assets), ...stored });
  const environment2 = stored.environment;
  if (!environment2) throw new InstallerError("NEEDS_RECOVERY");
  try {
    if (stored.loader.kind === "forge" || stored.loader.kind === "neoforge") {
      const profile2 = parseStoredInstallerProfile(
        stored.loader.kind,
        record3.summary.mcVersionId,
        stored.loader.version,
        stored.loader.profileBody,
        stored.loader.profileSha256,
        stored.loader.versionBody,
        stored.loader.versionSha256
      );
      const composed2 = composeInstallerInstall({
        baseVersionDocuments: stored.versionDocuments,
        baseMetadataSha1ByVersion: stored.metadataSha1ByVersion,
        assets,
        profile: profile2,
        profileSha256: stored.loader.profileSha256,
        environment: environment2
      });
      return projection2({ version: composed2.version, assets, plan: composed2.plan, ...stored });
    }
    const profile = parseStoredLoaderProfile(stored.loader.kind, record3.summary.mcVersionId, stored.loader.version, stored.loader.profileBody, stored.loader.profileSha256);
    const libraries = { libraries: stored.loader.libraries, totalBytes: stored.loader.libraries.reduce((sum, item) => sum + item.spec.expected.size, 0) };
    const composed = composeLoaderInstall({
      baseVersionDocuments: stored.versionDocuments,
      baseMetadataSha1ByVersion: stored.metadataSha1ByVersion,
      assets,
      profile,
      profileSha256: stored.loader.profileSha256,
      libraries,
      environment: environment2
    });
    return projection2({ version: composed.version, assets, plan: composed.plan, ...stored });
  } catch {
    throw new InstallerError("NEEDS_RECOVERY");
  }
}
var InstallerService = class {
  constructor(storage, entry, metadata2, loaderMetadata2, installerPreparation, processorJava, downloadPreferences = () => DEFAULT_DOWNLOAD_PREFERENCES, request = fetch) {
    this.storage = storage;
    this.entry = entry;
    this.metadata = metadata2;
    this.loaderMetadata = loaderMetadata2;
    this.installerPreparation = installerPreparation;
    this.processorJava = processorJava;
    this.downloadPreferences = downloadPreferences;
    this.request = request;
  }
  storage;
  entry;
  metadata;
  loaderMetadata;
  installerPreparation;
  processorJava;
  downloadPreferences;
  request;
  runtime;
  live = /* @__PURE__ */ new Map();
  admissions = /* @__PURE__ */ new Map();
  admissionTail = Promise.resolve();
  indexTail = Promise.resolve();
  fileTail = Promise.resolve();
  closed = false;
  closing;
  requestBudget = new RequestBudget();
  inspectingLaunchMods = false;
  /** Publishes an immutable, content-addressed official JVM only after all files verify. Never overwrites an existing runtime. */
  async prepareJava(pack, consumerId, signal) {
    const runtime = await this.resources();
    const parent = await ensureChildDirectory(runtime.dataDirectory, "runtimes", "java");
    const destination = import_node_path26.default.join(parent, pack.digest);
    let exists2 = false;
    try {
      await guardDirectory(destination);
      exists2 = true;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    if (exists2) {
      for (const file of pack.files) {
        if (signal.aborted) throw new InstallerError("CANCELLED");
        const target = import_node_path26.default.join(destination, file.relative);
        await guardDirectory(import_node_path26.default.dirname(target));
        const stat = await (0, import_promises17.lstat)(target);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new InstallerError("NEEDS_RECOVERY");
        const hash2 = await runtime.hashes.hash(target, { maximumBytes: file.spec.expected.size, signal });
        if (hash2.size !== file.spec.expected.size || hash2.sha1 !== file.spec.expected.digest) throw new InstallerError("NEEDS_RECOVERY");
      }
    } else {
      const staging = await (0, import_promises17.mkdtemp)(import_node_path26.default.join(parent, ".preparing-"));
      for (const file of pack.files) {
        if (signal.aborted) throw new InstallerError("CANCELLED");
        const object4 = await runtime.coordinator.request(file.spec, { consumerId, signal }).result;
        await runtime.views.materialize(staging, file.relative, file.spec, object4, { mode: "copy", signal });
      }
      if (signal.aborted) throw new InstallerError("CANCELLED");
      await guardDirectory(parent);
      await (0, import_promises17.rename)(staging, destination);
    }
    return import_node_path26.default.join(destination, "bin/java.exe");
  }
  /** Shares the single object-store owner and bounded coordinator with resource downloads. */
  async transferResource(spec, taskId, options) {
    const runtime = await this.resources();
    return runtime.coordinator.request(spec, { consumerId: taskId, ...options }).result;
  }
  /** Publishes a verified resource into its fixed task namespace; no instance files are touched. */
  async materializeResource(record3, object4) {
    const runtime = await this.resources();
    const library2 = await ensureChildDirectory(runtime.dataDirectory, "resource-library");
    await runtime.views.materialize(library2, `${record3.kind}/${record3.taskId}/${record3.filename}`, record3.spec, object4, { mode: "prefer-link" });
  }
  async resources() {
    if (this.closed) throw new InstallerError("INSTALL_FAILED");
    if (!this.runtime) {
      let retrySafe = true;
      const pending = (async () => {
        const registration = await this.storage.readInstallation();
        if (!registration) throw new InstallerError("ROOT_UNAVAILABLE");
        const { rootId, dataDirectory } = registration.data;
        const store = await ensureChildDirectory(dataDirectory, "store");
        const hashes = new HashPool(this.entry);
        const extractor = new NativeExtractor(this.entry);
        const installerExtractor = new InstallerArchiveExtractor(this.entry);
        let objects2;
        let coordinator;
        try {
          objects2 = await ObjectStore.open(store, this.storage, hashes);
          const concurrency = () => this.downloadPreferences().fileConcurrency;
          coordinator = new DownloadCoordinator(new ArtifactTransfer(new SourceTransfer(this.downloadPreferences, this.request, this.requestBudget), this.storage, objects2), objects2, concurrency);
          return { rootId, dataDirectory, hashes, extractor, installerExtractor, objects: objects2, coordinator, downloads: new InstallDownloadService(coordinator, objects2, concurrency), views: new FileViewService(store, objects2, hashes) };
        } catch (error) {
          const results = await Promise.allSettled([...coordinator ? [coordinator.close()] : [], extractor.close(), installerExtractor.close()]);
          if (objects2) results.push(...await Promise.allSettled([objects2.close()]));
          results.push(...await Promise.allSettled([hashes.close()]));
          if (results.some((result2) => result2.status === "rejected")) {
            retrySafe = false;
            throw new InstallerError("NEEDS_RECOVERY");
          }
          throw error;
        }
      })();
      this.runtime = pending;
      void pending.catch(() => {
        if (retrySafe && this.runtime === pending) delete this.runtime;
      });
    }
    return this.runtime;
  }
  index(summary) {
    const update = this.indexTail.then(async () => {
      const stored = await this.storage.readInstances();
      const items = stored?.data.items ?? [];
      const others = items.filter((item) => item.instanceId !== summary.instanceId);
      await this.storage.writeInstances(stored?.revision ?? 0, { items: [...others, summary] });
    });
    this.indexTail = update.catch(() => {
    });
    return update;
  }
  async save(record3, phase, patch = {}) {
    const state2 = ["reserved", "prepared", "downloaded", "materializing"].includes(phase) ? "installing" : phase;
    const next = { ...record3, ...patch, phase, summary: { ...record3.summary, state: state2, revision: record3.summary.revision + 1 } };
    const result2 = await this.storage.writeInstance(record3.summary.instanceId, record3.summary.revision, next);
    await this.index(result2.data.summary);
    return result2.data;
  }
  /** Reuses the existing object owner and serialized file lane to verify a ready instance before launch. */
  async prepareLaunch(instanceId, expectedRevision, signal) {
    if (this.closed) throw new InstallerError("INSTALL_FAILED");
    const operation = this.fileTail.then(async () => {
      if (signal.aborted) throw new InstallerError("CANCELLED");
      const runtime = await this.resources();
      const record3 = await this.storage.readInstance(instanceId);
      if (!record3 || record3.data.summary.rootId !== runtime.rootId || record3.data.phase !== "ready") throw new InstallerError("INSTANCE_NOT_FOUND");
      if (record3.revision !== expectedRevision) throw new InstallerError("NEEDS_RECOVERY");
      const loader2 = record3.data.metadata?.loader;
      if (loader2?.kind === "forge" || loader2?.kind === "neoforge") {
        if (!this.installerPreparation) throw new InstallerError("NEEDS_RECOVERY");
        await this.installerPreparation.reopen(loader2, { ...runtime, extractor: runtime.installerExtractor }, signal);
      }
      const transaction = record3.data.modCommitId ? await this.storage.readModTransaction(record3.data.modCommitId) : void 0;
      return verifyLaunchInputs(runtime, record3, restoreInstallMetadata(record3.data), signal, transaction?.data);
    });
    this.fileTail = operation.then(() => {
    }, () => {
    });
    return operation;
  }
  /** Read-only final verification; caller holds the existing gameDir lease. No fileTail or repair is entered. */
  async verifyPreparedLaunch(instanceId, expectedRevision, nativeFiles, signal) {
    if (this.closed) throw new InstallerError("INSTALL_FAILED");
    const runtime = await this.resources();
    const record3 = await this.storage.readInstance(instanceId);
    if (!record3 || record3.data.phase !== "ready" || record3.data.summary.rootId !== runtime.rootId || record3.revision !== expectedRevision) throw new InstallerError("NEEDS_RECOVERY");
    const transaction = record3.data.modCommitId ? await this.storage.readModTransaction(record3.data.modCommitId) : void 0;
    return verifyLaunchInputs(runtime, record3, restoreInstallMetadata(record3.data), signal, transaction?.data, nativeFiles);
  }
  /** Binds the local active inventory check to this launch's actual Java version; never selects a second JVM. */
  async inspectLaunchMods(instanceId, expectedRevision, javaVersion, signal) {
    if (this.closed || this.inspectingLaunchMods) throw new InstallerError("INSTALL_FAILED");
    this.inspectingLaunchMods = true;
    try {
      const scanner = new ModArchiveReader(this.entry);
      const context = modInventoryContext(this.storage, new InstalledLanguageReader(scanner), { read: async () => javaVersion });
      return await new ModInventoryService(context, scanner).scan(instanceId, expectedRevision, signal);
    } finally {
      this.inspectingLaunchMods = false;
    }
  }
  /** Persists idempotent acceptance and reserved identity before admitting background network/filesystem work. */
  create(requestId, input) {
    const canonical = { rootId: input.rootId.toLowerCase(), mcVersionId: input.mcVersionId, displayName: input.displayName, isolation: input.isolation };
    return this.enqueue(requestId, canonical);
  }
  /** Admits fixed identities selected through the strict loader contract. */
  createLoader(requestId, input) {
    if (input.isolation !== "on") return Promise.reject(new InstallerError("INSTALL_FAILED"));
    const canonical = canonicalLoaderInput(input);
    return this.enqueue(requestId, canonical);
  }
  /** Read-only receipt recovery precedes remote catalog access; a request with different input is never reused. */
  async findAcceptedLoader(requestId, input) {
    if (this.closed || input.isolation !== "on") throw new InstallerError("INSTALL_FAILED");
    const canonical = canonicalLoaderInput(input);
    const registered = await this.storage.readInstallation();
    if (!registered || registered.data.rootId !== canonical.rootId) throw new InstallerError("ROOT_UNAVAILABLE");
    const digest3 = (0, import_node_crypto19.createHash)("sha256").update(JSON.stringify(canonical)).digest("hex");
    const task = await this.storage.findAccepted(canonical.rootId, requestId.toLowerCase(), "install", digest3);
    return task ? { taskId: task.taskId } : void 0;
  }
  enqueue(requestId, canonical) {
    const key = `${canonical.rootId}:${requestId.toLowerCase()}:${JSON.stringify(canonical)}`;
    const pending = this.admissions.get(key);
    if (pending) return pending;
    const admitted = this.admissionTail.then(() => this.admit(requestId.toLowerCase(), canonical));
    this.admissionTail = admitted.then(() => {
    }, () => {
    });
    this.admissions.set(key, admitted);
    void admitted.finally(() => {
      this.admissions.delete(key);
    }).catch(() => {
    });
    return admitted;
  }
  async admit(requestId, input) {
    if (this.closed) throw new InstallerError("INSTALL_FAILED");
    const runtime = await this.resources();
    if (runtime.rootId !== input.rootId) throw new InstallerError("ROOT_UNAVAILABLE");
    const defaultIsolation = (await this.storage.readSettings())?.data.isolationDefault ?? true;
    const seed = parseInstanceSummary({
      rootId: input.rootId,
      mcVersionId: input.mcVersionId,
      displayName: input.displayName,
      isolation: input.isolation === "inherit" ? defaultIsolation ? "on" : "off" : input.isolation,
      instanceId: input.rootId,
      taskId: input.rootId,
      state: "installing",
      revision: 1
    });
    const digest3 = (0, import_node_crypto19.createHash)("sha256").update(JSON.stringify(input)).digest("hex");
    const task = await this.storage.accept(input.rootId, requestId, "install", digest3);
    if (this.live.has(task.taskId)) return { taskId: task.taskId };
    const instanceId = installIdentity(task.taskId, "instance");
    const old = await this.storage.readInstance(instanceId);
    if (old) {
      const summary = old.data.summary;
      if (summary.rootId !== input.rootId || summary.taskId !== task.taskId || summary.mcVersionId !== input.mcVersionId || summary.displayName !== input.displayName || input.isolation !== "inherit" && summary.isolation !== input.isolation || input.loader === void 0 !== (old.data.loader?.kind === "vanilla") || input.loader !== void 0 && (old.data.loader?.kind !== input.loader.kind || old.data.loader.version !== input.loader.version)) throw new InstallerError("NEEDS_RECOVERY");
      await this.index(summary);
      return { taskId: task.taskId };
    }
    const index = await this.storage.readInstances();
    if (index?.data.items.some((item) => item.rootId === input.rootId && !["failed", "cancelled"].includes(item.state) && item.displayName.toLowerCase() === input.displayName.toLowerCase())) {
      if (task.execution.state === "queued") {
        let rejected = await this.storage.update(task.ownerId, task.taskId, task.execution.revision, controlTask(task.execution, "start").execution);
        rejected = await this.storage.update(task.ownerId, task.taskId, rejected.execution.revision, applyWorkerEvent(rejected.execution, { kind: "failed", attempt: rejected.execution.attempt, sequence: 1 }).execution);
        await this.storage.update(task.ownerId, task.taskId, rejected.execution.revision, applyWorkerEvent(rejected.execution, { kind: "cleaned", attempt: rejected.execution.attempt, sequence: 2 }).execution);
      }
      throw new InstallerError("NAME_CONFLICT");
    }
    const record3 = { formatVersion: 2, loader: input.loader ?? { kind: "vanilla" }, summary: { ...seed, instanceId, taskId: task.taskId }, phase: "reserved" };
    await this.storage.writeInstance(instanceId, 0, record3);
    await this.index(record3.summary);
    const live = { task, stage: "metadata", controller: new AbortController(), done: Promise.resolve(), changes: Promise.resolve() };
    this.live.set(task.taskId, live);
    live.done = this.perform(record3, live, runtime).finally(() => {
      this.live.delete(task.taskId);
    });
    void live.done.catch(() => {
    });
    return { taskId: task.taskId };
  }
  change(live, transform) {
    const changed = live.changes.then(async () => {
      const next = transform(live.task.execution);
      if (next.revision === live.task.execution.revision) return;
      try {
        live.task = await this.storage.update(live.task.ownerId, live.task.taskId, live.task.execution.revision, next);
      } catch (error) {
        live.failure = error;
        live.controller.abort();
        throw error;
      }
    });
    live.changes = changed.catch(() => {
    });
    return changed;
  }
  event(live, event) {
    return this.change(live, (current) => applyWorkerEvent(current, { ...event, attempt: current.attempt, sequence: current.lastSequence + 1 }).execution);
  }
  /** Reconciles summary mirrors conservatively after repository recovery; it never steals a stale store owner. */
  async initialize() {
    const stored = await this.storage.readInstances();
    for (const summary of stored?.data.items ?? []) {
      const record3 = (await this.storage.readInstance(summary.instanceId))?.data;
      if (!record3 || record3.summary.rootId !== summary.rootId || record3.summary.taskId !== summary.taskId) throw new InstallerError("NEEDS_RECOVERY");
      const task = await this.storage.get(summary.rootId, summary.taskId);
      if (record3.phase === "ready" && task?.execution.state === "completed") await this.index(record3.summary);
      else if (record3.summary.state === "installing" || task?.execution.state === "needsRecovery") await this.save(record3, "needsRecovery");
      else await this.index(record3.summary);
    }
  }
  /** Lists persisted summaries; unfinished installs never become ready merely because download bytes exist. */
  async list(rootId) {
    return (await this.storage.readInstances())?.data.items.filter((item) => item.rootId === rootId) ?? [];
  }
  /** Projects loader identity only after checking each authoritative private record. */
  async listV2(rootId) {
    const result2 = [];
    for (const summary of await this.list(rootId)) {
      const record3 = await this.storage.readInstance(summary.instanceId);
      if (!record3 || record3.data.summary.rootId !== rootId || !record3.data.loader || summary.isolation === "inherit") throw new InstallerError("NEEDS_RECOVERY");
      result2.push({
        instanceId: summary.instanceId,
        displayName: summary.displayName,
        minecraftVersion: summary.mcVersionId,
        loader: record3.data.loader,
        isolation: summary.isolation,
        state: summary.state,
        revision: summary.revision
      });
    }
    return result2;
  }
  /** Returns the current task plus a redacted phase; this API contains no paths or raw upstream documents. */
  async task(rootId, taskId) {
    const task = this.live.get(taskId)?.task ?? await this.storage.get(rootId, taskId);
    if (!task || task.ownerId !== rootId || task.kind !== "install") throw new InstallerError("INSTANCE_NOT_FOUND");
    const instance = (await this.list(rootId)).find((item) => item.taskId === taskId);
    return { task, stage: this.live.get(taskId)?.stage ?? (task.execution.state === "completed" ? "completed" : instance?.state ?? task.execution.state), ...instance ? { instance } : {} };
  }
  /** Cancellation is durably requested before aborting owned consumers; commit cannot be undone. */
  async cancel(rootId, taskId) {
    const live = this.live.get(taskId);
    if (!live) {
      if ((await this.storage.get(rootId, taskId))?.execution.state === "completed") throw new InstallerError("CANCEL_TOO_LATE");
      throw new InstallerError("INVALID_TASK_STATE");
    }
    if (live.task.ownerId !== rootId) throw new InstallerError("INVALID_TASK_STATE");
    await this.change(live, (current) => {
      const transition = controlTask(current, "cancel");
      if (transition.rejected) throw new InstallerError(transition.rejected === "CANCEL_TOO_LATE" ? "CANCEL_TOO_LATE" : "INVALID_TASK_STATE");
      return transition.execution;
    });
    live.controller.abort();
  }
  async perform(initial, live, runtime) {
    let record3 = initial;
    const check2 = () => {
      if (live.failure) throw live.failure;
      if (live.controller.signal.aborted) throw new InstallerError("CANCELLED");
    };
    try {
      await this.change(live, (current) => controlTask(current, "start").execution);
      check2();
      const environment2 = { os: "windows", arch: "x64", osVersion: (0, import_node_os.release)(), features: {} };
      let prepared;
      let processorWorkspace;
      if (!record3.loader || record3.loader.kind === "vanilla") prepared = await this.metadata.prepare(record3.summary.mcVersionId, environment2);
      else if (record3.loader.kind === "forge" || record3.loader.kind === "neoforge") {
        if (!this.installerPreparation || !this.processorJava) throw new InstallerError("INSTALL_FAILED");
        live.stage = "installer";
        const result2 = await this.installerPreparation.prepare(
          record3.loader.kind,
          record3.summary.mcVersionId,
          record3.loader.version,
          environment2,
          installIdentity(record3.summary.instanceId, "loader-installer"),
          { ...runtime, extractor: runtime.installerExtractor },
          live.controller.signal
        );
        prepared = result2.metadata;
        processorWorkspace = result2.workspace;
      } else {
        if (record3.loader.kind !== "fabric" && record3.loader.kind !== "quilt" || !this.loaderMetadata) throw new InstallerError("INSTALL_FAILED");
        prepared = await this.loaderMetadata.prepare(record3.loader.kind, record3.summary.mcVersionId, record3.loader.version, environment2, live.controller.signal);
      }
      prepared = { ...prepared, plan: aliasAssetViews(prepared.plan, prepared.version) };
      check2();
      const loader2 = isInstallerMetadata(prepared) ? { loader: prepared.loader } : "loader" in prepared ? { loader: {
        kind: prepared.loader.kind,
        version: prepared.loader.version,
        profileBody: prepared.loader.profileBody,
        profileSourceUrl: prepared.loader.profileEvidence.sourceUrl,
        profileSha256: prepared.loader.profileEvidence.sha256,
        libraries: prepared.loader.libraries.libraries
      } } : {};
      record3 = await this.save(record3, "prepared", { metadata: {
        versionDocuments: prepared.versionDocuments,
        metadataSha1ByVersion: prepared.metadataSha1ByVersion,
        assetIndexBody: prepared.assetIndexBody,
        environment: environment2,
        ...loader2
      } });
      live.stage = "downloading";
      let lastProgress = 0;
      const downloaded = await runtime.downloads.run(prepared, {
        signal: live.controller.signal,
        consumerId: (id2) => installIdentity(record3.summary.instanceId, id2),
        onProgress: (value) => {
          live.progress = value;
          if (!live.progressWrite && Date.now() - lastProgress >= 100) {
            lastProgress = Date.now();
            live.progressWrite = this.event(live, { kind: "progress", bytesDone: value.verifiedBytes, bytesTotal: value.totalBytes }).finally(() => {
              delete live.progressWrite;
            });
            void live.progressWrite.catch(() => {
            });
          }
        }
      });
      await live.progressWrite;
      check2();
      record3 = await this.save(record3, "downloaded", { objects: Object.fromEntries(downloaded.objects) });
      if (isInstallerMetadata(prepared)) {
        if (!processorWorkspace || !this.processorJava) throw new InstallerError("INSTALL_FAILED");
        live.stage = "processors";
        const executable = await this.processorJava(
          prepared.loader.kind === "forge" ? 17 : 21,
          installIdentity(record3.summary.instanceId, "processor-java"),
          live.controller.signal
        );
        check2();
        const processors = await processInstallerWorkspace(
          prepared,
          downloaded,
          processorWorkspace,
          executable,
          installIdentity(record3.summary.instanceId, "mojang-mappings"),
          this.entry,
          runtime,
          live.controller.signal
        );
        check2();
        const metadata2 = record3.metadata;
        record3 = await this.save(record3, "downloaded", { metadata: { ...metadata2, loader: { ...prepared.loader, processors } } });
      }
      await this.event(live, { kind: "progress", bytesDone: prepared.plan.totalBytes, bytesTotal: prepared.plan.totalBytes });
      await this.event(live, { kind: "transferred" });
      live.stage = "materializing";
      const work = this.fileTail.then(async () => {
        check2();
        const directories = await prepareInstanceDirectories(runtime.dataDirectory, record3.summary, prepared);
        const inherited = /* @__PURE__ */ new Map();
        for (const item of await this.list(record3.summary.rootId)) {
          if (item.instanceId === record3.summary.instanceId) continue;
          const previous = (await this.storage.readInstance(item.instanceId))?.data;
          for (const receipt of previous?.receipts ?? []) {
            if (receipt.area === "version" && receipt.path === "client.jar" && previous?.phase === "ready") {
              const previousLayout = instanceGameLayout(runtime.dataDirectory, previous.summary, restoreInstallMetadata(previous));
              if (import_node_path26.default.resolve(previousLayout.jar).toLowerCase() !== import_node_path26.default.resolve(directories.layout.jar).toLowerCase()) continue;
            } else if (receipt.area !== "assets" && receipt.area !== "libraries") continue;
            const object4 = previous?.objects?.[receipt.artifactId];
            if (object4) inherited.set(`${receipt.area}:${receipt.path.toLowerCase()}`, { digest: object4.digest, mode: receipt.mode });
          }
        }
        for (const view of prepared.plan.views) {
          check2();
          const target = viewTarget(directories, view);
          const object4 = downloaded.objects.get(view.artifactId);
          try {
            await (0, import_promises17.lstat)(import_node_path26.default.join(target.directory, target.relative));
            if (inherited.get(`${view.area}:${view.path.toLowerCase()}`)?.digest !== object4.digest) throw new InstallerError("NEEDS_RECOVERY");
          } catch (error) {
            if (!hasCode(error, "ENOENT")) throw error;
          }
        }
        record3 = await this.save(record3, "materializing", { receipts: [] });
        for (const view of prepared.plan.views) {
          check2();
          const artifact = prepared.plan.artifacts.find((item) => item.artifactId === view.artifactId);
          const object4 = downloaded.objects.get(view.artifactId);
          const target = viewTarget(directories, view);
          const previous = inherited.get(`${view.area}:${view.path.toLowerCase()}`);
          const receipt = await runtime.views.materialize(target.directory, target.relative, artifactSpec(artifact), object4, {
            mode: "prefer-link",
            signal: live.controller.signal,
            ...previous ? { existing: { relativePath: target.relative, objectDigest: previous.digest, size: object4.size, mode: previous.mode } } : {}
          });
          record3.receipts.push({ ...view, mode: receipt.mode });
          if (record3.receipts.length % 64 === 0) record3 = await this.save(record3, "materializing");
        }
        record3 = await this.save(record3, "materializing");
        check2();
        const processorEvidence = record3.metadata?.loader;
        if (processorEvidence?.kind === "forge" || processorEvidence?.kind === "neoforge") {
          if (!processorWorkspace || !processorEvidence.processors) throw new InstallerError("NEEDS_RECOVERY");
          await publishProcessorOutputs(processorWorkspace, directories.libraries, processorEvidence.processors, runtime.hashes, live.controller.signal);
          check2();
        }
        const archives = prepared.plan.natives.map((native) => {
          const object4 = downloaded.objects.get(native.artifactId);
          return { file: import_node_path26.default.join(runtime.dataDirectory, "store", "objects", "sha256", object4.digest.slice(0, 2), object4.digest), sha256: object4.digest, size: object4.size, exclude: native.exclude };
        });
        await prepareInstanceNatives(directories.layout.versionDirectory, archives, runtime.extractor, runtime.hashes, live.controller.signal);
        check2();
        const version3 = prepared.version;
        await writeDerivedJson(directories.layout.versionJson, {
          id: record3.summary.instanceId,
          mainClass: version3.mainClass,
          type: version3.type,
          javaVersion: { majorVersion: version3.javaMajor },
          assetIndex: version3.assetIndex,
          arguments: { game: version3.gameArguments, jvm: version3.jvmArguments },
          libraries: version3.libraries.map((library2) => ({ name: library2.name, downloads: library2.artifact ? { artifact: library2.artifact } : {} }))
        });
        if (version3.jarVersionId !== version3.id) {
          const dependencyId2 = import_node_path26.default.basename(import_node_path26.default.dirname(directories.layout.jar));
          await writeDerivedJson(import_node_path26.default.join(import_node_path26.default.dirname(directories.layout.jar), `${dependencyId2}.json`), {
            schemaVersion: 1,
            revision: 1,
            data: {
              versionRecordId: dependencyId2,
              mcVersionId: version3.jarVersionId,
              metadataSha1: prepared.metadataSha1ByVersion[version3.jarVersionId],
              document: JSON.parse(prepared.versionDocuments[version3.jarVersionId])
            }
          });
        }
        await this.event(live, { kind: "verified" });
        live.stage = "committing";
        const ready = { ...record3, phase: "ready", summary: { ...record3.summary, state: "ready", revision: record3.summary.revision + 1 } };
        await writeDerivedJson(directories.layout.instanceJson, { schemaVersion: 1, revision: ready.summary.revision, data: ready });
        record3 = await this.save(record3, "ready");
        await this.event(live, { kind: "committed" });
        live.stage = "completed";
      });
      this.fileTail = work.catch(() => {
      });
      await work;
    } catch (error) {
      const diagnosticCodes = [
        "CANCELLED",
        "NEEDS_RECOVERY",
        "INVALID_METADATA",
        "UNTRUSTED_MANIFEST",
        "CATALOG_UNAVAILABLE",
        "NETWORK_FAILED",
        "BAD_RESPONSE",
        "HASH_MISMATCH",
        "INVALID_ARCHIVE",
        "UNSAFE_ARCHIVE",
        "ARCHIVE_LIMIT",
        "ARCHIVE_IO",
        "JAVA_INCOMPATIBLE",
        "PROCESSOR_FAILED",
        "PROCESSOR_TIMEOUT",
        "OUTPUT_LIMIT",
        "OUTPUT_INVALID",
        "INVALID_PROCESSOR_PLAN",
        "INVALID_PROCESSOR_INPUT",
        "INVALID_INSTALLER_METADATA"
      ];
      const diagnostic = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && diagnosticCodes.includes(error.code) ? error.code : "INSTALL_FAILED";
      console.warn(JSON.stringify({ level: "warn", event: "instance-install-failed", stage: live.stage, code: diagnostic }));
      await live.progressWrite?.catch(() => {
      });
      await live.changes;
      const cancelled2 = !live.failure && hasCode(error, "CANCELLED");
      try {
        if (hasCode(error, "NEEDS_RECOVERY") || live.failure) {
          record3 = await this.save(record3, "needsRecovery");
          await this.change(live, (current) => controlTask(current, "interrupted").execution);
        } else if (live.task.execution.state === "committing") {
          record3 = await this.save(record3, "needsRecovery");
          await this.event(live, { kind: "failed" });
        } else {
          if (cancelled2) await this.change(live, (current) => controlTask(current, "cancel").execution);
          else await this.event(live, { kind: "failed" });
          record3 = await this.save(record3, cancelled2 ? "cancelled" : "failed");
          await this.event(live, { kind: "cleaned" });
        }
      } catch {
        live.stage = "needsRecovery";
        await this.change(live, (current) => controlTask(current, "interrupted").execution).catch(() => {
        });
        throw new InstallerError("NEEDS_RECOVERY");
      }
      if (record3.phase === "needsRecovery") {
        live.stage = "needsRecovery";
        throw new InstallerError("NEEDS_RECOVERY");
      }
      live.stage = cancelled2 ? "cancelled" : "failed";
      throw new InstallerError(cancelled2 ? "CANCELLED" : "INSTALL_FAILED");
    }
  }
  /** Cancels unfinished work, joins effects, then releases all object/hash/native owners before app shutdown. */
  close() {
    this.closing ??= this.finishClose();
    return this.closing;
  }
  async finishClose() {
    this.closed = true;
    await Promise.allSettled([...this.admissions.values()]);
    for (const live of this.live.values()) if (live.task.execution.state !== "committing") await this.cancel(live.task.ownerId, live.task.taskId).catch(() => {
    });
    await Promise.allSettled([...this.live.values()].map((live) => live.done));
    const runtime = await this.runtime?.catch(() => void 0);
    if (runtime) {
      const stopped = await Promise.allSettled([runtime.coordinator.close(), runtime.extractor.close(), runtime.installerExtractor.close()]);
      try {
        await runtime.objects.close();
      } finally {
        await runtime.hashes.close();
      }
      if (stopped.some((result2) => result2.status === "rejected")) throw new InstallerError("NEEDS_RECOVERY");
    }
  }
};

// src/ipc/installer-adapter.ts
var import_node_crypto20 = require("node:crypto");
var STAGES2 = ["metadata", "downloading", "materializing", "committing", "completed", "failed", "cancelled", "needsRecovery", "queued"];
var code2 = (error) => {
  if (error instanceof InstanceContractError) return error.code;
  if (error instanceof InstallerError) {
    if (error.code === "INSTANCE_NOT_FOUND") return "TASK_NOT_FOUND";
    if (error.code === "CANCELLED") return "INSTALL_FAILED";
    return error.code;
  }
  if (error instanceof WorkerError) {
    if (error.code === "TIMEOUT") return "TIMEOUT";
    if (["NEEDS_RECOVERY", "INVALID_RECORD", "UNSAFE_PATH"].includes(error.code)) return "NEEDS_RECOVERY";
    if (error.code === "STORE_BUSY") return "ROOT_UNAVAILABLE";
    return "TASK_STORE_UNAVAILABLE";
  }
  return "UNAVAILABLE";
};
function stage(value) {
  if (value.stage === "installer") return "metadata";
  if (value.stage === "processors") return "materializing";
  if (STAGES2.includes(value.stage)) return value.stage;
  switch (value.task.execution.state) {
    case "queued":
      return "queued";
    case "committing":
      return "committing";
    case "completed":
      return "completed";
    case "failed":
    case "failing":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "needsRecovery":
      return "needsRecovery";
    case "verifying":
      return "materializing";
    default:
      return "downloading";
  }
}
function taskSnapshot(value, root, taskId) {
  if (value.task.ownerId.toLowerCase() !== root) throw new InstanceContractError("TASK_NOT_OWNED");
  if (value.task.kind !== "install" || value.task.taskId.toLowerCase() !== taskId.toLowerCase()) throw new InstanceContractError("TASK_NOT_FOUND");
  const execution = value.task.execution;
  const result2 = {
    taskId,
    kind: "install",
    state: execution.state,
    stage: stage(value),
    revision: execution.revision,
    bytesDone: execution.bytesDone,
    ...execution.bytesTotal === void 0 ? {} : { bytesTotal: execution.bytesTotal }
  };
  if (execution.state === "failed" || execution.state === "failing" || execution.state === "needsRecovery") {
    const failure3 = instanceFailure((0, import_node_crypto20.randomUUID)(), execution.state === "needsRecovery" ? "NEEDS_RECOVERY" : "INSTALL_FAILED", (0, import_node_crypto20.randomUUID)());
    if (!failure3.ok) result2.error = failure3.error;
  }
  if (!isTaskSnapshot(result2)) throw new InstanceContractError("TASK_STORE_UNAVAILABLE");
  return result2;
}
function publicSummary(value) {
  const result2 = {
    instanceId: value.instanceId,
    displayName: value.displayName,
    mcVersionId: value.mcVersionId,
    isolation: value.isolation,
    state: value.state,
    revision: value.revision
  };
  if (!isInstanceSummary(result2)) throw new InstanceContractError("NEEDS_RECOVERY");
  return result2;
}
var InstallerAdapter = class {
  constructor(service, roots, additional) {
    this.service = service;
    this.roots = roots;
    this.additional = additional;
  }
  service;
  roots;
  additional;
  subscriptions = /* @__PURE__ */ new Map();
  tombstones = /* @__PURE__ */ new Map();
  cursors = /* @__PURE__ */ new Map();
  generations = /* @__PURE__ */ new Map();
  pending = /* @__PURE__ */ new Map();
  timer;
  polling = false;
  closed = false;
  async publicTask(root, taskId) {
    const extra = await this.additional?.get(root, taskId.toLowerCase());
    if (extra) {
      if (!isInstanceData(extra, "tasks:get") || extra.snapshot.taskId.toLowerCase() !== taskId.toLowerCase()) throw new InstanceContractError("TASK_STORE_UNAVAILABLE");
      return extra;
    }
    const value = await this.service.task(root, taskId.toLowerCase());
    const snapshot = taskSnapshot(value, root, taskId);
    const instance = value.instance;
    if (instance && (instance.rootId.toLowerCase() !== root || instance.taskId.toLowerCase() !== taskId.toLowerCase())) throw new InstanceContractError("TASK_NOT_OWNED");
    return { snapshot, ...snapshot.state === "completed" && instance ? { result: { instanceId: instance.instanceId } } : {} };
  }
  /** Binds event delivery to one validated webContents identity; sender removal invalidates in-flight admission. */
  dispatcher(senderId, send) {
    if (!Number.isSafeInteger(senderId) || senderId < 1) throw new InstanceContractError("INVALID_SENDER");
    const generation = this.generations.get(senderId) ?? /* @__PURE__ */ Symbol();
    this.generations.set(senderId, generation);
    return async (channel, payload, requestId) => {
      try {
        this.available(senderId, generation);
        if (!UUID_PATTERN.test(requestId) || !isInstancePayload(payload, channel)) throw new InstanceContractError("INVALID_ARGUMENT");
        return await this.dispatch(senderId, generation, send, channel, payload, requestId);
      } catch (error) {
        throw new InstanceContractError(code2(error));
      }
    };
  }
  available(sender, generation) {
    if (this.closed) throw new InstanceContractError("UNAVAILABLE");
    if (this.generations.get(sender) !== generation) throw new InstanceContractError("INVALID_SENDER");
  }
  async root() {
    const installation = await this.roots.readInstallation();
    const id2 = installation?.data.rootId;
    if (!id2 || !UUID_PATTERN.test(id2)) throw new InstanceContractError("ROOT_UNAVAILABLE");
    return id2.toLowerCase();
  }
  page(sender, root, channel, filter2, query2, items) {
    for (const [id2, cursor2] of this.cursors) if (cursor2.expires <= Date.now()) this.cursors.delete(id2);
    let offset = 0;
    let all = items;
    if (query2.cursor) {
      const saved = this.cursors.get(query2.cursor);
      if (!saved || saved.channel !== channel || saved.filter !== filter2 || saved.root !== root) throw new InstanceContractError("CURSOR_EXPIRED");
      if (saved.sender !== sender) throw new InstanceContractError("OUT_OF_SCOPE");
      offset = saved.offset;
      all = saved.items;
    }
    const selected = all.slice(offset, offset + query2.limit);
    offset += selected.length;
    if (offset >= all.length) return { items: selected };
    while (this.cursors.size >= 256) this.cursors.delete(this.cursors.keys().next().value);
    const nextCursor = (0, import_node_crypto20.randomUUID)();
    this.cursors.set(nextCursor, { sender, root, channel, filter: filter2, items: all, offset, expires: Date.now() + 3e4 });
    return { items: selected, nextCursor };
  }
  async dispatch(sender, generation, send, channel, payload, requestId) {
    if (channel === "events:unsubscribe" && isInstancePayload(payload, channel)) {
      const subscriptionId = payload.subscriptionId.toLowerCase();
      const owner = this.subscriptions.get(subscriptionId)?.sender ?? this.tombstones.get(subscriptionId);
      if (owner !== void 0 && owner !== sender) throw new InstanceContractError("SUBSCRIPTION_NOT_OWNED");
      const removed = this.subscriptions.has(subscriptionId);
      this.remove(subscriptionId);
      return { removed };
    }
    const root = await this.root();
    this.available(sender, generation);
    if (channel === "instances:list" && isInstancePayload(payload, channel)) {
      if (payload.rootId.toLowerCase() !== root) throw new InstanceContractError("OUT_OF_SCOPE");
      const items = payload.cursor ? [] : (await this.service.list(root)).filter((item) => item.rootId.toLowerCase() === root).map(publicSummary);
      this.available(sender, generation);
      return this.page(sender, root, channel, "", payload, items);
    }
    if (channel === "instances:create" && isInstancePayload(payload, channel)) {
      if (payload.rootId.toLowerCase() !== root) throw new InstanceContractError("OUT_OF_SCOPE");
      return await this.service.create(requestId, { ...payload, rootId: root });
    }
    if (channel === "tasks:list" && isInstancePayload(payload, channel)) {
      const items = [];
      if (!payload.cursor) {
        const summaries = await this.service.list(root);
        const seen = /* @__PURE__ */ new Set();
        for (const item of summaries) {
          if (item.rootId.toLowerCase() !== root || seen.has(item.taskId)) continue;
          seen.add(item.taskId);
          const snapshot = taskSnapshot(await this.service.task(root, item.taskId), root, item.taskId);
          if (payload.state === void 0 || payload.state === snapshot.state) items.push(snapshot);
        }
        for (const snapshot of await this.additional?.list(root) ?? []) if (payload.state === void 0 || payload.state === snapshot.state) items.push(snapshot);
      }
      this.available(sender, generation);
      return this.page(sender, root, channel, payload.state ?? "", payload, items);
    }
    if (channel === "tasks:get" && isInstancePayload(payload, channel)) {
      return this.publicTask(root, payload.taskId);
    }
    if (channel === "tasks:control" && isInstancePayload(payload, channel)) {
      const current = (await this.publicTask(root, payload.taskId)).snapshot;
      if (payload.action !== "cancel") throw new InstanceContractError("INVALID_TASK_STATE");
      if (current.kind === "install") await this.service.cancel(root, payload.taskId.toLowerCase());
      else await this.additional?.cancel(root, payload.taskId.toLowerCase());
      const snapshot = (await this.publicTask(root, payload.taskId)).snapshot;
      return { taskId: payload.taskId, accepted: true, state: snapshot.state };
    }
    if (channel === "tasks:subscribe" && isInstancePayload(payload, channel)) {
      if (payload.afterSeq !== void 0 && payload.afterSeq > 0) throw new InstanceContractError("CURSOR_EXPIRED");
      const own = [...this.subscriptions.values()].filter((item) => item.sender === sender).length + (this.pending.get(sender) ?? 0);
      const total = this.subscriptions.size + [...this.pending.values()].reduce((a, b) => a + b, 0);
      if (own >= 64 || total >= 256) throw new InstanceContractError("UNAVAILABLE");
      this.pending.set(sender, (this.pending.get(sender) ?? 0) + 1);
      try {
        const snapshot = (await this.publicTask(root, payload.taskId)).snapshot;
        this.available(sender, generation);
        const id2 = (0, import_node_crypto20.randomUUID)();
        this.subscriptions.set(id2, { id: id2, sender, root, task: payload.taskId, seq: 0, snapshot, send });
        this.start();
        return { subscriptionId: id2, snapshot, seq: 0 };
      } finally {
        const count = (this.pending.get(sender) ?? 1) - 1;
        if (count > 0) this.pending.set(sender, count);
        else this.pending.delete(sender);
      }
    }
    throw new InstanceContractError("INVALID_ARGUMENT");
  }
  start() {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => {
      if (this.polling) return;
      this.polling = true;
      void this.poll().catch(() => {
      }).finally(() => {
        this.polling = false;
      });
    }, 100);
    this.timer.unref();
  }
  async poll() {
    if (this.closed || this.subscriptions.size === 0) return;
    const root = await this.root();
    const queried = /* @__PURE__ */ new Map();
    for (const subscription of [...this.subscriptions.values()]) {
      if (this.closed || !this.subscriptions.has(subscription.id)) continue;
      if (subscription.root !== root) {
        this.remove(subscription.id);
        continue;
      }
      try {
        const taskId = subscription.task.toLowerCase();
        let query2 = queried.get(taskId);
        if (!query2) {
          query2 = this.publicTask(root, taskId);
          queried.set(taskId, query2);
        }
        const snapshot = (await query2).snapshot;
        if (this.closed || this.subscriptions.get(subscription.id) !== subscription) continue;
        if (snapshot.revision === subscription.snapshot.revision && snapshot.stage === subscription.snapshot.stage) continue;
        subscription.snapshot = snapshot;
        subscription.seq++;
        try {
          subscription.send({ contractVersion: 1, subscriptionId: subscription.id, seq: subscription.seq, taskId: snapshot.taskId, revision: snapshot.revision, kind: "task:changed", payload: snapshot });
        } catch {
          this.remove(subscription.id);
        }
      } catch (error) {
        if (["TASK_NOT_OWNED", "TASK_NOT_FOUND"].includes(code2(error))) this.remove(subscription.id);
        else if (!(error instanceof InstallerError) && !(error instanceof WorkerError) && !(error instanceof InstanceContractError)) this.remove(subscription.id);
      }
    }
  }
  remove(id2) {
    const subscription = this.subscriptions.get(id2);
    if (!subscription) return;
    this.subscriptions.delete(id2);
    this.tombstones.set(id2, subscription.sender);
    while (this.tombstones.size > 1024) this.tombstones.delete(this.tombstones.keys().next().value);
    if (this.subscriptions.size === 0 && this.timer) {
      clearInterval(this.timer);
      delete this.timer;
    }
  }
  /** Window destruction only removes observation state; it never cancels installation tasks. */
  removeSender(senderId) {
    this.generations.delete(senderId);
    for (const subscription of this.subscriptions.values()) if (subscription.sender === senderId) this.remove(subscription.id);
    for (const [id2, cursor2] of this.cursors) if (cursor2.sender === senderId) this.cursors.delete(id2);
  }
  /** Stops timers and delivery only; InstallerService owns effect cancellation and shutdown order. */
  close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    delete this.timer;
    this.subscriptions.clear();
    this.cursors.clear();
    this.tombstones.clear();
    this.generations.clear();
  }
};

// src/services/catalog/service.ts
var CatalogService = class {
  constructor(reader, repository, now = Date.now) {
    this.reader = reader;
    this.repository = repository;
    this.now = now;
  }
  reader;
  repository;
  now;
  loaded;
  loading;
  retryAt = 0;
  load() {
    if (this.loaded && (this.now() < this.retryAt || this.now() - Date.parse(this.loaded.cache.fetchedAt) >= 0 && this.now() - Date.parse(this.loaded.cache.fetchedAt) < 3e5)) return Promise.resolve({ ...this.loaded, cached: true });
    if (this.loading) return this.loading;
    const pending = this.refresh();
    this.loading = pending;
    void pending.finally(() => {
      if (this.loading === pending) this.loading = void 0;
    }).catch(() => {
    });
    return pending;
  }
  async refresh() {
    let stored;
    try {
      stored = await this.repository.readCatalog();
    } catch {
      throw new CatalogError("CATALOG_UNAVAILABLE");
    }
    let cached;
    if (stored) {
      try {
        const cache = parseCatalogCache(stored.data);
        if (Date.parse(cache.fetchedAt) > this.now() + 6e4) throw new CatalogError("UNTRUSTED_MANIFEST");
        cached = { entries: parseManifest(JSON.parse(cache.body)), cache, cached: true };
      } catch {
        throw new CatalogError("UNTRUSTED_MANIFEST");
      }
      if (this.now() - Date.parse(cached.cache.fetchedAt) < 3e5) {
        this.loaded = cached;
        return cached;
      }
    }
    try {
      const document = await this.reader.read(MANIFEST_URL);
      let entries;
      let cache;
      try {
        entries = parseManifest(JSON.parse(document.body));
        cache = parseCatalogCache({ body: document.body, sha256: document.sha256, fetchedAt: new Date(this.now()).toISOString() });
      } catch {
        throw new CatalogError("UNTRUSTED_MANIFEST");
      }
      try {
        await this.repository.writeCatalog(stored?.revision ?? 0, cache);
      } catch {
        throw new CatalogError("CATALOG_UNAVAILABLE");
      }
      this.loaded = { entries, cache, cached: false };
      return this.loaded;
    } catch (error) {
      if (cached && !(error instanceof CatalogError && error.code === "UNTRUSTED_MANIFEST")) {
        this.loaded = cached;
        this.retryAt = this.now() + 3e4;
        return cached;
      }
      throw error instanceof CatalogError ? error : new CatalogError("UNTRUSTED_MANIFEST");
    }
  }
  /** Paginates a validated catalog. Candidate means not yet verified to launch on the target matrix. */
  async list(query2) {
    if (!["release", "snapshot", "old"].includes(query2.channel) || !Number.isSafeInteger(query2.limit) || query2.limit < 1 || query2.limit > 100) throw new CatalogError("INVALID_ARGUMENT");
    const loaded = await this.load();
    let offset = 0;
    if (query2.cursor !== void 0) {
      const parts = /^v1\.([a-f0-9]{64})\.(release|snapshot|old)\.(0|[1-9][0-9]{0,5})$/.exec(query2.cursor);
      if (!parts || parts[1] !== loaded.cache.sha256 || parts[2] !== query2.channel) throw new CatalogError("INVALID_ARGUMENT");
      offset = Number(parts[3]);
    }
    const items = loaded.entries.filter((entry) => query2.channel === "old" ? entry.type === "old_alpha" || entry.type === "old_beta" : entry.type === query2.channel);
    if (offset > items.length) throw new CatalogError("INVALID_ARGUMENT");
    const end = Math.min(offset + query2.limit, items.length);
    return { page: {
      items: items.slice(offset, end).map((entry) => ({ mcVersionId: entry.id, type: entry.type, releaseTime: entry.releaseTime, status: "candidate" })),
      ...end < items.length ? { nextCursor: `v1.${loaded.cache.sha256}.${query2.channel}.${end}` } : {}
    }, fetchedAt: loaded.cache.fetchedAt, cached: loaded.cached };
  }
  /** Resolves only descriptors found in the official manifest, verifying SHA1 before parsing or inheriting. */
  async resolve(id2, environment2) {
    const loaded = await this.load();
    const documents = /* @__PURE__ */ Object.create(null);
    const entries = new Map(loaded.entries.map((entry) => [entry.id, entry]));
    let next = id2;
    let metadataSha1 = "";
    const metadataSha1ByVersion = /* @__PURE__ */ Object.create(null);
    const versionDocuments = /* @__PURE__ */ Object.create(null);
    try {
      while (next !== void 0) {
        if (Object.hasOwn(documents, next) || Object.keys(documents).length >= 32) throw new CatalogError("UNTRUSTED_MANIFEST");
        const entry = entries.get(next);
        if (!entry) throw new CatalogError("INVALID_ARGUMENT");
        const document = await this.reader.read(entry.url, entry.sha1);
        if (document.sha1 !== entry.sha1) throw new CatalogError("UNTRUSTED_MANIFEST");
        metadataSha1ByVersion[next] = document.sha1;
        versionDocuments[next] = document.body;
        if (!metadataSha1) metadataSha1 = document.sha1;
        const value = JSON.parse(document.body);
        documents[next] = value;
        if (typeof value !== "object" || value === null || !("id" in value) || value.id !== next) throw new CatalogError("UNTRUSTED_MANIFEST");
        next = "inheritsFrom" in value && typeof value.inheritsFrom === "string" ? value.inheritsFrom : void 0;
      }
      return { version: resolveClientVersion(id2, documents, environment2), metadataSha1, metadataSha1ByVersion, versionDocuments };
    } catch (error) {
      throw error instanceof CatalogError ? error : new CatalogError("UNTRUSTED_MANIFEST");
    }
  }
};

// src/services/catalog/install-metadata.ts
var import_node_crypto21 = require("node:crypto");
var InstallMetadataService = class {
  constructor(catalog, reader) {
    this.catalog = catalog;
    this.reader = reader;
  }
  catalog;
  reader;
  /** Validates asset-index bytes against their actual declaring descriptor before planning every artifact. */
  async prepare(id2, environment2) {
    if (environment2.os !== "windows" || environment2.arch !== "x64") throw new CatalogError("INVALID_ARGUMENT");
    try {
      const resolved = await this.catalog.resolve(id2, environment2);
      const index = resolved.version.assetIndex;
      if (!index || !resolved.version.assetIndexVersionId) throw new CatalogError("UNTRUSTED_MANIFEST");
      const document = await this.reader.read(index.url, index.sha1);
      if (document.sha1 !== index.sha1 || Buffer.byteLength(document.body) !== index.size || (0, import_node_crypto21.createHash)("sha1").update(document.body).digest("hex") !== index.sha1) throw new CatalogError("UNTRUSTED_MANIFEST");
      const assets = parseAssetIndex(JSON.parse(document.body));
      const plan = planVanillaInstall(resolved.version, resolved.metadataSha1ByVersion, assets);
      return { version: resolved.version, assets, plan, metadataSha1ByVersion: resolved.metadataSha1ByVersion, assetIndexBody: document.body, versionDocuments: resolved.versionDocuments };
    } catch (error) {
      throw error instanceof CatalogError ? error : new CatalogError("UNTRUSTED_MANIFEST");
    }
  }
};

// src/services/mods/tasks.ts
var import_node_crypto22 = require("node:crypto");

// src/services/mods/report.ts
var safeId = (id2) => id2 && /^[a-z][a-z0-9_-]{1,63}$/.test(id2) ? id2 : null;
function publicModReport(inventory, inspection, checkedAt = (/* @__PURE__ */ new Date()).toISOString()) {
  const issues2 = inventory.local.issues.map((issue) => ({
    scope: "local",
    severity: issue.severity,
    code: issue.code,
    fileId: issue.fileId,
    modId: safeId(issue.modId),
    targetModId: safeId(issue.dependencyId),
    targetProjectId: null,
    targetVersionId: null,
    requirement: issue.expected === null ? null : typeof issue.expected === "string" ? issue.expected : JSON.stringify(issue.expected),
    actual: issue.actual,
    via: issue.via
  }));
  for (const issue of inspection?.platform.issues ?? []) issues2.push({
    scope: "platform",
    severity: issue.severity,
    code: issue.code,
    fileId: issue.fileId,
    modId: null,
    targetModId: null,
    targetProjectId: issue.dependencyProjectId,
    targetVersionId: issue.dependencyVersionId,
    requirement: null,
    actual: [],
    via: []
  });
  for (const failure3 of inspection?.platformFailures ?? []) issues2.push({
    scope: "platform",
    severity: "unknown",
    code: failure3,
    fileId: "",
    modId: null,
    targetModId: null,
    targetProjectId: null,
    targetVersionId: null,
    requirement: null,
    actual: [],
    via: []
  });
  if (issues2.length > 512) issues2.splice(511, issues2.length - 511, {
    scope: "local",
    severity: "unknown",
    code: "REPORT_LIMIT",
    fileId: "",
    modId: null,
    targetModId: null,
    targetProjectId: null,
    targetVersionId: null,
    requirement: null,
    actual: [],
    via: []
  });
  const files = inventory.items.map((item) => {
    const association = inspection?.platform.files.find((file) => file.fileId === item.fileId);
    const mods = (item.archives.find((archive) => !archive.entries.length)?.declarations ?? []).flatMap((facts) => facts.mods.map((mod) => ({
      format: facts.format,
      id: mod.id,
      version: mod.version,
      name: mod.name
    })));
    if (mods.length > 256) throw new ModInventoryError("MOD_LIMIT");
    return {
      fileId: item.fileId,
      filename: item.filename,
      enabled: item.enabled,
      size: item.size,
      sha1: item.sha1,
      sha256: item.sha256,
      sha512: item.sha512,
      mods,
      issues: item.issues,
      sourceStatus: association?.status ?? "unknown",
      source: association?.version ? { projectId: association.version.projectId, versionId: association.version.versionId, versionName: association.version.name } : null
    };
  });
  const result2 = {
    formatVersion: 1,
    instanceId: inventory.instanceId,
    instanceRevision: inventory.revision,
    fingerprint: inventory.fingerprint,
    checkedAt,
    mode: inspection ? "check" : "list",
    localState: inventory.local.state,
    state: inspection?.platform.state ?? inventory.local.state,
    files,
    issues: issues2
  };
  if (!isModReport(result2)) throw new ModInventoryError("MOD_LIMIT");
  return result2;
}

// src/services/mods/tasks.ts
var terminal = (state2) => ["completed", "failed", "cancelled", "needsRecovery"].includes(state2);
function failure2(error) {
  if (error instanceof WorkerError) return "NEEDS_RECOVERY";
  if (typeof error === "object" && error !== null && "code" in error && isModCode(error.code)) return error.code;
  return "SCAN_FAILED";
}
var ModTaskService = class {
  constructor(storage, inventory, inspections) {
    this.storage = storage;
    this.inventory = inventory;
    this.inspections = inspections;
  }
  storage;
  inventory;
  inspections;
  jobs = /* @__PURE__ */ new Map();
  lost = /* @__PURE__ */ new Set();
  admissions = Promise.resolve();
  writes = Promise.resolve();
  closed = false;
  async root() {
    const root = await this.storage.readInstallation();
    if (!root) throw new ModContractError("ROOT_UNAVAILABLE");
    return root.data.rootId;
  }
  async index(root) {
    const index = await this.storage.readModJobs();
    if (index && index.data.rootId !== root) throw new ModContractError("NEEDS_RECOVERY");
    return index?.data ?? { formatVersion: 1, rootId: root, items: [] };
  }
  save(root, record3) {
    const operation = this.writes.then(async () => {
      const current = await this.storage.readModJobs();
      if (current && current.data.rootId !== root) throw new ModContractError("NEEDS_RECOVERY");
      const items = current?.data.items ?? [];
      if (JSON.stringify(items.find((item) => item.taskId === record3.taskId)) === JSON.stringify(record3)) return;
      await this.storage.writeModJobs(current?.revision ?? 0, {
        formatVersion: 1,
        rootId: root,
        items: [...items.filter((item) => item.taskId !== record3.taskId), record3]
      });
    });
    this.writes = operation.then(() => {
    }, () => {
    });
    return operation;
  }
  validReport(root, record3, stored) {
    return stored.rootId === root && stored.taskId === record3.taskId && stored.report.instanceId === record3.instanceId && stored.report.instanceRevision === record3.instanceRevision && stored.report.mode === record3.mode;
  }
  /** Published JSON is the commit proof. Incomplete old reads are never silently rerun against changed files. */
  async initialize() {
    const registered = await this.storage.readInstallation();
    if (!registered) return;
    const root = registered.data.rootId;
    for (const record3 of (await this.index(root)).items) {
      let task = await this.storage.get(root, record3.taskId);
      if (!task || task.kind !== "mod-check") throw new ModContractError("NEEDS_RECOVERY");
      const published = await this.storage.readModReport(record3.taskId);
      if (published) {
        if (!this.validReport(root, record3, published.data) || !["completed", "committing", "needsRecovery"].includes(task.execution.state)) throw new ModContractError("NEEDS_RECOVERY");
        await this.save(root, { ...record3, stage: "completed", reportRevision: 1, errorCode: null });
        if (task.execution.state !== "completed") await this.storage.update(
          root,
          task.taskId,
          task.execution.revision,
          { ...task.execution, state: "completed", revision: task.execution.revision + 1 }
        );
      } else {
        if (record3.reportRevision !== 0 || task.execution.state === "completed") throw new ModContractError("NEEDS_RECOVERY");
        if (!["failed", "cancelled", "needsRecovery"].includes(task.execution.state)) task = await this.storage.update(
          root,
          task.taskId,
          task.execution.revision,
          { ...task.execution, state: "needsRecovery", revision: task.execution.revision + 1 }
        );
        await this.save(root, {
          ...record3,
          stage: task.execution.state,
          errorCode: record3.errorCode ?? (task.execution.state === "cancelled" ? "CANCELLED" : "NEEDS_RECOVERY")
        });
      }
    }
  }
  /** Admission is quick and idempotent; hashing and network work start after durable task/index acceptance. */
  start(requestId, mode, input) {
    const operation = this.admissions.then(() => this.admit(requestId, mode, input));
    this.admissions = operation.then(() => {
    }, () => {
    });
    return operation;
  }
  /** Serializes a trusted target read with the complete task and index admission transaction. */
  withTargetRead(read) {
    const operation = this.admissions.then(read);
    this.admissions = operation.then(() => {
    }, () => {
    });
    return operation;
  }
  async admit(requestId, mode, input) {
    if (this.closed) throw new ModContractError("UNAVAILABLE");
    if (!UUID_PATTERN.test(requestId) || mode !== "list" && mode !== "check" || !isModPayload(input, mode === "list" ? "mods:list" : "mods:check")) throw new ModContractError("INVALID_ARGUMENT");
    const root = await this.root();
    const canonical = { instanceId: input.instanceId.toLowerCase(), expectedRevision: input.expectedRevision, mode };
    const digest3 = (0, import_node_crypto22.createHash)("sha256").update(JSON.stringify(canonical)).digest("hex");
    const index = await this.index(root);
    const existing = index.items.find((item) => item.requestId === requestId.toLowerCase());
    if (existing) {
      if (existing.payloadDigest !== digest3) throw new ModContractError("REVISION_CONFLICT");
      return { taskId: existing.taskId };
    }
    if (this.jobs.size) throw new ModContractError("SCAN_BUSY");
    if (index.items.length >= 1e3) throw new ModContractError("MOD_LIMIT");
    const instances = await this.storage.readInstances();
    const instance = instances?.data.items.find((item) => item.instanceId === canonical.instanceId && item.rootId === root);
    if (!instance || instance.state !== "ready") throw new ModContractError("INVALID_ARGUMENT");
    if (instance.revision !== canonical.expectedRevision) throw new ModContractError("REVISION_CONFLICT");
    const task = await this.storage.accept(root, requestId.toLowerCase(), "mod-check", digest3);
    const record3 = {
      taskId: task.taskId,
      requestId: requestId.toLowerCase(),
      payloadDigest: digest3,
      instanceId: canonical.instanceId,
      instanceRevision: canonical.expectedRevision,
      mode,
      stage: task.execution.state === "queued" ? "queued" : "needsRecovery",
      reportRevision: 0,
      errorCode: task.execution.state === "queued" ? null : "NEEDS_RECOVERY"
    };
    await this.save(root, record3);
    if (task.execution.state === "queued") {
      const job = { task, record: record3, controller: new AbortController(), done: Promise.resolve() };
      this.jobs.set(task.taskId, job);
      job.done = this.run(root, job).finally(() => {
        this.jobs.delete(task.taskId);
      });
      void job.done.catch(() => {
        this.lost.add(task.taskId);
        console.warn(JSON.stringify({ level: "warn", event: "mod-task-recovery-required", code: "NEEDS_RECOVERY" }));
      });
    }
    return { taskId: task.taskId };
  }
  async change(job, execution) {
    if (execution !== job.task.execution) job.task = await this.storage.update(job.task.ownerId, job.task.taskId, job.task.execution.revision, execution);
  }
  event(job, kind) {
    return this.change(job, applyWorkerEvent(job.task.execution, {
      kind,
      ...kind === "progress" ? { bytesDone: 0 } : {},
      attempt: job.task.execution.attempt,
      sequence: job.task.execution.lastSequence + 1
    }).execution);
  }
  async run(root, job) {
    const check2 = () => {
      if (job.controller.signal.aborted) throw new ModContractError("CANCELLED");
    };
    const progress = async (stage2) => {
      check2();
      if (stage2 === "completed") return;
      job.record = { ...job.record, stage: stage2 };
      await this.save(root, job.record);
      await this.event(job, "progress");
      check2();
    };
    try {
      await this.change(job, controlTask(job.task.execution, "start").execution);
      check2();
      let report;
      if (job.record.mode === "check") {
        const inspection = await this.inspections.check(job.record.instanceId, job.record.instanceRevision, job.controller.signal, progress);
        report = publicModReport(inspection.inventory, inspection);
      } else {
        await progress("local");
        report = publicModReport(await this.inventory.scan(job.record.instanceId, job.record.instanceRevision, job.controller.signal));
      }
      check2();
      await this.event(job, "transferred");
      check2();
      await this.event(job, "verified");
      const published = await this.storage.writeModReport(job.task.taskId, { formatVersion: 1, rootId: root, taskId: job.task.taskId, report });
      job.record = { ...job.record, stage: "completed", reportRevision: published.revision, errorCode: null };
      await this.save(root, job.record);
      await this.event(job, "committed");
    } catch (error) {
      const code3 = failure2(error);
      if (code3 === "NEEDS_RECOVERY") {
        const current = await this.storage.get(root, job.task.taskId);
        if (!current || current.kind !== "mod-check") throw new ModContractError("NEEDS_RECOVERY");
        job.task = current;
        if (current.execution.state === "completed" && job.record.reportRevision === 1) {
          const published = await this.storage.readModReport(job.task.taskId);
          if (!published || !this.validReport(root, job.record, published.data)) throw new ModContractError("NEEDS_RECOVERY");
          job.record = { ...job.record, stage: "completed", errorCode: null };
          await this.save(root, job.record);
          return;
        }
      }
      if (job.task.execution.state === "committing" || code3 === "NEEDS_RECOVERY") {
        if (!terminal(job.task.execution.state)) await this.change(job, { ...job.task.execution, state: "needsRecovery", revision: job.task.execution.revision + 1 });
        job.record = { ...job.record, stage: "needsRecovery", errorCode: job.record.reportRevision ? null : "NEEDS_RECOVERY" };
        await this.save(root, job.record);
      } else if (code3 === "CANCELLED") {
        await this.change(job, controlTask(job.task.execution, "cancel").execution);
        job.record = { ...job.record, stage: "cancelled", errorCode: "CANCELLED" };
        await this.save(root, job.record);
        await this.event(job, "cleaned");
      } else {
        await this.event(job, "failed");
        job.record = { ...job.record, stage: "failed", errorCode: code3 };
        await this.save(root, job.record);
        await this.event(job, "cleaned");
      }
    }
  }
  async report(taskId) {
    if (!UUID_PATTERN.test(taskId)) throw new ModContractError("INVALID_ARGUMENT");
    const root = await this.root();
    const record3 = (await this.index(root)).items.find((item) => item.taskId === taskId.toLowerCase());
    if (!record3) throw new ModContractError("TASK_NOT_FOUND");
    if (this.lost.has(record3.taskId)) throw new ModContractError("NEEDS_RECOVERY");
    const task = await this.storage.get(root, record3.taskId);
    if (!task || task.kind !== "mod-check") throw new ModContractError("NEEDS_RECOVERY");
    if (record3.stage !== "completed" || task?.execution.state !== "completed") return { report: null, errorCode: record3.errorCode };
    const stored = await this.storage.readModReport(record3.taskId);
    if (!stored || !this.validReport(root, record3, stored.data)) throw new ModContractError("NEEDS_RECOVERY");
    return { report: stored.data.report, errorCode: null };
  }
  async get(root, taskId) {
    const record3 = (await this.index(root)).items.find((item) => item.taskId === taskId.toLowerCase());
    if (!record3) return void 0;
    return this.taskView(root, record3);
  }
  async taskView(root, record3) {
    const task = this.jobs.get(record3.taskId)?.task ?? await this.storage.get(root, record3.taskId);
    if (!task || task.kind !== "mod-check") throw new InstanceContractError("NEEDS_RECOVERY");
    return this.targetTaskView(root, task);
  }
  /** Projects a proven stored target using the same live and recovery state as the task service. */
  targetTaskView(root, binding) {
    if (binding.kind !== "mod-check" || binding.ownerId.toLowerCase() !== root.toLowerCase()) throw new InstanceContractError("NEEDS_RECOVERY");
    const live = this.jobs.get(binding.taskId)?.task;
    const task = live && live.execution.revision >= binding.execution.revision ? live : binding;
    const execution = task.execution;
    const state2 = this.lost.has(task.taskId) ? "needsRecovery" : execution.state;
    const stage2 = terminal(state2) ? state2 : state2 === "committing" ? "committing" : "preparing";
    const snapshot = { taskId: task.taskId, kind: "mod-check", state: state2, stage: stage2, revision: execution.revision, bytesDone: 0 };
    if (state2 === "failed" || state2 === "needsRecovery") {
      const failed = instanceFailure((0, import_node_crypto22.randomUUID)(), state2 === "needsRecovery" ? "NEEDS_RECOVERY" : "UNAVAILABLE", (0, import_node_crypto22.randomUUID)());
      if (!failed.ok) snapshot.error = failed.error;
    }
    return { snapshot };
  }
  async list(root) {
    const snapshots = [];
    for (const record3 of (await this.index(root)).items) snapshots.push((await this.taskView(root, record3)).snapshot);
    return snapshots;
  }
  async cancel(root, taskId) {
    if (!(await this.index(root)).items.some((item) => item.taskId === taskId)) throw new InstanceContractError("TASK_NOT_FOUND");
    const job = this.jobs.get(taskId);
    if (!job) {
      const task = await this.storage.get(root, taskId);
      if (task?.execution.state === "cancelled") return;
      if (task?.execution.state === "completed" || task?.execution.state === "committing") throw new InstanceContractError("CANCEL_TOO_LATE");
      throw new InstanceContractError("INVALID_TASK_STATE");
    }
    if (job.task.execution.state === "committing" || job.task.execution.state === "completed") throw new InstanceContractError("CANCEL_TOO_LATE");
    job.controller.abort();
    await job.done;
  }
  async close() {
    this.closed = true;
    await this.admissions;
    for (const job of this.jobs.values()) if (job.task.execution.state !== "committing") job.controller.abort();
    const results = await Promise.allSettled([...this.jobs.values()].map((job) => job.done));
    await this.writes;
    if (this.lost.size || results.some((result2) => result2.status === "rejected")) throw new ModContractError("NEEDS_RECOVERY");
  }
};

// src/services/java/selection.ts
var JAVA_PROBE_TIMEOUT_MS = 8e3;
function registeredJavaCandidates(saved, major) {
  return [...saved.javas].filter((java) => java.major === major).sort((a, b) => Number(b.javaId === saved.selectedJavaId) - Number(a.javaId === saved.selectedJavaId));
}

// src/services/mods/java-facts.ts
var InstalledJavaFacts = class {
  constructor(profiles, probe = new JavaProbe()) {
    this.profiles = profiles;
    this.probe = probe;
  }
  profiles;
  probe;
  active = false;
  async read(major, signal) {
    if (this.active) throw new ModInventoryError("SCAN_BUSY");
    this.active = true;
    const check2 = () => {
      if (signal?.aborted) throw new ModInventoryError("CANCELLED");
    };
    try {
      check2();
      const saved = await this.profiles.list();
      check2();
      const candidates = registeredJavaCandidates(saved, major);
      let version3 = null;
      for (const java of candidates) {
        check2();
        try {
          const measured = await this.probe.probe(java.executable, { ...signal ? { signal } : {}, timeoutMs: JAVA_PROBE_TIMEOUT_MS });
          check2();
          if (measured.major === major) {
            version3 = measured.version;
            break;
          }
        } catch (error) {
          check2();
          if (!(error instanceof JavaProbeError)) throw error;
          if (error.code === "CANCELLED") throw new ModInventoryError("CANCELLED");
        }
      }
      check2();
      if (JSON.stringify(await this.profiles.list()) !== JSON.stringify(saved)) throw new ModInventoryError("FILES_CHANGED");
      check2();
      return version3;
    } finally {
      this.active = false;
    }
  }
};

// src/services/launch/profiles.ts
var import_node_crypto23 = require("node:crypto");
var ProfileError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "ProfileError";
  }
  code;
  category = "validation";
};
var ProfileService = class {
  constructor(storage, probe = new JavaProbe()) {
    this.storage = storage;
    this.probe = probe;
  }
  storage;
  probe;
  tail = Promise.resolve();
  closed = false;
  jobs = /* @__PURE__ */ new Set();
  serial(action) {
    const result2 = this.tail.then(action);
    this.tail = result2.then(() => {
    }, () => {
    });
    return result2;
  }
  async read() {
    return await this.storage.readLaunchProfiles() ?? { revision: 0, data: { javas: [], accounts: [], requests: [] } };
  }
  /** Reads trusted internal profiles, including the private executable/UUID; adapters must project a public DTO. */
  async list() {
    return (await this.read()).data;
  }
  /** Persists the measured explicitly chosen JVM; reselecting the same path preserves its opaque reference. */
  registerJava(executable, signal, expectedProfiles) {
    if (this.closed) return Promise.reject(new ProfileError("STORAGE_UNAVAILABLE"));
    const result2 = this.register(executable, signal, expectedProfiles);
    this.jobs.add(result2);
    void result2.finally(() => {
      this.jobs.delete(result2);
    }).catch(() => {
    });
    return result2;
  }
  async register(executable, signal, expectedProfiles) {
    let runtime;
    try {
      runtime = await this.probe.probe(executable, signal ? { signal } : {});
    } catch {
      throw new ProfileError("JAVA_INVALID");
    }
    return this.serial(async () => {
      if (signal?.aborted) throw new ProfileError("JAVA_INVALID");
      const current = await this.read();
      if (signal?.aborted) throw new ProfileError("JAVA_INVALID");
      if (expectedProfiles && JSON.stringify(current.data) !== JSON.stringify(expectedProfiles)) throw new ProfileError("JAVA_INVALID");
      const executable2 = normalizeDataDirectory(runtime.executable);
      const existing = current.data.javas.find((java2) => java2.executable.toLowerCase() === executable2.toLowerCase());
      if (!existing && current.data.javas.length >= 32) throw new ProfileError("STORAGE_UNAVAILABLE");
      const java = { javaId: existing?.javaId ?? (0, import_node_crypto23.randomUUID)(), executable: executable2, major: runtime.major, version: runtime.version, vendor: runtime.vendor };
      const data = parseLaunchProfiles({ ...current.data, javas: [...current.data.javas.filter((item) => item.javaId !== java.javaId), java], selectedJavaId: java.javaId });
      await this.storage.writeLaunchProfiles(current.revision, data);
      return java;
    });
  }
  /** Atomically stores the approved stable offline UUID and request result before acknowledging creation. */
  createOffline(requestId, input) {
    if (this.closed) return Promise.reject(new ProfileError("STORAGE_UNAVAILABLE"));
    if (!UUID_PATTERN.test(requestId) || !validGameName(input.gameName) || typeof input.displayName !== "string" || !input.displayName.trim() || input.displayName.length > 80 || /[\p{C}]/u.test(input.displayName)) return Promise.reject(new ProfileError("ACCOUNT_NAME_INVALID"));
    const canonical = { displayName: input.displayName.trim(), gameName: input.gameName };
    const digest3 = (0, import_node_crypto23.createHash)("sha256").update(JSON.stringify(canonical)).digest("hex");
    return this.serial(async () => {
      const current = await this.read();
      const request = current.data.requests.find((item) => item.requestId === requestId.toLowerCase());
      if (request) {
        if (request.digest !== digest3) throw new ProfileError("INVALID_ARGUMENT");
        const existing = current.data.accounts.find((item) => item.accountId === request.accountId);
        if (!existing) throw new ProfileError("STORAGE_UNAVAILABLE");
        return existing;
      }
      if (current.data.accounts.some((account2) => account2.gameName === canonical.gameName)) throw new ProfileError("ACCOUNT_CONFLICT");
      if (current.data.accounts.length >= 1e3 || current.data.requests.length >= 2048) throw new ProfileError("STORAGE_UNAVAILABLE");
      const account = { accountId: (0, import_node_crypto23.randomUUID)(), ...canonical, uuid: offlineUuid(canonical.gameName) };
      const data = parseLaunchProfiles({
        ...current.data,
        accounts: [...current.data.accounts, account],
        requests: [...current.data.requests, { requestId: requestId.toLowerCase(), digest: digest3, accountId: account.accountId }]
      });
      await this.storage.writeLaunchProfiles(current.revision, data);
      return account;
    });
  }
  /** Stops admission and joins already-owned Java probes and serialized commits before storage closes. */
  async close() {
    this.closed = true;
    await Promise.allSettled([...this.jobs]);
    await this.tail;
  }
};

// src/core/mods/platform.ts
function checkPlatformMods(localState, files, environment2, versionsByHash) {
  const issues2 = [];
  const associations = [];
  const add = (severity, code3, fileId2, version3, dependency) => {
    if (issues2.length >= 4096) return;
    if (issues2.length === 4095) {
      issues2.push({ severity: "unknown", code: "REPORT_LIMIT", fileId: "", projectId: null, dependencyProjectId: null, dependencyVersionId: null, versionId: null });
      return;
    }
    issues2.push({
      severity,
      code: code3,
      fileId: fileId2,
      projectId: version3?.projectId ?? null,
      versionId: version3?.versionId ?? null,
      dependencyProjectId: dependency?.projectId ?? null,
      dependencyVersionId: dependency?.versionId ?? null
    });
  };
  if (files.length > 256) add("unknown", "INSTANCE_MOD_LIMIT", "", null);
  for (const file of files.slice(0, 256)) {
    const version3 = file.sha512 ? versionsByHash.get(file.sha512) ?? null : null;
    if (!version3) {
      associations.push({ fileId: file.fileId, status: "unknown", version: null });
      if (file.enabled) add("unknown", "PLATFORM_SOURCE_UNKNOWN", file.fileId, null);
      continue;
    }
    const matched = version3.files.find((candidate) => candidate.sha512 === file.sha512);
    let conflict = false;
    if (!matched || matched.sha1 !== file.sha1 || matched.size !== file.size) {
      conflict = true;
      if (file.enabled) add("error", "PLATFORM_HASH_CONFLICT", file.fileId, version3);
    }
    if (file.enabled) {
      const minecraft = environment2.versions.minecraft;
      if (!minecraft) add("unknown", "MINECRAFT_VERSION_UNKNOWN", file.fileId, version3);
      else if (!version3.gameVersions.includes(minecraft)) {
        conflict = true;
        add("error", "PLATFORM_MINECRAFT_CONFLICT", file.fileId, version3);
      }
      if (!version3.loaders.includes(environment2.loader)) {
        if (environment2.loader === "quilt" && version3.loaders.includes("fabric")) add("unknown", "PLATFORM_QUILT_UNVERIFIED", file.fileId, version3);
        else {
          conflict = true;
          add("error", "PLATFORM_LOADER_CONFLICT", file.fileId, version3);
        }
      }
      if (environment2.loader === "vanilla" || !file.formats.includes(environment2.loader) && !(environment2.loader === "quilt" && file.formats.includes("fabric"))) {
        conflict = true;
        add("error", "LOCAL_LOADER_CONFLICT", file.fileId, version3);
      }
      if (version3.environment === "server_only" || version3.environment === "dedicated_server_only") {
        conflict = true;
        add("error", "PLATFORM_CLIENT_CONFLICT", file.fileId, version3);
      } else if (![
        "client_and_server",
        "client_only",
        "client_only_server_optional",
        "singleplayer_only",
        "server_only_client_optional",
        "client_or_server",
        "client_or_server_prefers_both"
      ].includes(version3.environment)) add("unknown", "PLATFORM_ENVIRONMENT_UNKNOWN", file.fileId, version3);
    }
    associations.push({ fileId: file.fileId, version: version3, status: conflict ? "conflict" : "matched" });
  }
  const enabled = new Set(files.filter((file) => file.enabled).map((file) => file.fileId));
  const known = associations.filter((item) => enabled.has(item.fileId) && item.version !== null);
  const projects = /* @__PURE__ */ new Map();
  for (const item of known) {
    const group = projects.get(item.version.projectId) ?? [];
    group.push(item);
    projects.set(item.version.projectId, group);
  }
  for (const group of projects.values()) if (group.length > 1) for (const item of group) add("error", "DUPLICATE_PROJECT", item.fileId, item.version);
  const unresolved = files.some((file) => file.enabled && file.unresolvedEmbedded) || associations.some((item) => enabled.has(item.fileId) && item.status !== "matched");
  for (const item of known) {
    for (const dependency of item.version.dependencies) {
      if (dependency.type === "embedded") {
        add("unknown", "EMBEDDED_PROJECT_UNRESOLVED", item.fileId, item.version, dependency);
        continue;
      }
      if (dependency.projectId === null && dependency.versionId === null) {
        add("unknown", "PLATFORM_DEPENDENCY_ID_UNKNOWN", item.fileId, item.version, dependency);
        continue;
      }
      const matching = known.filter((candidate) => (!dependency.projectId || candidate.version.projectId === dependency.projectId) && (!dependency.versionId || candidate.version.versionId === dependency.versionId));
      if (matching.length) {
        if (dependency.type === "incompatible") add("error", "PLATFORM_PROJECT_CONFLICT", item.fileId, item.version, dependency);
        continue;
      }
      const projectPresent = dependency.projectId !== null && projects.has(dependency.projectId);
      if (dependency.type === "required" || dependency.type === "optional" && projectPresent) {
        add(unresolved ? "unknown" : "error", dependency.versionId && projectPresent ? "PLATFORM_PIN_MISMATCH" : "PLATFORM_DEPENDENCY_MISSING", item.fileId, item.version, dependency);
      }
    }
  }
  return { state: localState === "unsatisfied" || issues2.some((issue) => issue.severity === "error") ? "unsatisfied" : localState === "unknown" || issues2.some((issue) => issue.severity === "unknown") ? "unknown" : "satisfied", files: associations, issues: issues2 };
}

// src/services/mods/modrinth.ts
var import_node_crypto24 = require("node:crypto");
var import_promises18 = require("node:timers/promises");
var ModPlatformError = class extends Error {
  constructor(code3) {
    super(code3);
    this.code = code3;
    this.name = "ModPlatformError";
    this.category = code3 === "CANCELLED" ? "cancelled" : code3 === "INVALID_ARGUMENT" || code3 === "UNTRUSTED_METADATA" ? "validation" : code3 === "PLATFORM_LIMIT" ? "biz" : "network";
  }
  code;
  category;
};
function invalid11() {
  throw new ModPlatformError("UNTRUSTED_METADATA");
}
function object3(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid11();
  return value;
}
function text3(value, maximum) {
  if (typeof value !== "string" || !value.length || value.length > maximum || /[\p{C}]/u.test(value)) invalid11();
  return value;
}
function identity2(value) {
  if (!resourceId(value)) invalid11();
  return value;
}
function hash(value, length) {
  if (typeof value !== "string" || !new RegExp(`^[a-f0-9]{${length}}$`).test(value)) invalid11();
  return value;
}
function strings(value, maximum) {
  if (!Array.isArray(value) || !value.length || value.length > maximum) invalid11();
  const result2 = value.map((item) => text3(item, 160));
  if (new Set(result2).size !== result2.length) invalid11();
  return result2;
}
function parseVersion(value, evidence) {
  const row = object3(value);
  const projectId = identity2(row.project_id);
  const versionId = identity2(row.id);
  const release2 = row.version_type;
  if (release2 !== "release" && release2 !== "beta" && release2 !== "alpha") invalid11();
  const publishedAt = text3(row.date_published, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(publishedAt) || !Number.isFinite(Date.parse(publishedAt))) invalid11();
  if (!Array.isArray(row.files) || !row.files.length || row.files.length > 64 || !Array.isArray(row.dependencies) || row.dependencies.length > 256) invalid11();
  const files = row.files.map((value2) => {
    const file = object3(value2);
    const hashes = object3(file.hashes);
    if (!resourceFilename(file.filename) || !isModrinthFileUrl(file.url) || !new URL(file.url).pathname.startsWith(`/data/${projectId}/`) || typeof file.size !== "number" || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 1024 ** 3 || typeof file.primary !== "boolean") invalid11();
    return { filename: file.filename, url: file.url, size: file.size, primary: file.primary, sha1: hash(hashes.sha1, 40), sha512: hash(hashes.sha512, 128) };
  });
  if (new Set(files.map((file) => file.filename.toLowerCase())).size !== files.length || new Set(files.map((file) => file.sha512)).size !== files.length) invalid11();
  const dependencies = row.dependencies.map((value2) => {
    const dependency = object3(value2);
    const type = dependency.dependency_type;
    if (type !== "required" && type !== "optional" && type !== "incompatible" && type !== "embedded") invalid11();
    if (dependency.file_name !== null && !resourceFilename(dependency.file_name)) invalid11();
    return {
      type,
      projectId: dependency.project_id === null ? null : identity2(dependency.project_id),
      versionId: dependency.version_id === null ? null : identity2(dependency.version_id),
      filename: dependency.file_name
    };
  });
  return {
    projectId,
    versionId,
    release: release2,
    publishedAt,
    name: text3(row.name, 256),
    versionNumber: text3(row.version_number, 160),
    loaders: strings(row.loaders, 32),
    gameVersions: strings(row.game_versions, 2048),
    environment: row.environment === void 0 ? "unknown" : text3(row.environment, 64),
    dependencies,
    files,
    evidence
  };
}
var ModrinthModClient = class {
  constructor(request = fetch) {
    this.request = request;
  }
  request;
  active = 0;
  cooldown = 0;
  async read(endpoint, signal, hashes) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.readOnce(endpoint, signal, hashes);
      } catch (error) {
        if (!(error instanceof ModPlatformError) || error.code !== "NETWORK_FAILED" || attempt >= 1) throw error;
        try {
          await (0, import_promises18.setTimeout)(250, void 0, { signal });
        } catch {
          throw new ModPlatformError("CANCELLED");
        }
      }
    }
  }
  async readOnce(endpoint, signal, hashes) {
    if (this.active >= 4) throw new ModPlatformError("PLATFORM_LIMIT");
    if (Date.now() < this.cooldown) throw new ModPlatformError("RETRY_LATER");
    if (signal?.aborted) throw new ModPlatformError("CANCELLED");
    const url = `https://api.modrinth.com/v2/${endpoint}`;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), 12e3);
    this.active++;
    try {
      const response = await this.request(url, {
        method: hashes ? "POST" : "GET",
        redirect: "error",
        credentials: "omit",
        signal: controller.signal,
        headers: { "User-Agent": "hns0307/OUCL (https://github.com/hns0307/OUCL)", Accept: "application/json", "Content-Type": "application/json" },
        ...hashes ? { body: JSON.stringify({ hashes, algorithm: "sha512" }) } : {}
      });
      if (response.status === 429) {
        const seconds = Number(response.headers.get("retry-after") ?? "60");
        this.cooldown = Date.now() + Math.max(1, Math.min(300, Number.isFinite(seconds) ? seconds : 60)) * 1e3;
        throw new ModPlatformError("RETRY_LATER");
      }
      if (response.status === 404) throw new ModPlatformError("NOT_FOUND");
      if (response.status !== 200 || !response.body) throw new ModPlatformError("NETWORK_FAILED");
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > 8 * 1024 ** 2)) throw new ModPlatformError("PLATFORM_LIMIT");
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          if (size > 8 * 1024 ** 2) throw new ModPlatformError("PLATFORM_LIMIT");
          chunks.push(chunk);
        }
      } finally {
        await response.body.cancel().catch(() => {
        });
      }
      const bytes = Buffer.concat(chunks);
      let value;
      if (signal?.aborted) throw new ModPlatformError("CANCELLED");
      try {
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        invalid11();
      }
      return { value, evidence: { url, sha256: (0, import_node_crypto24.createHash)("sha256").update(bytes).digest("hex") } };
    } catch (error) {
      if (error instanceof ModPlatformError) throw error;
      throw new ModPlatformError(signal?.aborted ? "CANCELLED" : "NETWORK_FAILED");
    } finally {
      clearTimeout(timer);
      controller.abort();
      signal?.removeEventListener("abort", abort);
      this.active--;
    }
  }
  /** Associates a specific file by SHA-512, preserving absent matches as absent rather than searching by name. */
  async byHashes(hashes, signal) {
    if (!hashes.length || hashes.length > 64 || new Set(hashes).size !== hashes.length || hashes.some((value) => !/^[a-f0-9]{128}$/.test(value))) throw new ModPlatformError("INVALID_ARGUMENT");
    const reply = await this.read("version_files", signal, hashes);
    const values = object3(reply.value);
    if (Object.keys(values).length > hashes.length) invalid11();
    const results = /* @__PURE__ */ new Map();
    for (const [key, raw] of Object.entries(values)) {
      if (!hashes.includes(key)) invalid11();
      const version3 = parseVersion(raw, reply.evidence);
      if (!version3.files.some((file) => file.sha512 === key)) invalid11();
      results.set(key, version3);
    }
    return results;
  }
  /** A pinned dependency is fetched by exact version ID; callers must verify its project and downloaded declaration. */
  async version(versionId, signal) {
    if (!resourceId(versionId)) throw new ModPlatformError("INVALID_ARGUMENT");
    const reply = await this.read(`version/${versionId}`, signal);
    const version3 = parseVersion(reply.value, reply.evidence);
    if (version3.versionId !== versionId) invalid11();
    return version3;
  }
  /** Orders candidates by stable release first, publication descending, then version ID ascending. Never upgrades an installed file. */
  async candidates(projectId, minecraft, loader2, signal) {
    if (!resourceId(projectId) || !/^[A-Za-z0-9_.+-]{1,160}$/.test(minecraft) || !["fabric", "quilt", "forge", "neoforge"].includes(loader2)) throw new ModPlatformError("INVALID_ARGUMENT");
    const query2 = new URLSearchParams({ game_versions: JSON.stringify([minecraft]), loaders: JSON.stringify([loader2]) });
    const reply = await this.read(`project/${projectId}/version?${query2}`, signal);
    if (!Array.isArray(reply.value) || reply.value.length > 512) throw new ModPlatformError("PLATFORM_LIMIT");
    const versions = reply.value.map((raw) => parseVersion(raw, reply.evidence));
    if (versions.some((version3) => version3.projectId !== projectId || !version3.gameVersions.includes(minecraft) || !version3.loaders.includes(loader2)) || new Set(versions.map((version3) => version3.versionId)).size !== versions.length) invalid11();
    return versions.sort((left, right) => Number(right.release === "release") - Number(left.release === "release") || Date.parse(right.publishedAt) - Date.parse(left.publishedAt) || (left.versionId < right.versionId ? -1 : left.versionId > right.versionId ? 1 : 0));
  }
};

// src/services/mods/inspection.ts
var ModInspectionService = class {
  constructor(context, inventory, platform) {
    this.context = context;
    this.inventory = inventory;
    this.platform = platform;
  }
  context;
  inventory;
  platform;
  active = false;
  async check(instanceId, expectedRevision, signal, progress) {
    if (!UUID_PATTERN.test(instanceId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new ModInventoryError("INVALID_ARGUMENT");
    instanceId = instanceId.toLowerCase();
    if (this.active) throw new ModInventoryError("SCAN_BUSY");
    this.active = true;
    const cancelled2 = () => {
      if (signal?.aborted) throw new ModInventoryError("CANCELLED");
    };
    try {
      cancelled2();
      await progress?.("local");
      const initial = await this.inventory.scan(instanceId, expectedRevision, signal);
      cancelled2();
      const context = await this.context(instanceId, signal);
      const contextSnapshot = JSON.stringify(context);
      if (context.instanceId !== instanceId || context.revision !== expectedRevision) throw new ModInventoryError("REVISION_CONFLICT");
      const hashes = [...new Set(initial.items.flatMap((item) => item.sha512 ? [item.sha512] : []))];
      const versions = /* @__PURE__ */ new Map();
      const platformFailures = [];
      let bytes = 0;
      await progress?.("platform");
      for (let offset = 0; offset < hashes.length; offset += 64) {
        cancelled2();
        try {
          const matched = await this.platform.byHashes(hashes.slice(offset, offset + 64), signal);
          cancelled2();
          for (const [hash2, version3] of matched) {
            bytes += Buffer.byteLength(JSON.stringify(version3));
            if (bytes > 8 * 1024 ** 2) throw new ModPlatformError("PLATFORM_LIMIT");
            versions.set(hash2, version3);
          }
        } catch (error) {
          cancelled2();
          if (!(error instanceof ModPlatformError)) throw error;
          if (error.code === "CANCELLED") throw new ModInventoryError("CANCELLED");
          platformFailures.push(error.code);
          break;
        }
      }
      cancelled2();
      await progress?.("rechecking");
      const final = await this.inventory.scan(instanceId, expectedRevision, signal);
      cancelled2();
      if (initial.fingerprint !== final.fingerprint) throw new ModInventoryError("FILES_CHANGED");
      if (JSON.stringify(await this.context(instanceId, signal)) !== contextSnapshot) throw new ModInventoryError("REVISION_CONFLICT");
      const platform = checkPlatformMods(final.local.state, platformFacts(final.items), context.environment, versions);
      if (platformFailures.length && platform.state === "satisfied") platform.state = "unknown";
      cancelled2();
      await progress?.("completed");
      cancelled2();
      return { inventory: final, platform, platformFailures };
    } finally {
      this.active = false;
    }
  }
};

// tests/fixtures/mod-zip.ts
var import_node_zlib = require("node:zlib");
function modZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [filename, content] of entries) {
    const name2 = Buffer.from(filename);
    const raw = Buffer.from(content);
    const body = (0, import_node_zlib.deflateRawSync)(raw);
    const crc = (0, import_node_zlib.crc32)(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(67324752);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(2048, 6);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(name2.length, 26);
    local.push(head, name2, body);
    const item = Buffer.alloc(46);
    item.writeUInt32LE(33639248);
    item.writeUInt16LE(20, 4);
    item.writeUInt16LE(20, 6);
    item.writeUInt16LE(2048, 8);
    item.writeUInt16LE(8, 10);
    item.writeUInt32LE(crc, 16);
    item.writeUInt32LE(body.length, 20);
    item.writeUInt32LE(raw.length, 24);
    item.writeUInt16LE(name2.length, 28);
    item.writeUInt32LE(offset, 42);
    central.push(item, name2);
    offset += 30 + name2.length + body.length;
  }
  const center = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(101010256);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(center.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, center, end]);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CatalogService,
  InstallMetadataService,
  InstalledJavaFacts,
  InstalledLanguageReader,
  InstallerAdapter,
  InstallerService,
  LoaderInstallMetadataService,
  ModArchiveReader,
  ModInspectionService,
  ModInventoryService,
  ModTaskService,
  ModrinthModClient,
  ProfileService,
  StorageClient,
  createDesktopFetch,
  instanceGameLayout,
  modInventoryContext,
  modZip,
  parseLoaderProfile,
  restoreInstallMetadata
});
/*! Bundled license information:

smol-toml/dist/error.js:
smol-toml/dist/primitive.js:
smol-toml/dist/date.js:
smol-toml/dist/extract.js:
smol-toml/dist/util.js:
smol-toml/dist/struct.js:
smol-toml/dist/parse.js:
smol-toml/dist/stringify.js:
smol-toml/dist/index.js:
  (*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   *)
*/
