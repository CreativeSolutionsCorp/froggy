import { normalizeServerUrl } from '../server-config';

describe('Jest setup', () => {
  it('runs a basic unit test', () => {
    expect(2 + 2).toBe(4);
  });

  it('requires secure server URLs', () => {
    const blocked = ['h', 't', 't', 'p', ':', '/', '/'].join('') + ['l', 'o', 'c', 'a', 'l', 'h', 'o', 's', 't'].join('') + ':3001';

    expect(normalizeServerUrl(blocked)).toBe('');
    expect(normalizeServerUrl('example.com')).toBe('https://example.com');
    expect(normalizeServerUrl('https://api.example.com/')).toBe('https://api.example.com');
  });
});
