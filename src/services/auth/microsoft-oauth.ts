
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { PublicClientApplication } from '@azure/msal-node';
import { MicrosoftError } from './microsoft-api.js';

const AUTHORITY = 'https://login.microsoftonline.com/consumers';
const CALLBACK = '/oauth/callback';
const SCOPES = ['XboxLive.SignIn', 'offline_access'];

export interface OAuthAccount {
  accessToken: string;
  homeAccountId: string;
  cache: string;
}

function sameState(expected: string, incoming: string | null): boolean {
  if (incoming === null || expected.length !== incoming.length || !/^[A-Za-z0-9_-]+$/.test(incoming)) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(incoming));
}

/** Wraps the MSAL public-client code flow in an abortable, loopback-only browser session. */
export class MicrosoftOAuth {
  readonly configured: boolean;
  constructor(readonly clientId: string | undefined, private readonly openBrowser: (url: string) => Promise<void>) {
    this.configured = typeof clientId === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(clientId);
  }

  private application(): PublicClientApplication {
    if (!this.configured || !this.clientId) throw new MicrosoftError('UNCONFIGURED');
    return new PublicClientApplication({
      auth: { clientId: this.clientId, authority: AUTHORITY },
      system: {
        disableInternalRetries: true,
        loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} },
      },
    });
  }

  async signIn(signal: AbortSignal): Promise<OAuthAccount> {
    const app = this.application();
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    let trustedAuthority: string | undefined;
    let resolveCode!: (code: string) => void;
    let rejectCode!: (error: MicrosoftError) => void;
    const callback = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
    void callback.catch(() => {});
    let used = false;
    const server = createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 }, (req, res) => {
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.setHeader('connection', 'close');
      res.setHeader('content-security-policy', "default-src 'none'");
      res.setHeader('referrer-policy', 'no-referrer');
      if (used || signal.aborted || req.method !== 'GET' || !trustedAuthority || req.headers.host !== trustedAuthority
        || req.url === undefined || !req.url.startsWith(CALLBACK + '?') || req.url.length > 8192) {
        res.writeHead(404).end('OUCL');
        return;
      }
      const url = new URL(req.url, 'http://' + trustedAuthority);
      const states = url.searchParams.getAll('state');
      if (url.pathname !== CALLBACK || states.length !== 1 || !sameState(state, states[0] ?? null)) {
        res.writeHead(400).end('OUCL');
        return;
      }
      const codes = url.searchParams.getAll('code');
      const code = codes[0];
      used = true;
      if (codes.length !== 1 || !code || code.length > 4096 || !/^[!-~]+$/.test(code) || url.searchParams.has('error')) {
        res.writeHead(400).end('未完成登录。请返回 OUCL。', () => { rejectCode(new MicrosoftError('SIGN_IN')); });
      } else {
        res.writeHead(200).end('已收到授权。请返回 OUCL 完成账号验证。', () => { resolveCode(code); });
      }
    });
    server.maxConnections = 8;
    server.setTimeout(5000, socket => { socket.destroy(); });
    const cancel = (): void => { rejectCode(new MicrosoftError('CANCELLED')); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      signal.throwIfAborted();
      server.listen({ host: '127.0.0.1', port: 0 });
      await once(server, 'listening', { signal });
      const bound = server.address();
      if (!bound || typeof bound === 'string') throw new MicrosoftError('SIGN_IN');
      trustedAuthority = 'localhost:' + bound.port;
      const redirectUri = 'http://' + trustedAuthority + CALLBACK;
      const url = new URL(await app.getAuthCodeUrl({
        redirectUri, scopes: SCOPES, state, codeChallenge: challenge, codeChallengeMethod: 'S256',
        responseMode: 'query', prompt: 'select_account',
      }));
      if (url.origin !== 'https://login.microsoftonline.com' || url.pathname !== '/consumers/oauth2/v2.0/authorize') {
        throw new MicrosoftError('SIGN_IN');
      }
      signal.throwIfAborted();
      await this.openBrowser(url.href);
      const code = await callback;
      signal.throwIfAborted();
      const result = await app.acquireTokenByCode({ code, redirectUri, scopes: SCOPES, codeVerifier: verifier });
      signal.throwIfAborted();
      if (!result?.account?.homeAccountId || !result.accessToken) throw new MicrosoftError('SIGN_IN');
      return { accessToken: result.accessToken, homeAccountId: result.account.homeAccountId, cache: app.getTokenCache().serialize() };
    } catch (error) {
      if (signal.aborted) throw new MicrosoftError('CANCELLED');
      throw error instanceof MicrosoftError ? error : new MicrosoftError('SIGN_IN');
    } finally {
      signal.removeEventListener('abort', cancel);
      server.close();
      server.closeAllConnections();
    }
  }

  async refresh(credentials: Omit<OAuthAccount, 'accessToken'>, signal: AbortSignal): Promise<OAuthAccount> {
    const app = this.application();
    try {
      signal.throwIfAborted();
      app.getTokenCache().deserialize(credentials.cache);
      const account = await app.getTokenCache().getAccountByHomeId(credentials.homeAccountId);
      if (!account) throw new MicrosoftError('REAUTH');
      const result = await app.acquireTokenSilent({ account, scopes: SCOPES });
      signal.throwIfAborted();
      if (!result?.accessToken || result.account?.homeAccountId !== credentials.homeAccountId) throw new MicrosoftError('REAUTH');
      return { accessToken: result.accessToken, homeAccountId: credentials.homeAccountId, cache: app.getTokenCache().serialize() };
    } catch (error) {
      if (signal.aborted) throw new MicrosoftError('CANCELLED');
      if (error instanceof MicrosoftError) throw error;
      const code = error && typeof error === 'object' && 'errorCode' in error ? error.errorCode : '';
      throw new MicrosoftError(['interaction_required', 'invalid_grant', 'no_tokens_found', 'no_account_in_silent_request'].includes(String(code)) ? 'REAUTH' : 'NETWORK');
    }
  }
}
