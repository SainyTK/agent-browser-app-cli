import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAppPaths, resolveAppHeaded, type AppId } from "../src/config.ts";

const homes: string[] = [];
const noFlags = { headed: false, headless: false };

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function setup(app: AppId) {
  const home = await mkdtemp(join(tmpdir(), "aba-config-test-"));
  homes.push(home);
  const environment = { AGENT_BROWSER_HOME: home };
  const root = getAppPaths(environment, app).root;
  await mkdir(root, { recursive: true });
  return { environment, path: join(root, "config.json") };
}

for (const app of ["gnb", "x", "reddit"] as const) {
  test(`${app} defaults, config, and explicit browser overrides`, async () => {
    const { environment, path } = await setup(app);
    expect(await resolveAppHeaded(app, noFlags, environment)).toBe(app === "reddit");
    await writeFile(path, "{}");
    expect(await resolveAppHeaded(app, noFlags, environment)).toBe(app === "reddit");
    for (const headed of [true, false]) {
      await writeFile(path, JSON.stringify({ headed }));
      expect(await resolveAppHeaded(app, noFlags, environment)).toBe(headed);
      expect(await resolveAppHeaded(app, { headed: true, headless: false }, environment)).toBe(true);
      expect(await resolveAppHeaded(app, { headed: false, headless: true }, environment)).toBe(false);
    }
    await expect(resolveAppHeaded(app, { headed: true, headless: true }, environment))
      .rejects.toThrow("only one of --headed or --headless");
  });
}

test("invalid config fails without exposing its contents; flags override it", async () => {
  const { environment, path } = await setup("gnb");
  for (const text of ["private-invalid-json", "null", "[]", '{"headed":"false"}', '{"headless":true}']) {
    await writeFile(path, text);
    try {
      await resolveAppHeaded("gnb", noFlags, environment);
      throw new Error("Expected invalid config to fail");
    } catch (error) {
      expect((error as { exitCode: number }).exitCode).toBe(2);
      expect((error as Error).message).toContain(path);
      expect((error as Error).message).not.toContain(text);
    }
    expect(await resolveAppHeaded("gnb", { headed: false, headless: true }, environment)).toBe(false);
  }
  await rm(path);
  await mkdir(path);
  await expect(resolveAppHeaded("gnb", noFlags, environment)).rejects.toThrow("Could not read app config");
});
