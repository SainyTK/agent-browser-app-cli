// Source rows have no stable IDs and NotebookLM can insert new rows anywhere,
// so new sources are found by title and status, never by position.
interface SourceRow {
  title: string;
  status: "ready" | "processing" | "error";
}

// When a same-titled baseline row may have changed status, consume the
// candidate whose removal can only delay success or report failure, never
// report a still-processing new source as ready.
const CONSUME_ORDER: Record<SourceRow["status"], SourceRow["status"][]> = {
  ready: ["ready", "processing", "error"],
  error: ["error", "processing", "ready"],
  processing: ["ready", "processing", "error"],
};

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

export function addedSourcesSince<T extends SourceRow>(
  baseline: SourceRow[],
  current: T[],
): T[] {
  const remaining = [...current];
  // Settled baseline rows are unambiguous, so they claim their matches first.
  const ordered = [
    ...baseline.filter((source) => source.status !== "processing"),
    ...baseline.filter((source) => source.status === "processing"),
  ];
  for (const source of ordered) {
    const title = normalizeTitle(source.title);
    for (const status of CONSUME_ORDER[source.status]) {
      const index = remaining.findIndex((candidate) =>
        normalizeTitle(candidate.title) === title && candidate.status === status);
      if (index >= 0) {
        remaining.splice(index, 1);
        break;
      }
    }
  }
  return remaining;
}
