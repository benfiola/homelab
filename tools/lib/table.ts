// lays rows out in columns, each as wide as its widest cell and two spaces apart. a line has no
// trailing spaces, and a cell in a `right` column is aligned to the right.
export const align = (
  rows: string[][],
  options: { right?: number[] } = {},
): string[] => {
  const columns = Math.max(0, ...rows.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, i) =>
    Math.max(0, ...rows.map((row) => (row[i] ?? "").length)),
  );
  return rows.map((row) =>
    widths
      .map((width, i) =>
        options.right?.includes(i)
          ? (row[i] ?? "").padStart(width)
          : (row[i] ?? "").padEnd(width),
      )
      .join("  ")
      .trimEnd(),
  );
};
