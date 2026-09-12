import { describe, expect, it } from 'vitest';
import { normalize, requestValid, webUrl } from '../../src/shared/model';
describe('input boundaries', () => {
  it('rejects privileged and credential-bearing URLs', () => {
    expect(() => webUrl('file:///secret')).toThrow();
    expect(() => webUrl('https://me:secret@example.com')).toThrow();
  });
  it('rejects unknown operations', () =>
    expect(requestValid({ type: 'fetch', url: 'https://example.com' })).toBe(
      false,
    ));
  it('normalizes whitespace', () => expect(normalize(' A\n  B ')).toBe('A B'));
});
