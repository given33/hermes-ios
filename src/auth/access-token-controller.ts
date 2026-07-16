import type {
  HermesAccessTokenProvider,
  HermesAccessTokenRequest,
} from '../api/HermesApiClient';
import type { SavedConnection } from './credential-contract';
import type { SessionTokenWriter } from './credential-store';
import type { MobileAuthSession } from './mobile-auth';

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
    if (
      request.forceRefresh
      && request.rejectedToken !== undefined
      && request.rejectedToken !== this.accessToken
    ) {
      return this.accessToken;
    }
    const expiresSoon = this.expiresAt <= this.now() + this.refreshLeewaySeconds;
    if (!request.forceRefresh && !expiresSoon) return this.accessToken;
    return this.refreshAccessToken();
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
    const session = await this.dependencies.refresh(this.refreshToken);
    if (session.expiresAt <= this.now()) {
      throw new Error('Hermes returned an expired access token');
    }
    await this.dependencies.store.saveSessionTokens(
      session.accessToken,
      session.refreshToken,
      session.expiresAt,
    );
    this.accessToken = session.accessToken;
    this.refreshToken = session.refreshToken;
    this.expiresAt = session.expiresAt;
    this.dependencies.onSessionRefreshed?.(session);
    return this.accessToken;
  }
}
