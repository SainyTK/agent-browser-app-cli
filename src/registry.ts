import { randomUUID } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { CliError } from "./errors.ts";
import type { AppPaths } from "./config.ts";

export interface Account {
  id: string;
  email?: string;
  identity?: string;
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

export interface AccountRegistryOptions {
  appName: string;
  loginCommand: string;
  identityKind: "email" | "handle";
}

const DEFAULT_OPTIONS: AccountRegistryOptions = {
  appName: "Gemini Notebook",
  loginCommand: "agent-browser-app gnb auth login",
  identityKind: "email",
};

function normalizeSelector(
  value: string,
  identityKind: AccountRegistryOptions["identityKind"],
): string {
  const normalized = value.trim().toLowerCase();
  return identityKind === "handle"
    ? normalized.replace(/^@/, "")
    : normalized;
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
  constructor(
    private readonly paths: AppPaths,
    private readonly options: AccountRegistryOptions = DEFAULT_OPTIONS,
  ) {}

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
          const normalized = normalizeSelector(
            requested,
            this.options.identityKind,
          );
          return (
            normalizeSelector(candidate.id, this.options.identityKind) ===
              normalized ||
            (candidate.email &&
              normalizeSelector(candidate.email, this.options.identityKind) ===
                normalized) ||
            (candidate.identity &&
              normalizeSelector(
                candidate.identity,
                this.options.identityKind,
              ) === normalized)
          );
        })
      : registry.accounts.find(
          (candidate) => candidate.id === registry.activeAccountId,
        ) ?? registry.accounts[0];

    if (!account) {
      const suffix = requested ? ` "${requested}"` : "";
      throw new CliError(
        `No ${this.options.appName} account${suffix} is configured. Run: ${this.options.loginCommand}`,
      );
    }

    return account;
  }

  async accountForLogin(selector?: string): Promise<Account> {
    await this.initialize();
    const registry = await this.read();

    if (selector) {
      const normalized = normalizeSelector(
        selector,
        this.options.identityKind,
      );
      const existing = registry.accounts.find(
        (candidate) =>
          normalizeSelector(candidate.id, this.options.identityKind) ===
            normalized ||
          (candidate.email &&
            normalizeSelector(candidate.email, this.options.identityKind) ===
              normalized) ||
          (candidate.identity &&
            normalizeSelector(
              candidate.identity,
              this.options.identityKind,
            ) === normalized),
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
      email:
        this.options.identityKind === "email" && selector?.includes("@")
          ? selector.trim()
          : undefined,
      identity:
        this.options.identityKind === "handle" && selector
          ? normalizeSelector(selector, "handle")
          : undefined,
      profileDir: join(accountRoot, "browser-profile"),
      stateFile: join(accountRoot, "state.json"),
      createdAt: now,
      updatedAt: now,
    };

    await mkdir(account.profileDir, { recursive: true, mode: 0o700 });
    return account;
  }

  async accountForDiscoveredLogin(): Promise<Account> {
    await this.initialize();
    let id: string;
    let accountRoot: string;
    do {
      id = `login-${randomUUID().slice(0, 8)}`;
      accountRoot = join(this.paths.accountsRoot, id);
    } while (await pathExists(accountRoot));

    const now = new Date().toISOString();
    const account: Account = {
      id,
      profileDir: join(accountRoot, "browser-profile"),
      stateFile: join(accountRoot, "state.json"),
      createdAt: now,
      updatedAt: now,
    };
    await mkdir(account.profileDir, { recursive: true, mode: 0o700 });
    return account;
  }

  async saveAuthenticated(
    account: Account,
    detectedIdentity?: string,
  ): Promise<Account> {
    const registry = await this.read();
    const now = new Date().toISOString();
    const updated: Account = {
      ...account,
      email:
        this.options.identityKind === "email"
          ? detectedIdentity || account.email
          : account.email,
      identity:
        this.options.identityKind === "handle"
          ? detectedIdentity
            ? normalizeSelector(detectedIdentity, "handle")
            : account.identity
          : account.identity,
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

  async saveDiscoveredAuthenticated(
    account: Account,
    detectedIdentity: string,
  ): Promise<Account> {
    if (this.options.identityKind !== "handle") {
      throw new CliError(
        "Discovered account login requires a handle-based registry.",
      );
    }
    const identity = normalizeSelector(detectedIdentity, "handle");
    if (!identity) {
      throw new CliError(
        `Could not save ${this.options.appName} authentication without a detected username.`,
      );
    }

    const registry = await this.read();
    const retainedAccounts = registry.accounts.filter(
      (candidate) =>
        !candidate.identity ||
        normalizeSelector(candidate.identity, "handle") !== identity,
    );
    const baseId = safeAccountId(identity);
    let id = baseId;
    let suffix = 2;
    let accountRoot = join(this.paths.accountsRoot, id);
    while (
      retainedAccounts.some((candidate) => candidate.id === id) ||
      await pathExists(accountRoot)
    ) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
      accountRoot = join(this.paths.accountsRoot, id);
    }

    const currentRoot = dirname(account.profileDir);
    await rename(currentRoot, accountRoot).catch((error) => {
      throw new CliError(
        `Could not stamp the authenticated ${this.options.appName} profile as "${id}". ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
    const now = new Date().toISOString();
    const updated: Account = {
      ...account,
      id,
      identity,
      profileDir: join(accountRoot, "browser-profile"),
      stateFile: join(accountRoot, "state.json"),
      updatedAt: now,
      lastAuthenticatedAt: now,
    };
    registry.accounts = [...retainedAccounts, updated];
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
