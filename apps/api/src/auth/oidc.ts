import * as client from 'openid-client';

export interface IdClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  /** Google Workspace hosted domain; absent for consumer Gmail accounts. */
  hd?: string;
  name?: string;
}

export interface LoginChecks {
  state: string;
  nonce: string;
  codeVerifier: string;
}

/** Seam for tests; the Google implementation delegates issuer/audience/nonce/expiry checks to openid-client. */
export interface OidcProvider {
  /** redirectUri overrides the default one for an agency's own domain (also registered in Google). */
  authorizationUrl(checks: LoginChecks, redirectUri?: string): Promise<URL>;
  exchange(currentUrl: URL, checks: LoginChecks): Promise<IdClaims>;
}
export const OIDC = Symbol('OIDC');

export class GoogleOidcProvider implements OidcProvider {
  private config?: Promise<client.Configuration>;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
  ) {}

  private discover(): Promise<client.Configuration> {
    this.config ??= client.discovery(
      new URL('https://accounts.google.com'),
      this.clientId,
      this.clientSecret,
    );
    return this.config;
  }

  async authorizationUrl({ state, nonce, codeVerifier }: LoginChecks, redirectUri?: string): Promise<URL> {
    return client.buildAuthorizationUrl(await this.discover(), {
      redirect_uri: redirectUri ?? this.redirectUri,
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
  }

  async exchange(currentUrl: URL, { state, nonce, codeVerifier }: LoginChecks): Promise<IdClaims> {
    const tokens = await client.authorizationCodeGrant(await this.discover(), currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedState: state,
      expectedNonce: nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims) throw new Error('ID token ausente');
    return claims as IdClaims;
  }
}

export const newLoginChecks = (): LoginChecks => ({
  state: client.randomState(),
  nonce: client.randomNonce(),
  codeVerifier: client.randomPKCECodeVerifier(),
});
