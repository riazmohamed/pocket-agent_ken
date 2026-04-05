/**
 * OpenAI OAuth Implementation
 *
 * Uses PKCE flow with local server callback.
 * Based on gg-coder's OpenAI OAuth implementation.
 */

import http from 'http';
import crypto from 'crypto';
import { shell } from 'electron';
import { SettingsManager } from '../settings';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const SCOPE = 'openid profile email offline_access';
const JWT_CLAIM_PATH = 'https://api.openai.com/auth';

interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId?: string;
}

class OpenAIOAuthManager {
  private static instance: OpenAIOAuthManager | null = null;
  private currentPKCE: { verifier: string; challenge: string } | null = null;
  private pendingAuth: boolean = false;

  private constructor() {}

  static getInstance(): OpenAIOAuthManager {
    if (!OpenAIOAuthManager.instance) {
      OpenAIOAuthManager.instance = new OpenAIOAuthManager();
    }
    return OpenAIOAuthManager.instance;
  }

  private generatePKCE(): { verifier: string; challenge: string } {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
  }

  private getAuthorizationURL(): string {
    this.currentPKCE = this.generatePKCE();
    const state = crypto.randomBytes(16).toString('hex');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      code_challenge: this.currentPKCE.challenge,
      code_challenge_method: 'S256',
      state,
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: 'pocket-agent',
    });

    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  async startFlow(): Promise<{ success: boolean; error?: string }> {
    try {
      const authUrl = this.getAuthorizationURL();
      this.pendingAuth = true;

      // Start local server to catch callback
      const code = await this.waitForCallback(authUrl);

      // Exchange code for tokens
      const tokens = await this.exchangeCode(code);

      // Save tokens
      SettingsManager.set('openai.auth.method', 'oauth');
      SettingsManager.set('openai.accessToken', tokens.accessToken);
      SettingsManager.set('openai.refreshToken', tokens.refreshToken);
      SettingsManager.set('openai.tokenExpiresAt', tokens.expiresAt.toString());
      if (tokens.accountId) {
        SettingsManager.set('openai.accountId', tokens.accountId);
      }

      this.pendingAuth = false;
      this.currentPKCE = null;

      console.log('[OpenAI OAuth] Successfully authenticated');
      return { success: true };
    } catch (error) {
      this.pendingAuth = false;
      this.currentPKCE = null;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to complete OAuth flow',
      };
    }
  }

  private waitForCallback(authUrl: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let receivedCode: string | null = null;

      const server = http.createServer((req, res) => {
        const url = new URL(req.url || '', 'http://localhost');

        if (url.pathname !== '/auth/callback') {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        receivedCode = url.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          '<html><body><h1>Login successful!</h1><p>You can close this tab.</p></body></html>'
        );
        server.close();
      });

      server.on('error', reject);

      server.listen(1455, '127.0.0.1', async () => {
        try {
          await shell.openExternal(authUrl);
        } catch {
          // Ignore external open error
        }
      });

      server.on('close', () => {
        if (receivedCode) {
          resolve(receivedCode);
        } else {
          reject(new Error('Server closed without receiving code'));
        }
      });

      setTimeout(() => {
        if (!receivedCode) {
          server.close();
        }
      }, 120_000);
    });
  }

  private async exchangeCode(code: string): Promise<OAuthCredentials> {
    if (!this.currentPKCE) {
      throw new Error('No pending OAuth flow');
    }

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: this.currentPKCE.verifier,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token exchange failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const creds: OAuthCredentials = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    // Extract accountId from JWT
    const accountId = this.getAccountId(creds.accessToken);
    if (accountId) {
      creds.accountId = accountId;
    }

    return creds;
  }

  private getAccountId(accessToken: string): string | null {
    try {
      const parts = accessToken.split('.');
      if (parts.length !== 3) return null;
      const decoded = Buffer.from(
        parts[1].replace(/-/g, '+').replace(/_/g, '/'),
        'base64'
      ).toString('utf8');
      const payload = JSON.parse(decoded) as Record<string, unknown>;
      const auth = payload[JWT_CLAIM_PATH as keyof typeof payload] as
        | { chatgpt_account_id?: string }
        | undefined;
      const accountId = auth?.chatgpt_account_id;
      return typeof accountId === 'string' && accountId.length > 0 ? accountId : null;
    } catch {
      return null;
    }
  }

  async refreshTokenIfNeeded(): Promise<boolean> {
    const expiresAt = parseInt(SettingsManager.get('openai.tokenExpiresAt') || '0', 10);
    const refreshToken = SettingsManager.get('openai.refreshToken');

    // Check if token expires within 60 seconds
    if (Date.now() < expiresAt - 60000) {
      return true;
    }

    if (!refreshToken) {
      return false;
    }

    try {
      const tokens = await this.refreshAccessToken(refreshToken);
      SettingsManager.set('openai.accessToken', tokens.accessToken);
      SettingsManager.set('openai.refreshToken', tokens.refreshToken);
      SettingsManager.set('openai.tokenExpiresAt', tokens.expiresAt.toString());
      if (tokens.accountId) {
        SettingsManager.set('openai.accountId', tokens.accountId);
      }
      console.log('[OpenAI OAuth] Token refreshed');
      return true;
    } catch (error) {
      console.error('[OpenAI OAuth] Token refresh failed:', error);
      SettingsManager.set('openai.tokenExpiresAt', '0');
      return false;
    }
  }

  private async refreshAccessToken(refreshToken: string): Promise<OAuthCredentials> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token refresh failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const creds: OAuthCredentials = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    const accountId = this.getAccountId(creds.accessToken);
    if (accountId) {
      creds.accountId = accountId;
    }

    return creds;
  }

  async getAccessToken(): Promise<string | null> {
    const authMethod = SettingsManager.get('openai.auth.method');
    if (authMethod !== 'oauth') {
      return null;
    }

    const refreshed = await this.refreshTokenIfNeeded();
    if (!refreshed) {
      return null;
    }

    return SettingsManager.get('openai.accessToken') || null;
  }

  isAuthenticated(): boolean {
    const authMethod = SettingsManager.get('openai.auth.method');
    const accessToken = SettingsManager.get('openai.accessToken');
    return authMethod === 'oauth' && !!accessToken;
  }

  logout(): void {
    SettingsManager.set('openai.auth.method', '');
    SettingsManager.set('openai.accessToken', '');
    SettingsManager.set('openai.refreshToken', '');
    SettingsManager.set('openai.tokenExpiresAt', '');
    SettingsManager.set('openai.accountId', '');
  }
}

export const OpenAIOAuth = OpenAIOAuthManager.getInstance();
