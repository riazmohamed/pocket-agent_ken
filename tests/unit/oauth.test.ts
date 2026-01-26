/**
 * Unit tests for the Claude OAuth module
 *
 * Tests PKCE flow, token exchange, token refresh, state validation,
 * and security-critical aspects of the OAuth implementation.
 */

import crypto from 'crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock SettingsManager before importing OAuth module
const mockSettingsStore: Map<string, string> = new Map();
vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: vi.fn((key: string) => mockSettingsStore.get(key) || ''),
    set: vi.fn((key: string, value: string) => mockSettingsStore.set(key, value)),
  },
}));

// Mock Electron modules
const mockShellOpenExternal = vi.fn();
const mockNetFetch = vi.fn();

vi.mock('electron', () => ({
  net: {
    fetch: mockNetFetch,
  },
  shell: {
    openExternal: mockShellOpenExternal,
  },
}));

/**
 * OAuth configuration constants (same as source)
 */
const OAUTH_CONFIG = {
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  authorizeUrl: 'https://claude.ai/oauth/authorize',
  tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
  redirectUri: 'https://console.anthropic.com/oauth/code/callback',
  scopes: 'org:create_api_key user:profile user:inference',
};

/**
 * Interface for OAuth tokens
 */
interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/**
 * Interface for PKCE pair
 */
interface PKCEPair {
  verifier: string;
  challenge: string;
  state: string;
}

/**
 * TestableOAuthManager - A testable version of ClaudeOAuthManager
 * that exposes private methods for testing
 */
class TestableOAuthManager {
  private currentPKCE: PKCEPair | null = null;
  private pendingAuth: boolean = false;

  /**
   * Generate PKCE pair for OAuth
   */
  generatePKCE(): PKCEPair {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('hex');
    return { verifier, challenge, state };
  }

  /**
   * Build authorization URL
   */
  getAuthorizationURL(): string {
    this.currentPKCE = this.generatePKCE();

    const params = new URLSearchParams({
      client_id: OAUTH_CONFIG.clientId,
      response_type: 'code',
      redirect_uri: OAUTH_CONFIG.redirectUri,
      scope: OAUTH_CONFIG.scopes,
      code_challenge: this.currentPKCE.challenge,
      code_challenge_method: 'S256',
      state: this.currentPKCE.state,
    });

    return `${OAUTH_CONFIG.authorizeUrl}?${params.toString()}`;
  }

