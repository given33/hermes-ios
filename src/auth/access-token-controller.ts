import type {
  HermesAccessTokenProvider,
  HermesAccessTokenRequest,
} from '../api/HermesApiClient';
import type { SavedConnection } from './credential-contract';
import type { SessionTokenWriter } from './credential-store';
import { MobileAuthApiError, type MobileAuthSession } from './mobile-auth';

export interface AccessTokenControllerDependencies {
  store: SessionTokenWriter;
  refresh(refreshToken: string): Promise<MobileAuthSession>;
  onSessionRefreshed?(session: MobileAuthSession): void;
  now?: () => number;
  refreshLeewaySeconds?: number;
}

export class AccessTokenController implements HermesAccessTokenProvider {
  private accessToken: string;
  private refreshToken: string;
  private expiresAt: number;
  private refreshInFlight: Promise<string> | null = null;
  private refreshBlockedUntil = 0;
  private refreshFailure: unknown = null;
  private refreshFailureCount = 0;
  private disposed = false;
  private readonly now: () => number;
  private readonly refreshLeewaySeconds: number;

  constructor(
    connection: SavedConnection,
    private readonly dependencies: AccessTokenControllerDependencies,
  ) {
    this.accessToken = connection.accessToken;
    this.refreshToken = connection.refreshToken;
    this.expiresAt = connection.expiresAt;
    this.now = dependencies.now ?? (() => Date.now() / 1000);
    this.refreshLeewaySeconds = dependencies.refreshLeewaySeconds ?? 60;
  }

  getCurrentAccessToken(): string {
    return this.accessToken;
  }

  async getAccessToken(request: HermesAccessTokenRequest = {}): Promise<string> {
    if (this.disposed) throw new Error('Hermes session is no longer active');
    if (
      request.forceRefresh
      && request.rejectedToken !== undefined
      && request.rejectedToken !== this.accessToken
    ) {
      return this.accessToken;
    }
    const expiresSoon = this.expiresAt <= this.now() + this.refreshLeewaySeconds;
    if (!request.forceRefresh && !expiresSoon) return this.accessToken;
    if (this.refreshFailure !== null && this.now() < this.refreshBlockedUntil) {
      throw this.refreshFailure;
    }
    return this.refreshAccessToken();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.refreshInFlight?.catch(() => undefined);
  }

  private refreshAccessToken(): Promise<string> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const refresh = this.performRefresh();
    this.refreshInFlight = refresh;
    void refresh.finally(() => {
      if (this.refreshInFlight === refresh) this.refreshInFlight = null;
    }).catch(() => undefined);
    return refresh;
  }

  private async performRefresh(): Promise<string> {
    try {
      const session = await this.dependencies.refresh(this.refreshToken);
      if (this.disposed) throw new Error('Hermes session is no longer active');
      if (session.expiresAt <= this.now()) {
        throw new Error('Hermes returned an expired access token');
      }
      await this.dependencies.store.saveSessionTokens(
        session.accessToken,
        session.refreshToken,
        session.expiresAt,
      );
      if (this.disposed) throw new Error('Hermes session is no longer active');
      this.accessToken = session.accessToken;
      this.refreshToken = session.refreshToken;
      this.expiresAt = session.expiresAt;
      this.refreshBlockedUntil = 0;
      this.refreshFailure = null;
      this.refreshFailureCount = 0;
      this.dependencies.onSessionRefreshed?.(session);
      return this.accessToken;
    } catch (error) {
      if (!this.disposed) {
        this.refreshFailureCount += 1;
        this.refreshBlockedUntil = this.now() + refreshBackoffSeconds(
          error,
          this.refreshFailureCount,
        );
        this.refreshFailure = error;
      }
      throw error;
    }
  }
}

function refreshBackoffSeconds(error: unknown, attempt: number): number {
  const status = error instanceof MobileAuthApiError ? error.status : null;
  const exponent = Math.min(Math.max(attempt - 1, 0), 3);
  if (status === 429) return Math.min(5 * 60, 60 * (2 ** exponent));
  if (status !== null && status >= 500) return Math.min(60, 15 * (2 ** exponent));
  return Math.min(30, 5 * (2 ** exponent));
}
