// Counts user-perceived characters rather than UTF-16 code units.
export function countGraphemes(text: string): number {
  const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" })
  const segments = segmenter.segment(text)
  const count = [...segments].length
  return count
}