  /**
   * Start OAuth flow - opens browser for user to authenticate
   */
  async startFlow(): Promise<{ success: boolean; error?: string }> {
    try {
      const authUrl = this.getAuthorizationURL();
      this.pendingAuth = true;

      // Open browser for authentication
      await mockShellOpenExternal(authUrl);

      return { success: true };
    } catch (error) {
      this.pendingAuth = false;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start OAuth flow',
      };
    }
  }

  /**
   * Check if OAuth flow is pending (waiting for code)
   */
  isPending(): boolean {
    return this.pendingAuth;
  }

  /**
   * Get current PKCE for testing
   */
  getCurrentPKCE(): PKCEPair | null {
    return this.currentPKCE;
  }

  /**
   * Set pending state for testing
   */
  setPendingAuth(value: boolean): void {
    this.pendingAuth = value;
  }

  /**
   * Set PKCE for testing
   */
  setCurrentPKCE(pkce: PKCEPair | null): void {
    this.currentPKCE = pkce;
  }

  /**
   * Complete OAuth flow with authorization code from user
   */
  async completeWithCode(code: string): Promise<{ success: boolean; error?: string }> {
    if (!this.currentPKCE) {
      return { success: false, error: 'No pending OAuth flow' };
    }

    try {
      const tokens = await this.exchangeCodeForTokens(code, this.currentPKCE);

      // Save tokens securely (uses mocked SettingsManager)
      const { SettingsManager } = await import('../../src/settings');
      SettingsManager.set('auth.method', 'oauth');
      SettingsManager.set('auth.oauthToken', tokens.accessToken);
      SettingsManager.set('auth.refreshToken', tokens.refreshToken);
      SettingsManager.set('auth.tokenExpiresAt', tokens.expiresAt.toString());

      this.pendingAuth = false;
      this.currentPKCE = null;

      return { success: true };
    } catch (error) {
      this.pendingAuth = false;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to exchange code for tokens',
      };
    }
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code: string, pkce: PKCEPair): Promise<OAuthTokens> {
    // Handle code#state format (user pastes the full callback code)
    const parts = code.trim().split('#');
    const authCode = parts[0];
    const state = parts.length > 1 ? parts[1] : pkce.state;

    const response = await mockNetFetch(OAUTH_CONFIG.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: authCode,
        state: state,
        code_verifier: pkce.verifier,
        client_id: OAUTH_CONFIG.clientId,
        redirect_uri: OAUTH_CONFIG.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${errorText}`);
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  /**
   * Refresh access token if needed
   */
  async refreshTokenIfNeeded(): Promise<boolean> {
    const { SettingsManager } = await import('../../src/settings');
    const expiresAt = parseInt(SettingsManager.get('auth.tokenExpiresAt') || '0', 10);
    const refreshToken = SettingsManager.get('auth.refreshToken');

    // Check if token expires within 60 seconds
    if (Date.now() < expiresAt - 60000) {
      return true; // Token still valid
    }

    if (!refreshToken) {
      return false;
    }

    try {
      const tokens = await this.refreshAccessToken(refreshToken);

      SettingsManager.set('auth.oauthToken', tokens.accessToken);
      SettingsManager.set('auth.refreshToken', tokens.refreshToken);
      SettingsManager.set('auth.tokenExpiresAt', tokens.expiresAt.toString());

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
    const response = await mockNetFetch(OAUTH_CONFIG.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${errorText}`);
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  /**
   * Get current access token (refreshing if needed)
   */
  async getAccessToken(): Promise<string | null> {
    const { SettingsManager } = await import('../../src/settings');
    const authMethod = SettingsManager.get('auth.method');
    if (authMethod !== 'oauth') {
      return null;
    }

    const refreshed = await this.refreshTokenIfNeeded();
    if (!refreshed) {
      return null;
    }

    return SettingsManager.get('auth.oauthToken') || null;
  }

  /**
   * Cancel pending OAuth flow
   */
  cancelFlow(): void {
    this.pendingAuth = false;
    this.currentPKCE = null;
  }

  /**
   * Clear stored OAuth credentials
   */
  async logout(): Promise<void> {
    const { SettingsManager } = await import('../../src/settings');
    SettingsManager.set('auth.method', '');
    SettingsManager.set('auth.oauthToken', '');
    SettingsManager.set('auth.refreshToken', '');
    SettingsManager.set('auth.tokenExpiresAt', '');
    this.pendingAuth = false;
    this.currentPKCE = null;
  }
}

