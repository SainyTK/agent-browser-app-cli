import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CliError } from "./errors.ts";
import type { AppPaths } from "./config.ts";

export interface Account {
  id: string;
  email?: string;
  profileDir: string;
  stateFile: string;
  createdAt: string;
  updatedAt: string;
  lastAuthenticatedAt?: string;
}

interface RegistryFile {
  version: 1;
  activeAccountId?: string;
  accounts: Account[];
}

function normalizeSelector(value: string): string {
  return value.trim().toLowerCase();
}

function safeAccountId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return slug || "default";
}

export class AccountRegistry {
  constructor(private readonly paths: AppPaths) {}

  async initialize(): Promise<void> {
    await mkdir(this.paths.accountsRoot, { recursive: true, mode: 0o700 });
    await chmod(this.paths.root, 0o700).catch(() => undefined);
    await chmod(this.paths.accountsRoot, 0o700).catch(() => undefined);
  }

  async list(): Promise<{ accounts: Account[]; activeAccountId?: string }> {
    const registry = await this.read();
    return {
      accounts: registry.accounts,
      activeAccountId: registry.activeAccountId,
    };
  }

  async resolve(selector?: string): Promise<Account> {
    const registry = await this.read();
    const requested = selector?.trim();
    const account = requested
      ? registry.accounts.find((candidate) => {
          const normalized = normalizeSelector(requested);
          return (
            normalizeSelector(candidate.id) === normalized ||
            (candidate.email && normalizeSelector(candidate.email) === normalized)
          );
        })
      : registry.accounts.find(
          (candidate) => candidate.id === registry.activeAccountId,
        ) ?? registry.accounts[0];

    if (!account) {
      const suffix = requested ? ` "${requested}"` : "";
      throw new CliError(
        `No Gemini Notebook account${suffix} is configured. Run: agent-browser-app gnb auth login`,
      );
    }

    return account;
  }

  async accountForLogin(selector?: string): Promise<Account> {
    await this.initialize();
    const registry = await this.read();

    if (selector) {
      const normalized = normalizeSelector(selector);
      const existing = registry.accounts.find(
        (candidate) =>
          normalizeSelector(candidate.id) === normalized ||
          (candidate.email && normalizeSelector(candidate.email) === normalized),
      );
      if (existing) {
        return existing;
      }
    } else {
      const active = registry.accounts.find(
        (candidate) => candidate.id === registry.activeAccountId,
      );
      if (active) {
        return active;
      }
      if (registry.accounts.length === 1) {
        return registry.accounts[0];
      }
    }

    const baseId = selector ? safeAccountId(selector) : "default";
    let id = baseId;
    let suffix = 2;
    while (registry.accounts.some((candidate) => candidate.id === id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }

    const now = new Date().toISOString();
    const accountRoot = join(this.paths.accountsRoot, id);
    const account: Account = {
      id,
      email: selector?.includes("@") ? selector.trim() : undefined,
      profileDir: join(accountRoot, "browser-profile"),
      stateFile: join(accountRoot, "state.json"),
      createdAt: now,
      updatedAt: now,
    };

    await mkdir(account.profileDir, { recursive: true, mode: 0o700 });
    return account;
  }

  async saveAuthenticated(account: Account, detectedEmail?: string): Promise<Account> {
    const registry = await this.read();
    const now = new Date().toISOString();
    const updated: Account = {
      ...account,
      email: detectedEmail || account.email,
      updatedAt: now,
      lastAuthenticatedAt: now,
    };
    const index = registry.accounts.findIndex(
      (candidate) => candidate.id === account.id,
    );

    if (index >= 0) {
      registry.accounts[index] = updated;
    } else {
      registry.accounts.push(updated);
    }
    registry.activeAccountId = updated.id;
    await this.write(registry);
    return updated;
  }

  async switch(selector: string): Promise<Account> {
    const account = await this.resolve(selector);
    const registry = await this.read();
    registry.activeAccountId = account.id;
    await this.write(registry);
    return account;
  }

  private async read(): Promise<RegistryFile> {
    await this.initialize();
    try {
      const raw = await readFile(this.paths.registryFile, "utf8");
      const parsed = JSON.parse(raw) as Partial<RegistryFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.accounts)) {
        throw new Error("unsupported registry format");
      }
      return {
        version: 1,
        activeAccountId: parsed.activeAccountId,
        accounts: parsed.accounts,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new CliError(
          `Could not read account registry at ${this.paths.registryFile}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return { version: 1, accounts: [] };
    }
  }

  private async write(registry: RegistryFile): Promise<void> {
    await this.initialize();
    await writeFile(
      this.paths.registryFile,
      `${JSON.stringify(registry, null, 2)}\n`,
      { mode: 0o600 },
    );
    await chmod(this.paths.registryFile, 0o600).catch(() => undefined);
  }
}
