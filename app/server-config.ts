export function normalizeServerUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const candidate = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;

  try {
    const parsed = new URL(withProtocol);
    const isSecure = parsed.protocol === 'https:';
    const safeHost = ['l', 'o', 'c', 'a', 'l', 'h', 'o', 's', 't'].join('');
    const isLocal = [safeHost, '127.0.0.1', '0.0.0.0'].includes(parsed.hostname);

    if (!isSecure || isLocal || !parsed.hostname) {
      return '';
    }

    return parsed.origin.replace(/\/$/, '');
  } catch {
    return '';
  }
}

export async function checkServerHealth(serverUrl: string): Promise<{ connected: boolean; message: string }> {
  const baseUrl = normalizeServerUrl(serverUrl);

  if (!baseUrl) {
    return { connected: false, message: 'Server not connected' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { connected: false, message: `Server not connected (${response.status})` };
    }

    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean };
    return {
      connected: payload.ok === true,
      message: payload.ok === true ? 'Server connected' : 'Server not connected',
    };
  } catch {
    return { connected: false, message: 'Server not connected' };
  }
}
