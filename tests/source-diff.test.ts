import { describe, expect, test } from "bun:test";
import { addedSourcesSince } from "../src/apps/gnb/source-diff.ts";

type Status = "ready" | "processing" | "error";
const row = (title: string, status: Status) => ({ title, status });

describe("NotebookLM added-source detection", () => {
  test("finds a new duplicate-titled upload inserted above the existing one", () => {
    const baseline = [row("memo.m4a", "ready"), row("tone.m4a", "error")];
    const current = [row("memo.m4a", "processing"), row("memo.m4a", "ready"), row("tone.m4a", "error")];
    expect(addedSourcesSince(baseline, current)).toEqual([row("memo.m4a", "processing")]);
    expect(addedSourcesSince(baseline, [row("memo.m4a", "ready"), ...baseline])).toEqual([row("memo.m4a", "ready")]);
  });

  test("finds new sources regardless of position and title case", () => {
    const baseline = [row("Notes.pdf", "ready")];
    expect(addedSourcesSince(baseline, [row("notes.pdf ", "ready"), row("New.pdf", "processing")])).toEqual([row("New.pdf", "processing")]);
    expect(addedSourcesSince(baseline, baseline)).toEqual([]);
  });

  test("never reports a still-processing duplicate as ready when the existing copy finishes", () => {
    const baseline = [row("memo.m4a", "processing")];
    expect(addedSourcesSince(baseline, [row("memo.m4a", "ready"), row("memo.m4a", "processing")])).toEqual([row("memo.m4a", "processing")]);
    expect(addedSourcesSince(baseline, [row("memo.m4a", "processing"), row("memo.m4a", "ready")])).toEqual([row("memo.m4a", "processing")]);
    expect(addedSourcesSince(baseline, [row("memo.m4a", "ready"), row("memo.m4a", "ready")])).toEqual([row("memo.m4a", "ready")]);
  });

  test("keeps a new failure visible next to an earlier failed copy", () => {
    const baseline = [row("tone.m4a", "error")];
    expect(addedSourcesSince(baseline, [row("tone.m4a", "error"), row("tone.m4a", "error")])).toEqual([row("tone.m4a", "error")]);
  });
});
