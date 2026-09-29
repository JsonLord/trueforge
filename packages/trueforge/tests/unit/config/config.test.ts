import { getPublicUiBasePath, type ServerConfiguration } from '../../../src/config';
import { resolveTrueFoundrySandboxProviderConfig } from '../../../src/truefoundry/resolveTrueFoundrySandboxProviderConfig';

/** Minimal distributed config slice for resolve tests (unused fields are irrelevant). */
function distributed(overrides: {
  TRUEFOUNDRY_SANDBOX_ENABLED?: boolean;
  TRUEFOUNDRY_SANDBOX_PROVIDER?: 'daytona' | 'truefoundry';
  TRUEFOUNDRY_SANDBOX_API_KEY?: string;
  TRUEFOUNDRY_SANDBOX_SERVER_URL?: string;
  TRUEFOUNDRY_SANDBOX_SETTINGS?: string;
}): ServerConfiguration {
  return {
    STANDALONE: false,
    TRUEFOUNDRY_SANDBOX_ENABLED: false,
    TRUEFOUNDRY_SANDBOX_PROVIDER: undefined,
    TRUEFOUNDRY_SANDBOX_API_KEY: undefined,
    TRUEFOUNDRY_SANDBOX_SERVER_URL: undefined,
    TRUEFOUNDRY_SANDBOX_SETTINGS: undefined,
    ...overrides,
  } as ServerConfiguration;
}

describe('resolveTrueFoundrySandboxProviderConfig', () => {
  it('returns undefined when sandbox is disabled', () => {
    expect(resolveTrueFoundrySandboxProviderConfig(distributed({}))).toBeUndefined();
  });

  it('returns daytona with parsed settings JSON', () => {
    expect(
      resolveTrueFoundrySandboxProviderConfig(
        distributed({
          TRUEFOUNDRY_SANDBOX_ENABLED: true,
          TRUEFOUNDRY_SANDBOX_PROVIDER: 'daytona',
          TRUEFOUNDRY_SANDBOX_API_KEY: 'dtn-key',
          TRUEFOUNDRY_SANDBOX_SETTINGS: JSON.stringify({
            snapshotName: 'snap-1',
            timeoutMs: 90_000,
            autoStopIntervalInMinutes: 10,
          }),
        }),
      ),
    ).toEqual({
      type: 'daytona',
      apiKey: 'dtn-key',
      settings: {
        snapshotName: 'snap-1',
        timeoutMs: 90_000,
        autoStopIntervalInMinutes: 10,
        autoArchiveIntervalInMinutes: 60,
        autoDeleteIntervalInMinutes: 43_200,
      },
    });
  });

  it('returns truefoundry with server URL and nats_bridge_url from settings', () => {
    expect(
      resolveTrueFoundrySandboxProviderConfig(
        distributed({
          TRUEFOUNDRY_SANDBOX_ENABLED: true,
          TRUEFOUNDRY_SANDBOX_PROVIDER: 'truefoundry',
          TRUEFOUNDRY_SANDBOX_SERVER_URL: 'http://sandbox-server',
          TRUEFOUNDRY_SANDBOX_SETTINGS: JSON.stringify({ nats_bridge_url: 'ws://nats-bridge' }),
        }),
      ),
    ).toEqual({
      type: 'truefoundry',
      serverUrl: 'http://sandbox-server',
      natsBridgeUrl: 'ws://nats-bridge',
    });
  });

  it('throws when daytona is enabled without API key', () => {
    expect(() =>
      resolveTrueFoundrySandboxProviderConfig(
        distributed({
          TRUEFOUNDRY_SANDBOX_ENABLED: true,
          TRUEFOUNDRY_SANDBOX_PROVIDER: 'daytona',
          TRUEFOUNDRY_SANDBOX_SETTINGS: JSON.stringify({ snapshotName: 'snap-1' }),
        }),
      ),
    ).toThrow(/TRUEFOUNDRY_SANDBOX_API_KEY/);
  });

  it('throws when truefoundry is enabled without server URL', () => {
    expect(() =>
      resolveTrueFoundrySandboxProviderConfig(
        distributed({
          TRUEFOUNDRY_SANDBOX_ENABLED: true,
          TRUEFOUNDRY_SANDBOX_PROVIDER: 'truefoundry',
          TRUEFOUNDRY_SANDBOX_SETTINGS: JSON.stringify({ nats_bridge_url: 'ws://nats-bridge' }),
        }),
      ),
    ).toThrow(/TRUEFOUNDRY_SANDBOX_SERVER_URL/);
  });

  it('throws when settings JSON is invalid', () => {
    expect(() =>
      resolveTrueFoundrySandboxProviderConfig(
        distributed({
          TRUEFOUNDRY_SANDBOX_ENABLED: true,
          TRUEFOUNDRY_SANDBOX_PROVIDER: 'daytona',
          TRUEFOUNDRY_SANDBOX_API_KEY: 'dtn-key',
          TRUEFOUNDRY_SANDBOX_SETTINGS: '{not-json',
        }),
      ),
    ).toThrow(/TRUEFOUNDRY_SANDBOX_SETTINGS must be valid JSON/);
  });
});

import { getPublicBaseUrl } from '../../../src/config';

describe('getPublicBaseUrl', () => {
  it('returns configured PUBLIC_BASE_URL when provided', () => {
    expect(
      getPublicBaseUrl({
        STANDALONE: true,
        NODE_ENV: 'production',
        PORT: 7860,
        PUBLIC_BASE_URL: 'https://leon4gr45-xu.hf.space',
      } as ServerConfiguration),
    ).toBe('https://leon4gr45-xu.hf.space');
  });

  it('never returns localhost or internal port when PUBLIC_BASE_URL is set in standalone production', () => {
    const url = getPublicBaseUrl({
      STANDALONE: true,
      NODE_ENV: 'production',
      PORT: 7860,
      PUBLIC_BASE_URL: 'https://leon4gr45-xu.hf.space',
    } as ServerConfiguration);
    expect(url).not.toContain('localhost');
    expect(url).not.toContain('7860');
    expect(url).not.toContain('127.0.0.1');
    expect(url).toBe('https://leon4gr45-xu.hf.space');
  });

  it('defaults to http://localhost:$PORT when PUBLIC_BASE_URL is empty', () => {
    expect(
      getPublicBaseUrl({
        STANDALONE: true,
        NODE_ENV: 'production',
        PORT: 7860,
        PUBLIC_BASE_URL: '',
      } as ServerConfiguration),
    ).toBe('http://localhost:7860');
  });
});

describe('getPublicUiBasePath', () => {
  it('honors a path-bearing PUBLIC_BASE_URL in standalone production', () => {
    expect(
      getPublicUiBasePath({
        STANDALONE: true,
        NODE_ENV: 'production',
        PORT: 8790,
        PUBLIC_BASE_URL: 'https://host.example/custom/proxy/path',
      } as ServerConfiguration),
    ).toBe('/custom/proxy/path/');
  });

  it('honors PUBLIC_BASE_URL pathname in standalone development', () => {
    expect(
      getPublicUiBasePath({
        STANDALONE: true,
        NODE_ENV: 'development',
        PUBLIC_BASE_URL: 'https://host.example/custom/proxy/path',
      } as ServerConfiguration),
    ).toBe('/custom/proxy/path/');
  });
});
