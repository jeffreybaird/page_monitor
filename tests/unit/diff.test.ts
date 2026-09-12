import { describe, expect, it } from 'vitest';
import { textDiff } from '../../src/sidepanel/diff';

describe('textDiff', () => {
  it('highlights an inserted or removed phrase without changing its neighbors', () => {
    expect(textDiff('Order ready', 'Order now ready')).toEqual([
      { kind: 'same', text: 'Order ' },
      { kind: 'added', text: 'now ' },
      { kind: 'same', text: 'ready' },
    ]);
    expect(textDiff('Order now ready', 'Order ready')).toEqual([
      { kind: 'same', text: 'Order ' },
      { kind: 'removed', text: 'now ' },
      { kind: 'same', text: 'ready' },
    ]);
  });

  it('isolates changed prices and punctuation', () => {
    expect(textDiff('Price: $19.99!', 'Price: $29.99?')).toEqual([
      { kind: 'same', text: 'Price: $' },
      { kind: 'removed', text: '19' },
      { kind: 'added', text: '29' },
      { kind: 'same', text: '.99' },
      { kind: 'removed', text: '!' },
      { kind: 'added', text: '?' },
    ]);
  });

  it('preserves identical and empty values', () => {
    expect(textDiff('', '')).toEqual([]);
    expect(textDiff('Ready', 'Ready')).toEqual([
      { kind: 'same', text: 'Ready' },
    ]);
    expect(textDiff('', 'New')).toEqual([{ kind: 'added', text: 'New' }]);
    expect(textDiff('Old', '')).toEqual([{ kind: 'removed', text: 'Old' }]);
  });

  it.each([
    ['first\n\tsecond', 'first  second\n'],
    ['Café 👩🏽‍💻 東京', 'Café 🚀 東京'],
    ['<script>old</script>', '<script>new</script>'],
    ['A B A B A', 'B A B A B'],
    ['one two three four', 'one five three six'],
  ])('reconstructs both texts exactly: %s → %s', (before, after) => {
    const parts = textDiff(before, after);
    expect(
      parts
        .filter((part) => part.kind !== 'added')
        .map((part) => part.text)
        .join(''),
    ).toBe(before);
    expect(
      parts
        .filter((part) => part.kind !== 'removed')
        .map((part) => part.text)
        .join(''),
    ).toBe(after);
    expect(parts.every((part) => part.text.length > 0)).toBe(true);
    expect(
      parts.every((part, index) => part.kind !== parts[index - 1]?.kind),
    ).toBe(true);
  });

  it('falls back to a bounded replacement for large unrelated text', () => {
    const before = 'Start ' + 'a!'.repeat(3900) + ' End';
    const after = 'Start ' + 'b?'.repeat(3900) + ' End';
    expect(textDiff(before, after)).toEqual([
      { kind: 'same', text: 'Start ' },
      { kind: 'removed', text: 'a!'.repeat(3900) },
      { kind: 'added', text: 'b?'.repeat(3900) },
      { kind: 'same', text: ' End' },
    ]);
  });
});
