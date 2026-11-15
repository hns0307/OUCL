/** Reviewed, immutable main-process configuration. Never populated by renderer input. */
export interface OnlineToolDefinition {
  toolId: string;
  title: string;
  entryUrl: string;
  documentOrigin: string;
  resourceOrigins: readonly string[];
}

/** No real site has been selected or reviewed. */
export const ONLINE_TOOL_REGISTRY: readonly OnlineToolDefinition[] = Object.freeze([]);

function publicHttps(value: string): URL | undefined {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port || value.length > 4096
      || !host.includes('.') || host.endsWith('.') || host.includes(':') || /^[\d.]+$/.test(host)
      || ['localhost', 'local', 'internal', 'lan', 'home', 'test', 'invalid'].some(suffix => host === suffix || host.endsWith(`.${suffix}`))) return;
    return url;
  } catch { return; }
}

/** Exact origins only: resource CDN permission never grants document navigation. */
export function onlineToolUrlAllowed(tool: OnlineToolDefinition, value: string, kind: 'document' | 'resource'): boolean {
  const url = publicHttps(value);
  return !!url && (url.origin === tool.documentOrigin || kind === 'resource' && tool.resourceOrigins.includes(url.origin));
}

/** Copies and freezes reviewed records, rejecting ambiguous identities/origins before any IO. */
export function validateOnlineToolRegistry(input: readonly OnlineToolDefinition[]): readonly OnlineToolDefinition[] {
  if (input.length > 16) throw new Error('INVALID_TOOL_REGISTRY');
  const ids = new Set<string>();
  return Object.freeze(input.map(tool => {
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(tool.toolId) || ids.has(tool.toolId) || !tool.title.trim() || tool.title.length > 80
      || tool.resourceOrigins.length > 16 || !onlineToolUrlAllowed(tool, tool.entryUrl, 'document')
      || [tool.documentOrigin, ...tool.resourceOrigins].some(origin => publicHttps(origin)?.origin !== origin)) throw new Error('INVALID_TOOL_REGISTRY');
    ids.add(tool.toolId);
    return Object.freeze({ ...tool, resourceOrigins: Object.freeze([...tool.resourceOrigins]) });
  }));
}
