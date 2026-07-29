export type DiffToken = { type: 'same' | 'added' | 'removed'; text: string };

/**
 * Word-level diff via a classic LCS table - guides are free-form paragraphs,
 * not the structured fields MealHistory.tsx diffs, so there's no named-field
 * comparison to lean on. Splitting on whitespace (keeping the separator with
 * each token) keeps spacing intact when tokens are reassembled, and O(n*m)
 * on a guide-length body (a few hundred words) is well within budget - this
 * isn't running on every keystroke, just once when a diff is expanded.
 */
export function wordDiff(before: string, after: string): DiffToken[] {
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);

  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      tokens.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      tokens.push({ type: 'removed', text: a[i] });
      i++;
    } else {
      tokens.push({ type: 'added', text: b[j] });
      j++;
    }
  }
  while (i < a.length) tokens.push({ type: 'removed', text: a[i++] });
  while (j < b.length) tokens.push({ type: 'added', text: b[j++] });

  return tokens;
}
