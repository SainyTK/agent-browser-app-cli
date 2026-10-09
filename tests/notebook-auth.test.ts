import { describe, expect, test } from "bun:test";
import { isNotebookAppUrl } from "../src/apps/gnb/auth.ts";

describe("NotebookLM authentication URL policy", () => {
  test("accepts both app hosts, account paths, and notebook URLs", () => {
    for (const host of ["notebooklm.google.com", "notebook.google.com"]) {
      for (const path of ["/", "/?authuser=1", "/u/0/", "/notebook/fixture-123"]) {
        expect(isNotebookAppUrl(`https://${host}${path}`)).toBe(true);
      }
    }
  });

  test("rejects known landing and sign-in routes with path boundaries", () => {
    for (const host of ["notebooklm.google.com", "notebook.google.com"]) {
      for (const path of ["/trynow", "/trynow/", "/trynow?authuser=1", "/login", "/signin/next", "/u/0/trynow", "/u/12/login", "/TryNow"]) {
        expect(isNotebookAppUrl(`https://${host}${path}`)).toBe(false);
      }
    }
    expect(isNotebookAppUrl("https://notebook.google.com/notebook/trynow-notes")).toBe(true);
  });

  test("rejects external, lookalike, insecure, and malformed URLs", () => {
    for (const url of ["https://accounts.google.com/", "https://notebook.google.com.example.test/", "http://notebook.google.com/", "about:blank", "not a URL"]) {
      expect(isNotebookAppUrl(url)).toBe(false);
    }
  });
});