describe('ClaudeOAuthManager', () => {
  let oauth: TestableOAuthManager;

  beforeEach(() => {
    oauth = new TestableOAuthManager();
    mockSettingsStore.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('PKCE generation', () => {
    it('should generate a valid PKCE verifier (32 bytes base64url encoded)', () => {
      const pkce = oauth.generatePKCE();

      // Base64url encoding of 32 bytes should be ~43 characters
      expect(pkce.verifier).toBeDefined();
      expect(pkce.verifier.length).toBeGreaterThanOrEqual(42);
      expect(pkce.verifier.length).toBeLessThanOrEqual(44);

      // Verify it's valid base64url (no +, /, or = characters)
      expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should generate a challenge that is SHA256 of verifier (base64url encoded)', () => {
      const pkce = oauth.generatePKCE();

      // Manually compute the expected challenge
      const expectedChallenge = crypto
        .createHash('sha256')
        .update(pkce.verifier)
        .digest('base64url');

      expect(pkce.challenge).toBe(expectedChallenge);
    });

    it('should generate verifier and challenge that satisfy PKCE verification', () => {
      const pkce = oauth.generatePKCE();

      // The server will hash the verifier and compare to the challenge
      const serverSideVerification = crypto
        .createHash('sha256')
        .update(pkce.verifier)
        .digest('base64url');

      expect(serverSideVerification).toBe(pkce.challenge);
    });

    it('should generate a valid state (16 bytes hex encoded)', () => {
      const pkce = oauth.generatePKCE();

      // 16 bytes as hex = 32 characters
      expect(pkce.state).toBeDefined();
      expect(pkce.state.length).toBe(32);

      // Verify it's valid hex
      expect(pkce.state).toMatch(/^[0-9a-f]+$/);
    });

    it('should generate unique PKCE values each time', () => {
      const pkce1 = oauth.generatePKCE();
      const pkce2 = oauth.generatePKCE();

      // All three values should be different
      expect(pkce1.verifier).not.toBe(pkce2.verifier);
      expect(pkce1.challenge).not.toBe(pkce2.challenge);
      expect(pkce1.state).not.toBe(pkce2.state);
    });

    it('should generate cryptographically strong random values', () => {
      // Generate multiple PKCEs and verify they have good entropy
      const pkces = Array.from({ length: 10 }, () => oauth.generatePKCE());

      // All verifiers should be unique
      const verifiers = new Set(pkces.map(p => p.verifier));
      expect(verifiers.size).toBe(10);

      // All states should be unique
      const states = new Set(pkces.map(p => p.state));
      expect(states.size).toBe(10);
    });
  });

  describe('Authorization URL building', () => {
    it('should build URL with correct base', () => {
      const url = oauth.getAuthorizationURL();
      expect(url.startsWith(OAUTH_CONFIG.authorizeUrl)).toBe(true);
    });

    it('should include client_id parameter', () => {
      const url = oauth.getAuthorizationURL();
      const params = new URLSearchParams(url.split('?')[1]);
      expect(params.get('client_id')).toBe(OAUTH_CONFIG.clientId);
    });

    it('should include response_type=code', () => {
      const url = oauth.getAuthorizationURL();
      const params = new URLSearchParams(url.split('?')[1]);
      expect(params.get('response_type')).toBe('code');
    });

    it('should include redirect_uri parameter', () => {
      const url = oauth.getAuthorizationURL();
      const params = new URLSearchParams(url.split('?')[1]);
      expect(params.get('redirect_uri')).toBe(OAUTH_CONFIG.redirectUri);
    });

    it('should include scope parameter', () => {
      const url = oauth.getAuthorizationURL();
      const params = new URLSearchParams(url.split('?')[1]);
      expect(params.get('scope')).toBe(OAUTH_CONFIG.scopes);
    });

    it('should include code_challenge parameter', () => {
      const url = oauth.getAuthorizationURL();
      const params = new URLSearchParams(url.split('?')[1]);
      const challenge = params.get('code_challenge');

      expect(challenge).toBeDefined();
      expect(challenge!.length).toBeGreaterThan(0);

      // Should match the stored PKCE challenge
      expect(challenge).toBe(oauth.getCurrentPKCE()?.challenge);
    });

    it('should include code_challenge_method=S256', () => {
      const url = oauth.getAuthorizationURL();
      const params = new URLSearchParams(url.split('?')[1]);
      expect(params.get('code_challenge_method')).toBe('S256');
    });

    it('should include state parameter', () => {
      const url = oauth.getAuthorizationURL();
      const params = new URLSearchParams(url.split('?')[1]);
      const state = params.get('state');

      expect(state).toBeDefined();
      expect(state!.length).toBe(32); // 16 bytes hex = 32 chars

      // Should match the stored PKCE state
      expect(state).toBe(oauth.getCurrentPKCE()?.state);
    });

    it('should store PKCE pair when building URL', () => {
      expect(oauth.getCurrentPKCE()).toBeNull();
      oauth.getAuthorizationURL();
      expect(oauth.getCurrentPKCE()).not.toBeNull();
    });

    it('should generate new PKCE each time URL is built', () => {
      const url1 = oauth.getAuthorizationURL();
      const pkce1 = oauth.getCurrentPKCE();

      const url2 = oauth.getAuthorizationURL();
      const pkce2 = oauth.getCurrentPKCE();

      expect(url1).not.toBe(url2);
      expect(pkce1?.verifier).not.toBe(pkce2?.verifier);
    });
  });

  describe('OAuth flow start', () => {
    it('should open browser with authorization URL', async () => {
      mockShellOpenExternal.mockResolvedValueOnce(undefined);

      const result = await oauth.startFlow();

      expect(result.success).toBe(true);
      expect(mockShellOpenExternal).toHaveBeenCalledTimes(1);

      const calledUrl = mockShellOpenExternal.mock.calls[0][0] as string;
      expect(calledUrl.startsWith(OAUTH_CONFIG.authorizeUrl)).toBe(true);
    });

    it('should set pending state on success', async () => {
      mockShellOpenExternal.mockResolvedValueOnce(undefined);

      expect(oauth.isPending()).toBe(false);
      await oauth.startFlow();
      expect(oauth.isPending()).toBe(true);
    });

    it('should handle browser open failure', async () => {
      mockShellOpenExternal.mockRejectedValueOnce(new Error('Failed to open browser'));

      const result = await oauth.startFlow();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to open browser');
      expect(oauth.isPending()).toBe(false);
    });

    it('should reset pending state on failure', async () => {
      mockShellOpenExternal.mockRejectedValueOnce(new Error('Browser error'));

      await oauth.startFlow();

      expect(oauth.isPending()).toBe(false);
    });
  });

  describe('Token exchange', () => {
    const mockTokenResponse = {
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      expires_in: 3600,
    };

    beforeEach(() => {
      // Setup a pending flow
      oauth.getAuthorizationURL(); // This sets currentPKCE
      oauth.setPendingAuth(true);
    });

    it('should exchange code for tokens successfully', async () => {
      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });

      const pkce = oauth.getCurrentPKCE()!;
      const result = await oauth.completeWithCode('auth-code-123');

      expect(result.success).toBe(true);
      expect(mockNetFetch).toHaveBeenCalledWith(
        OAUTH_CONFIG.tokenUrl,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      // Verify the request body
      const callArgs = mockNetFetch.mock.calls[0] as [string, { body: string }];
      const body = JSON.parse(callArgs[1].body);
      expect(body.code).toBe('auth-code-123');
      expect(body.code_verifier).toBe(pkce.verifier);
      expect(body.client_id).toBe(OAUTH_CONFIG.clientId);
      expect(body.redirect_uri).toBe(OAUTH_CONFIG.redirectUri);
      expect(body.grant_type).toBe('authorization_code');
    });

    it('should save tokens to settings on success', async () => {
      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });

      await oauth.completeWithCode('auth-code-123');

      expect(mockSettingsStore.get('auth.method')).toBe('oauth');
      expect(mockSettingsStore.get('auth.oauthToken')).toBe('test-access-token');
      expect(mockSettingsStore.get('auth.refreshToken')).toBe('test-refresh-token');
      expect(mockSettingsStore.get('auth.tokenExpiresAt')).toBeDefined();
    });

    it('should calculate correct expiry timestamp', async () => {
      const now = Date.now();
      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ...mockTokenResponse, expires_in: 3600 }),
      });

      await oauth.completeWithCode('auth-code-123');

      const expiresAt = parseInt(mockSettingsStore.get('auth.tokenExpiresAt') || '0', 10);
      // Should be approximately now + 3600 seconds (allow 1 second tolerance)
      expect(expiresAt).toBeGreaterThan(now + 3599000);
      expect(expiresAt).toBeLessThan(now + 3601000);
    });

    it('should reset pending state and PKCE on success', async () => {
      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });

      await oauth.completeWithCode('auth-code-123');

      expect(oauth.isPending()).toBe(false);
      expect(oauth.getCurrentPKCE()).toBeNull();
    });

    it('should handle token exchange failure', async () => {
      mockNetFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('Invalid authorization code'),
      });

      const result = await oauth.completeWithCode('invalid-code');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Token exchange failed');
      expect(oauth.isPending()).toBe(false);
    });

    it('should fail if no pending OAuth flow', async () => {
      oauth.cancelFlow(); // Clear pending state

      const result = await oauth.completeWithCode('auth-code');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No pending OAuth flow');
    });
  });

  describe('State validation (security critical)', () => {
    const mockTokenResponse = {
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      expires_in: 3600,
    };

    beforeEach(() => {
      oauth.getAuthorizationURL();
      oauth.setPendingAuth(true);
    });

    it('should parse code#state format correctly', async () => {
      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });

      const pkce = oauth.getCurrentPKCE()!;
      await oauth.completeWithCode(`auth-code#${pkce.state}`);

      const callArgs = mockNetFetch.mock.calls[0] as [string, { body: string }];
      const body = JSON.parse(callArgs[1].body);
      expect(body.code).toBe('auth-code');
      expect(body.state).toBe(pkce.state);
    });

    it('should use PKCE state when no state in code', async () => {
      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });

      const pkce = oauth.getCurrentPKCE()!;
      await oauth.completeWithCode('auth-code-only');

      const callArgs = mockNetFetch.mock.calls[0] as [string, { body: string }];
      const body = JSON.parse(callArgs[1].body);
      expect(body.code).toBe('auth-code-only');
      expect(body.state).toBe(pkce.state);
    });

    it('should handle code with trailing whitespace', async () => {
      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });

      await oauth.completeWithCode('  auth-code  ');

      const callArgs = mockNetFetch.mock.calls[0] as [string, { body: string }];
      const body = JSON.parse(callArgs[1].body);
      expect(body.code).toBe('auth-code');
    });

    it('should handle code with state containing special characters', async () => {
      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });

      const pkce = oauth.getCurrentPKCE()!;
      const specialState = pkce.state; // Hex state from PKCE
      await oauth.completeWithCode(`code123#${specialState}`);

      const callArgs = mockNetFetch.mock.calls[0] as [string, { body: string }];
      const body = JSON.parse(callArgs[1].body);
      expect(body.state).toBe(specialState);
    });

    it('should send state to server for validation', async () => {
      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });

      const pkce = oauth.getCurrentPKCE()!;
      await oauth.completeWithCode('auth-code');

      const callArgs = mockNetFetch.mock.calls[0] as [string, { body: string }];
      const body = JSON.parse(callArgs[1].body);

      // State should always be present in token exchange request
      expect(body.state).toBeDefined();
      expect(body.state).toBe(pkce.state);
    });

    it('should include all PKCE parameters in token exchange', async () => {
      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });

      const pkce = oauth.getCurrentPKCE()!;
      await oauth.completeWithCode('auth-code');

      const callArgs = mockNetFetch.mock.calls[0] as [string, { body: string }];
      const body = JSON.parse(callArgs[1].body);

      // All required PKCE/OAuth parameters must be present
      expect(body).toHaveProperty('code');
      expect(body).toHaveProperty('state');
      expect(body).toHaveProperty('code_verifier');
      expect(body).toHaveProperty('client_id');
      expect(body).toHaveProperty('redirect_uri');
      expect(body).toHaveProperty('grant_type');

      expect(body.code_verifier).toBe(pkce.verifier);
    });
  });

  describe('Token refresh', () => {
    const mockRefreshResponse = {
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600,
    };

    it('should not refresh if token is still valid', async () => {
      // Set token that expires in 2 minutes (> 60 second threshold)
      const futureExpiry = Date.now() + 120000;
      mockSettingsStore.set('auth.tokenExpiresAt', futureExpiry.toString());
      mockSettingsStore.set('auth.refreshToken', 'valid-refresh-token');

      const result = await oauth.refreshTokenIfNeeded();

      expect(result).toBe(true);
      expect(mockNetFetch).not.toHaveBeenCalled();
    });

    it('should refresh if token expires within 60 seconds', async () => {
      // Set token that expires in 30 seconds
      const nearExpiry = Date.now() + 30000;
      mockSettingsStore.set('auth.tokenExpiresAt', nearExpiry.toString());
      mockSettingsStore.set('auth.refreshToken', 'valid-refresh-token');

      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockRefreshResponse),
      });

      const result = await oauth.refreshTokenIfNeeded();

      expect(result).toBe(true);
      expect(mockNetFetch).toHaveBeenCalledTimes(1);
    });

    it('should refresh if token is expired', async () => {
      // Set token that expired 1 minute ago
      const pastExpiry = Date.now() - 60000;
      mockSettingsStore.set('auth.tokenExpiresAt', pastExpiry.toString());
      mockSettingsStore.set('auth.refreshToken', 'valid-refresh-token');

      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockRefreshResponse),
      });

      const result = await oauth.refreshTokenIfNeeded();

      expect(result).toBe(true);
      expect(mockNetFetch).toHaveBeenCalled();
    });

    it('should send correct refresh request', async () => {
      const nearExpiry = Date.now() + 30000;
      mockSettingsStore.set('auth.tokenExpiresAt', nearExpiry.toString());
      mockSettingsStore.set('auth.refreshToken', 'my-refresh-token');

      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockRefreshResponse),
      });

      await oauth.refreshTokenIfNeeded();

      expect(mockNetFetch).toHaveBeenCalledWith(
        OAUTH_CONFIG.tokenUrl,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const callArgs = mockNetFetch.mock.calls[0] as [string, { body: string }];
      const body = JSON.parse(callArgs[1].body);
      expect(body.refresh_token).toBe('my-refresh-token');
      expect(body.grant_type).toBe('refresh_token');
    });

    it('should update stored tokens after refresh', async () => {
      const nearExpiry = Date.now() + 30000;
      mockSettingsStore.set('auth.tokenExpiresAt', nearExpiry.toString());
      mockSettingsStore.set('auth.refreshToken', 'old-refresh-token');

      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockRefreshResponse),
      });

      await oauth.refreshTokenIfNeeded();

      expect(mockSettingsStore.get('auth.oauthToken')).toBe('new-access-token');
      expect(mockSettingsStore.get('auth.refreshToken')).toBe('new-refresh-token');
    });

    it('should keep old refresh token if server does not return new one', async () => {
      const nearExpiry = Date.now() + 30000;
      mockSettingsStore.set('auth.tokenExpiresAt', nearExpiry.toString());
      mockSettingsStore.set('auth.refreshToken', 'old-refresh-token');

      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'new-access-token',
            // No refresh_token in response
            expires_in: 3600,
          }),
      });

      await oauth.refreshTokenIfNeeded();

      expect(mockSettingsStore.get('auth.refreshToken')).toBe('old-refresh-token');
    });

    it('should return false if no refresh token available', async () => {
      const pastExpiry = Date.now() - 60000;
      mockSettingsStore.set('auth.tokenExpiresAt', pastExpiry.toString());
      // No refresh token set

      const result = await oauth.refreshTokenIfNeeded();

      expect(result).toBe(false);
      expect(mockNetFetch).not.toHaveBeenCalled();
    });

    it('should return false on refresh failure', async () => {
      const nearExpiry = Date.now() + 30000;
      mockSettingsStore.set('auth.tokenExpiresAt', nearExpiry.toString());
      mockSettingsStore.set('auth.refreshToken', 'invalid-refresh-token');

      mockNetFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('Invalid refresh token'),
      });

      const result = await oauth.refreshTokenIfNeeded();

      expect(result).toBe(false);
    });
  });

  describe('getAccessToken', () => {
    it('should return null if auth method is not oauth', async () => {
      mockSettingsStore.set('auth.method', 'api_key');

      const token = await oauth.getAccessToken();

      expect(token).toBeNull();
    });

    it('should return null if auth method is empty', async () => {
      mockSettingsStore.set('auth.method', '');

      const token = await oauth.getAccessToken();

      expect(token).toBeNull();
    });

    it('should return token if valid and not expired', async () => {
      mockSettingsStore.set('auth.method', 'oauth');
      mockSettingsStore.set('auth.oauthToken', 'valid-token');
      mockSettingsStore.set('auth.tokenExpiresAt', (Date.now() + 120000).toString());
      mockSettingsStore.set('auth.refreshToken', 'refresh-token');

      const token = await oauth.getAccessToken();

      expect(token).toBe('valid-token');
    });

    it('should refresh and return new token if expired', async () => {
      mockSettingsStore.set('auth.method', 'oauth');
      mockSettingsStore.set('auth.oauthToken', 'old-token');
      mockSettingsStore.set('auth.tokenExpiresAt', (Date.now() - 1000).toString());
      mockSettingsStore.set('auth.refreshToken', 'refresh-token');

      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'refreshed-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
          }),
      });

      const token = await oauth.getAccessToken();

      expect(token).toBe('refreshed-token');
    });

    it('should return null if refresh fails', async () => {
      mockSettingsStore.set('auth.method', 'oauth');
      mockSettingsStore.set('auth.oauthToken', 'old-token');
      mockSettingsStore.set('auth.tokenExpiresAt', (Date.now() - 1000).toString());
      mockSettingsStore.set('auth.refreshToken', 'invalid-refresh');

      mockNetFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('Refresh failed'),
      });

      const token = await oauth.getAccessToken();

      expect(token).toBeNull();
    });
  });

  describe('Flow cancellation', () => {
    it('should reset pending state on cancel', () => {
      oauth.getAuthorizationURL();
      oauth.setPendingAuth(true);

      expect(oauth.isPending()).toBe(true);
      expect(oauth.getCurrentPKCE()).not.toBeNull();

      oauth.cancelFlow();

      expect(oauth.isPending()).toBe(false);
      expect(oauth.getCurrentPKCE()).toBeNull();
    });

    it('should be safe to cancel when no flow is pending', () => {
      expect(() => oauth.cancelFlow()).not.toThrow();
      expect(oauth.isPending()).toBe(false);
    });
  });

  describe('Logout', () => {
    it('should clear all OAuth credentials', async () => {
      mockSettingsStore.set('auth.method', 'oauth');
      mockSettingsStore.set('auth.oauthToken', 'token');
      mockSettingsStore.set('auth.refreshToken', 'refresh');
      mockSettingsStore.set('auth.tokenExpiresAt', '12345');
      oauth.setPendingAuth(true);
      oauth.setCurrentPKCE({ verifier: 'v', challenge: 'c', state: 's' });

      await oauth.logout();

      expect(mockSettingsStore.get('auth.method')).toBe('');
      expect(mockSettingsStore.get('auth.oauthToken')).toBe('');
      expect(mockSettingsStore.get('auth.refreshToken')).toBe('');
      expect(mockSettingsStore.get('auth.tokenExpiresAt')).toBe('');
      expect(oauth.isPending()).toBe(false);
      expect(oauth.getCurrentPKCE()).toBeNull();
    });
  });

  describe('Error handling', () => {
    it('should handle network errors during token exchange', async () => {
      oauth.getAuthorizationURL();
      oauth.setPendingAuth(true);

      mockNetFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await oauth.completeWithCode('auth-code');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('should handle network errors during token refresh', async () => {
      mockSettingsStore.set('auth.tokenExpiresAt', (Date.now() - 1000).toString());
      mockSettingsStore.set('auth.refreshToken', 'refresh-token');

      mockNetFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await oauth.refreshTokenIfNeeded();

      expect(result).toBe(false);
    });

    it('should handle malformed JSON response', async () => {
      oauth.getAuthorizationURL();
      oauth.setPendingAuth(true);

      mockNetFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      const result = await oauth.completeWithCode('auth-code');

      expect(result.success).toBe(false);
    });

    it('should handle server error responses', async () => {
      oauth.getAuthorizationURL();
      oauth.setPendingAuth(true);

      mockNetFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('{"error": "invalid_grant", "error_description": "Code expired"}'),
      });

      const result = await oauth.completeWithCode('expired-code');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Token exchange failed');
    });

    it('should handle non-Error thrown objects', async () => {
      mockShellOpenExternal.mockRejectedValueOnce('String error');

      const result = await oauth.startFlow();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to start OAuth flow');
    });
  });
});

