import { BrandLogo } from '@truefoundry/trueforge-ui';
import { useState } from 'react';
import { buildLoginHref } from './authFetch';
import './authScreens.css';

/**
 * Pre-auth welcome gate. Rendered when the session probe (`/me`) is unauthenticated
 * (OIDC configured but no session cookie yet).
 */

export function GetStartedScreen() {
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = () => {
    setIsLoading(true);
    window.location.assign(buildLoginHref());
  };

  return (
    <main className="auth-screen">
      <div className="auth-screen-card">
        <BrandLogo className="auth-screen-logo" />
        <h1 className="auth-screen-title">TrueForge</h1>
        <p className="auth-screen-message">Authentication required. Please sign in to continue.</p>
        <button
          type="button"
          className="auth-screen-button"
          disabled={isLoading}
          onClick={handleLogin}
        >
          {isLoading ? 'Redirecting to login...' : 'Sign in with OAuth'}
        </button>
      </div>
    </main>
  );
}
