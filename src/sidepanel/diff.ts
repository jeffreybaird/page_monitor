export type DiffPart = { text: string; kind: 'same' | 'added' | 'removed' };

const MAX_CELLS = 200_000;

/** Word-level changes, retaining every character for accurate before/after views. */
export function textDiff(before: string, after: string): DiffPart[] {
  if (before === after) return before ? [{ text: before, kind: 'same' }] : [];
  const tokenize = (text: string) =>
    text.match(/[\p{L}\p{N}\p{M}_]+|\s+|[^\p{L}\p{N}\p{M}_\s]/gu) ?? [];
  const left = tokenize(before);
  const right = tokenize(after);
  const parts: DiffPart[] = [];
  const append = (kind: DiffPart['kind'], text: string) => {
    if (!text) return;
    const last = parts.at(-1);
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };

  let start = 0;
  while (
    start < left.length &&
    start < right.length &&
    left[start] === right[start]
  )
    start++;
  let leftEnd = left.length;
  let rightEnd = right.length;
  while (
    leftEnd > start &&
    rightEnd > start &&
    left[leftEnd - 1] === right[rightEnd - 1]
  ) {
    leftEnd--;
    rightEnd--;
  }
  append('same', left.slice(0, start).join(''));
  const rows = leftEnd - start;
  const columns = rightEnd - start;

  // Large replacements use the shared prefix/suffix instead of blocking the panel.
  if (!rows || !columns || (rows + 1) * (columns + 1) > MAX_CELLS) {
    append('removed', left.slice(start, leftEnd).join(''));
    append('added', right.slice(start, rightEnd).join(''));
  } else {
    const width = columns + 1;
    const lengths = new Uint32Array((rows + 1) * width);
    for (let i = rows - 1; i >= 0; i--) {
      for (let j = columns - 1; j >= 0; j--) {
        lengths[i * width + j] =
          left[start + i] === right[start + j]
            ? 1 + lengths[(i + 1) * width + j + 1]
            : Math.max(
                lengths[(i + 1) * width + j],
                lengths[i * width + j + 1],
              );
      }
    }
    let i = 0;
    let j = 0;
    while (i < rows && j < columns) {
      if (left[start + i] === right[start + j]) {
        append('same', left[start + i]);
        i++;
        j++;
      } else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) {
        append('removed', left[start + i++]);
      } else append('added', right[start + j++]);
    }
    append('removed', left.slice(start + i, leftEnd).join(''));
    append('added', right.slice(start + j, rightEnd).join(''));
  }
  append('same', left.slice(leftEnd).join(''));
  return parts;
}