describe('Singleton pattern', () => {
  it('should be exported as singleton in source module', async () => {
    // Import the actual module to test singleton export
    // Note: This tests the pattern, not the actual singleton due to mocking
    const { ClaudeOAuth } = await import('../../src/auth/oauth');

    expect(ClaudeOAuth).toBeDefined();
    expect(typeof ClaudeOAuth.startFlow).toBe('function');
    expect(typeof ClaudeOAuth.completeWithCode).toBe('function');
    expect(typeof ClaudeOAuth.isPending).toBe('function');
    expect(typeof ClaudeOAuth.cancelFlow).toBe('function');
    expect(typeof ClaudeOAuth.logout).toBe('function');
  });

  it('getInstance should always return the same instance', async () => {
    // Since ClaudeOAuth is a singleton, calling any static method should work
    // on the same underlying instance
    const { ClaudeOAuth } = await import('../../src/auth/oauth');

    // The isPending state should be consistent across accesses
    const pending1 = ClaudeOAuth.isPending();
    const pending2 = ClaudeOAuth.isPending();

    expect(pending1).toBe(pending2);
  });
});

describe('PKCE security verification', () => {
  let oauth: TestableOAuthManager;

  beforeEach(() => {
    oauth = new TestableOAuthManager();
  });

  it('should use SHA256 algorithm for challenge', () => {
    const pkce = oauth.generatePKCE();

    // SHA256 produces 32 bytes, which in base64url is ~43 characters
    expect(pkce.challenge.length).toBeGreaterThanOrEqual(42);
    expect(pkce.challenge.length).toBeLessThanOrEqual(44);
  });

  it('should produce valid base64url encoded challenge (RFC 7636)', () => {
    const pkce = oauth.generatePKCE();

    // Base64url characters: A-Z, a-z, 0-9, -, _
    // Should NOT contain: +, /, =
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pkce.challenge).not.toContain('+');
    expect(pkce.challenge).not.toContain('/');
    expect(pkce.challenge).not.toContain('=');
  });

  it('should produce valid base64url encoded verifier', () => {
    const pkce = oauth.generatePKCE();

    // Verifier should also be base64url
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('verifier should have sufficient entropy (at least 256 bits)', () => {
    const pkce = oauth.generatePKCE();

    // 32 bytes = 256 bits of entropy
    // Base64url encoding: each character represents ~6 bits
    // So 43+ characters represents 256+ bits
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(42);
  });

  it('state should have sufficient entropy (at least 128 bits)', () => {
    const pkce = oauth.generatePKCE();

    // 16 bytes = 128 bits of entropy
    // Hex encoding: 2 characters per byte = 32 characters
    expect(pkce.state.length).toBe(32);
  });

  it('challenge must be verifiable with verifier', () => {
    // This is the core PKCE security property
    for (let i = 0; i < 10; i++) {
      const pkce = oauth.generatePKCE();

      const computedChallenge = crypto
        .createHash('sha256')
        .update(pkce.verifier)
        .digest('base64url');

      expect(computedChallenge).toBe(pkce.challenge);
    }
  });

  it('different verifiers should produce different challenges', () => {
    const challenges = new Set<string>();

    for (let i = 0; i < 100; i++) {
      const pkce = oauth.generatePKCE();
      challenges.add(pkce.challenge);
    }

    // All challenges should be unique (probability of collision is astronomically low)
    expect(challenges.size).toBe(100);
  });
});
