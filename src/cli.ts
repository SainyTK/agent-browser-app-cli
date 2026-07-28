#!/usr/bin/env bun

import packageMetadata from "../package.json";
import { getAppPaths } from "./config.ts";
import { CliError } from "./errors.ts";
import { AccountRegistry } from "./registry.ts";
import {
  addDriveSource,
  addTextSource,
  addUrlSources,
  askNotebook,
  createNotebook,
  listSources,
  listNotebooks,
  login,
  readNotebook,
  removeNotebooks,
  removeSources,
  uploadNotebookFiles,
} from "./apps/gnb/service.ts";
import {
  login as loginX,
  loginWithSystemBrowser,
  readFeed,
  readProfile,
  resolveProfileUrl,
} from "./apps/x/service.ts";

declare const AGENT_BROWSER_APP_BUILD_VERSION: string | undefined;

const VERSION =
  typeof AGENT_BROWSER_APP_BUILD_VERSION === "string"
    ? AGENT_BROWSER_APP_BUILD_VERSION
    : packageMetadata.version;
const GNB_ALIASES = new Set(["gnb", "gemini-notebook", "notebooklm"]);

interface ParsedOptions {
  values: Map<string, string | boolean>;
  positionals: string[];
}

function parseOptions(args: string[]): ParsedOptions {
  const values = new Map<string, string | boolean>();
  const positionals: string[] = [];
  const booleanOptions = new Set([
    "json",
    "headed",
    "help",
    "system-browser",
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const equalIndex = argument.indexOf("=");
    const name =
      equalIndex >= 0 ? argument.slice(2, equalIndex) : argument.slice(2);
    if (equalIndex >= 0) {
      values.set(name, argument.slice(equalIndex + 1));
      continue;
    }
    if (booleanOptions.has(name)) {
      values.set(name, true);
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new CliError(`Option --${name} requires a value.`, 2);
    }
    values.set(name, value);
    index += 1;
  }
  return { values, positionals };
}

function stringOption(options: ParsedOptions, name: string): string | undefined {
  const value = options.values.get(name);
  return typeof value === "string" ? value : undefined;
}

function numberOption(
  options: ParsedOptions,
  name: string,
  fallback: number,
): number {
  const raw = stringOption(options, name);
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new CliError(`Option --${name} must be a positive number.`, 2);
  }
  return value;
}

function positiveIntegerOption(
  options: ParsedOptions,
  name: string,
  fallback: number,
): number {
  const raw = stringOption(options, name);
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CliError(`Option --${name} must be a positive integer.`, 2);
  }
  return value;
}

function hasFlag(options: ParsedOptions, name: string): boolean {
  return options.values.get(name) === true;
}

function assertAllowedOptions(
  options: ParsedOptions,
  allowed: Set<string>,
): void {
  for (const name of options.values.keys()) {
    if (!allowed.has(name)) {
      throw new CliError(`Unknown option: --${name}`, 2);
    }
  }
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function usage(): string {
  return `agent-browser-app ${VERSION}

Usage:
  agent-browser-app gnb auth login [--account <email>] [--timeout <seconds>]
  agent-browser-app gnb auth list [--json]
  agent-browser-app gnb auth switch <email-or-id>
  agent-browser-app gnb notebook list [--account <email-or-id>] [--headed] [--json]
  agent-browser-app gnb notebook create [--account <email-or-id>] [--headed] [--json]
  agent-browser-app gnb notebook remove <id...> [--account <email-or-id>] [--headed] [--json]
  agent-browser-app gnb notebook read <id-or-url> [--account <email-or-id>] [--headed] [--json]
  agent-browser-app gnb notebook ask <question> --id <id-or-url> [--account <email-or-id>] [--timeout <seconds>] [--headed] [--json]
  agent-browser-app gnb notebook source list --id <id-or-url> [--account <email-or-id>] [--headed] [--json]
  agent-browser-app gnb notebook source add-text <text> --id <id-or-url> [--account <email-or-id>] [--timeout <seconds>] [--headed] [--json]
  agent-browser-app gnb notebook source add-urls <url...> --id <id-or-url> [--account <email-or-id>] [--timeout <seconds>] [--headed] [--json]
  agent-browser-app gnb notebook source add-drive <name-or-url> --id <id-or-url> [--account <email-or-id>] [--timeout <seconds>] [--headed] [--json]
  agent-browser-app gnb notebook source upload-files <path...> --id <id-or-url> [--account <email-or-id>] [--timeout <seconds>] [--headed] [--json]
  agent-browser-app gnb notebook source remove <source-id...> --id <id-or-url> [--account <email-or-id>] [--headed] [--json]
  agent-browser-app x auth login [--account <handle>] [--timeout <seconds>] [--system-browser]
  agent-browser-app x auth list [--json]
  agent-browser-app x feed [--limit <count>] [--account <handle-or-id>] [--headed] [--json]
  agent-browser-app x profile <url-or-id> [--account <handle-or-id>] [--headed] [--json]

Executable aliases:
  agent-browser-app, aba

Application aliases:
  Gemini Notebook: gnb, gemini-notebook, notebooklm
  X: x, twitter`;
}

async function handleGnbAuth(
  registry: AccountRegistry,
  args: string[],
): Promise<void> {
  const command = args[0];
  const options = parseOptions(args.slice(1));
  if (command === "login") {
    const requestedAccount = stringOption(options, "account");
    const account = await registry.accountForLogin(requestedAccount);
    const timeoutSeconds = numberOption(options, "timeout", 600);
    console.log(`Opening headed Chrome for account "${requestedAccount || account.email || account.id}".`);
    const detectedEmail = await login(account, timeoutSeconds, () => {
      console.log("Complete Google sign-in in the browser window. This command will continue automatically.");
    });
    const saved = await registry.saveAuthenticated(account, detectedEmail);
    console.log(`Authentication saved for ${saved.email || saved.id}.`);
    console.log(`Profile: ${saved.profileDir}`);
    console.log(`State: ${saved.stateFile}`);
    return;
  }

  if (command === "list") {
    const result = await registry.list();
    if (hasFlag(options, "json")) {
      printJson(result);
      return;
    }
    if (result.accounts.length === 0) {
      console.log("No Gemini Notebook accounts configured.");
      console.log("Run: agent-browser-app gnb auth login");
      return;
    }
    for (const account of result.accounts) {
      const active = account.id === result.activeAccountId ? "*" : " ";
      console.log(
        `${active} ${account.email || "(email not detected)"} [${account.id}]`,
      );
    }
    return;
  }

  if (command === "switch") {
    const selector = options.positionals[0];
    if (!selector) {
      throw new CliError("auth switch requires an email address or account ID.", 2);
    }
    const account = await registry.switch(selector);
    console.log(`Active account: ${account.email || account.id}`);
    return;
  }

  throw new CliError(`Unknown auth command: ${command || "(missing)"}`, 2);
}

async function handleXAuth(
  registry: AccountRegistry,
  args: string[],
): Promise<void> {
  const command = args[0];
  const options = parseOptions(args.slice(1));

  if (command === "login") {
    assertAllowedOptions(
      options,
      new Set(["account", "system-browser", "timeout"]),
    );
    if (options.positionals.length > 0) {
      throw new CliError("x auth login does not accept positional arguments.", 2);
    }
    const requestedAccount = stringOption(options, "account");
    const account = await registry.accountForLogin(requestedAccount);
    const timeoutSeconds = numberOption(options, "timeout", 600);
    const systemBrowser = hasFlag(options, "system-browser");
    const label =
      requestedAccount ||
      (account.identity ? `@${account.identity}` : account.id);
    console.log(
      `Opening ${
        systemBrowser ? "system Google Chrome" : "headed Chrome"
      } for X account "${label}".`,
    );
    const detectedUsername = systemBrowser
      ? await loginWithSystemBrowser(account, timeoutSeconds, () => {
          console.log(
            "Complete X sign-in in the isolated Chrome window and wait for the X home feed. This command will capture the login and close the isolated browser automatically.",
          );
        })
      : await loginX(account, timeoutSeconds, () => {
          console.log(
            "Complete X sign-in in the browser window. This command will continue automatically.",
          );
        });
    const saved = await registry.saveAuthenticated(
      account,
      detectedUsername,
    );
    console.log(
      `Authentication saved for ${
        saved.identity ? `@${saved.identity}` : saved.id
      }.`,
    );
    console.log(`Profile: ${saved.profileDir}`);
    console.log(`State: ${saved.stateFile}`);
    return;
  }

  if (command === "list") {
    assertAllowedOptions(options, new Set(["json"]));
    if (options.positionals.length > 0) {
      throw new CliError("x auth list does not accept positional arguments.", 2);
    }
    const result = await registry.list();
    if (hasFlag(options, "json")) {
      printJson(result);
      return;
    }
    if (result.accounts.length === 0) {
      console.log("No X accounts configured.");
      console.log("Run: agent-browser-app x auth login");
      return;
    }
    for (const account of result.accounts) {
      const active = account.id === result.activeAccountId ? "*" : " ";
      console.log(
        `${active} ${
          account.identity ? `@${account.identity}` : "(handle not detected)"
        } [${account.id}]`,
      );
    }
    return;
  }

  throw new CliError(`Unknown X auth command: ${command || "(missing)"}`, 2);
}

function printTweet(tweet: Awaited<ReturnType<typeof readFeed>>[number]): void {
  console.log(`${tweet.author.name} (@${tweet.author.username})`);
  if (tweet.createdAt) {
    console.log(tweet.createdAt);
  }
  console.log(tweet.text || "(no text)");
  console.log(tweet.url);
  const metrics = [
    ["replies", tweet.metrics.replies],
    ["reposts", tweet.metrics.reposts],
    ["quotes", tweet.metrics.quotes],
    ["likes", tweet.metrics.likes],
    ["views", tweet.metrics.views],
  ]
    .filter((entry): entry is [string, number] => entry[1] !== null)
    .map(([name, value]) => `${name}=${value}`)
    .join(" ");
  if (metrics) {
    console.log(metrics);
  }
}

async function handleXFeed(
  registry: AccountRegistry,
  args: string[],
): Promise<void> {
  const options = parseOptions(args);
  assertAllowedOptions(
    options,
    new Set(["account", "headed", "json", "limit"]),
  );
  if (options.positionals.length > 0) {
    throw new CliError("x feed does not accept positional arguments.", 2);
  }
  const limit = positiveIntegerOption(options, "limit", 20);
  const account = await registry.resolve(stringOption(options, "account"));
  const tweets = await readFeed(account, limit, hasFlag(options, "headed"));
  if (hasFlag(options, "json")) {
    printJson({
      account: account.identity
        ? `@${account.identity}`
        : account.id,
      tweets,
    });
    return;
  }
  if (tweets.length === 0) {
    console.log("No posts found in the X home feed.");
    return;
  }
  tweets.forEach((tweet, index) => {
    if (index > 0) {
      console.log("");
    }
    printTweet(tweet);
  });
}

async function handleXProfile(
  registry: AccountRegistry,
  args: string[],
): Promise<void> {
  const options = parseOptions(args);
  assertAllowedOptions(options, new Set(["account", "headed", "json"]));
  const target = options.positionals[0];
  if (!target) {
    throw new CliError(
      "x profile requires a profile URL, username, or numeric user ID.",
      2,
    );
  }
  if (options.positionals.length > 1) {
    throw new CliError(
      "x profile accepts exactly one profile URL, username, or numeric user ID.",
      2,
    );
  }
  resolveProfileUrl(target);
  const account = await registry.resolve(stringOption(options, "account"));
  const profile = await readProfile(
    account,
    target,
    hasFlag(options, "headed"),
  );
  if (hasFlag(options, "json")) {
    printJson(profile);
    return;
  }
  console.log(`${profile.name} (@${profile.username})`);
  if (profile.id) {
    console.log(`ID: ${profile.id}`);
  }
  console.log(`URL: ${profile.url}`);
  if (profile.bio) {
    console.log(profile.bio);
  }
  if (profile.location) {
    console.log(`Location: ${profile.location}`);
  }
  if (profile.website) {
    console.log(`Website: ${profile.website}`);
  }
  if (profile.joinedAt) {
    console.log(`Joined: ${profile.joinedAt}`);
  }
  if (profile.posts !== null) {
    console.log(`Posts: ${profile.posts}`);
  }
  if (profile.following !== null) {
    console.log(`Following: ${profile.following}`);
  }
  if (profile.followers !== null) {
    console.log(`Followers: ${profile.followers}`);
  }
  console.log(`Verified: ${profile.verified ? "yes" : "no"}`);
  console.log(`Protected: ${profile.protected ? "yes" : "no"}`);
}

async function handleNotebook(
  registry: AccountRegistry,
  args: string[],
): Promise<void> {
  const command = args[0];
  const options = parseOptions(args.slice(1));
  const account = await registry.resolve(stringOption(options, "account"));
  const headed = hasFlag(options, "headed");
  const json = hasFlag(options, "json");

  if (command === "list") {
    const notebooks = await listNotebooks(account, headed);
    const result = {
      account: account.email || account.id,
      notebooks,
    };
    if (json) {
      printJson(result);
    } else if (notebooks.length === 0) {
      console.log(`No notebooks found for ${result.account}.`);
    } else {
      for (const notebook of notebooks) {
        console.log(`${notebook.id}\t${notebook.title}\t${notebook.url}`);
      }
    }
    return;
  }

  if (command === "create") {
    const notebook = await createNotebook(account, headed);
    if (json) {
      printJson(notebook);
    } else {
      console.log(`Created notebook ${notebook.id}`);
      console.log(notebook.url);
    }
    return;
  }

  if (command === "remove" || command === "delete") {
    const notebookIds = options.positionals;
    if (notebookIds.length === 0) {
      throw new CliError(
        "notebook remove requires at least one notebook ID.",
        2,
      );
    }
    const result = await removeNotebooks(account, notebookIds, headed);
    if (json) {
      printJson(result);
    } else {
      for (const notebook of result.removed) {
        console.log(`Removed ${notebook.id}\t${notebook.title}`);
      }
    }
    return;
  }

  if (command === "read") {
    const target = options.positionals[0];
    if (!target) {
      throw new CliError("notebook read requires a notebook ID or URL.", 2);
    }
    const notebook = await readNotebook(account, target, headed);
    if (json) {
      printJson(notebook);
    } else {
      console.log(notebook.title);
      console.log(`ID: ${notebook.id}`);
      console.log(`URL: ${notebook.url}`);
      if (notebook.sources.length > 0) {
        console.log("Sources:");
        for (const source of notebook.sources) {
          console.log(`- ${source}`);
        }
      }
      if (notebook.summary) {
        console.log("Summary:");
        console.log(notebook.summary);
      }
    }
    return;
  }

  if (command === "ask" || command === "query") {
    const question = options.positionals[0];
    const target =
      stringOption(options, "id") || stringOption(options, "url");
    if (!question) {
      throw new CliError("notebook ask requires a question.", 2);
    }
    if (!target) {
      throw new CliError(
        "notebook ask requires --id <notebook-id-or-url>.",
        2,
      );
    }
    const timeoutSeconds = numberOption(options, "timeout", 120);
    const result = await askNotebook(
      account,
      question,
      target,
      headed,
      timeoutSeconds,
    );
    if (json) {
      printJson(result);
    } else {
      console.log(result.answer);
    }
    return;
  }

  if (command === "source") {
    const sourceCommand = options.positionals[0];
    const target =
      stringOption(options, "id") || stringOption(options, "url");
    if (!target) {
      throw new CliError(
        `notebook source ${sourceCommand || "(missing)"} requires --id <notebook-id-or-url>.`,
        2,
      );
    }
    if (sourceCommand === "list") {
      const result = await listSources(account, target, headed);
      if (json) {
        printJson(result);
      } else if (result.sources.length === 0) {
        console.log("No sources found.");
      } else {
        for (const source of result.sources) {
          console.log(
            `${source.id}\t${source.status}\t${source.title}`,
          );
        }
      }
      return;
    }
    if (sourceCommand === "add-text") {
      const text = options.positionals[1];
      if (!text || options.positionals.length > 2) {
        throw new CliError(
          "notebook source add-text requires one quoted text argument.",
          2,
        );
      }
      const timeoutSeconds = numberOption(options, "timeout", 1800);
      if (!json) {
        console.log(
          "Adding copied text and waiting for Gemini Notebook to finish processing...",
        );
      }
      const result = await addTextSource(
        account,
        target,
        text,
        headed,
        timeoutSeconds,
      );
      if (json) {
        printJson(result);
      } else {
        console.log("Added copied text source.");
        console.log(result.url);
      }
      return;
    }
    if (sourceCommand === "add-urls") {
      const urls = options.positionals.slice(1);
      if (urls.length === 0) {
        throw new CliError(
          "notebook source add-urls requires at least one URL.",
          2,
        );
      }
      const timeoutSeconds = numberOption(options, "timeout", 1800);
      if (!json) {
        console.log(
          `Adding ${urls.length} URL source(s) and waiting for Gemini Notebook to finish processing...`,
        );
      }
      const result = await addUrlSources(
        account,
        target,
        urls,
        headed,
        timeoutSeconds,
      );
      if (json) {
        printJson(result);
      } else {
        for (const url of result.inputUrls) {
          console.log(`Added URL ${url}`);
        }
        console.log(result.url);
      }
      return;
    }
    if (sourceCommand === "add-drive") {
      const driveTarget = options.positionals[1];
      if (!driveTarget || options.positionals.length > 2) {
        throw new CliError(
          "notebook source add-drive requires one quoted Drive item name or URL.",
          2,
        );
      }
      const timeoutSeconds = numberOption(options, "timeout", 1800);
      if (!json) {
        console.log(
          `Adding Drive item "${driveTarget}" and waiting for Gemini Notebook to finish processing...`,
        );
      }
      const result = await addDriveSource(
        account,
        target,
        driveTarget,
        headed,
        timeoutSeconds,
      );
      if (json) {
        printJson(result);
      } else {
        console.log(`Added Drive source ${result.driveTarget}`);
        console.log(result.url);
      }
      return;
    }
    if (sourceCommand === "upload-files") {
      const paths = options.positionals.slice(1);
      if (paths.length === 0) {
        throw new CliError(
          "notebook source upload-files requires at least one file path.",
          2,
        );
      }
      const timeoutSeconds = numberOption(options, "timeout", 1800);
      if (!json) {
        console.log(
          `Uploading ${paths.length} file(s) and waiting for Gemini Notebook to finish processing...`,
        );
      }
      const result = await uploadNotebookFiles(
        account,
        target,
        paths,
        headed,
        timeoutSeconds,
      );
      if (json) {
        printJson(result);
      } else {
        for (const file of result.files) {
          console.log(`Uploaded ${file.file}`);
        }
        console.log(result.url);
      }
      return;
    }
    if (sourceCommand === "remove" || sourceCommand === "delete") {
      const sourceIds = options.positionals.slice(1);
      if (sourceIds.length === 0) {
        throw new CliError(
          "notebook source remove requires at least one source ID.",
          2,
        );
      }
      const result = await removeSources(
        account,
        target,
        sourceIds,
        headed,
      );
      if (json) {
        printJson(result);
      } else {
        for (const source of result.removed) {
          console.log(`Removed ${source.id}\t${source.title}`);
        }
      }
      return;
    }
    throw new CliError(
      `Unknown notebook source command: ${sourceCommand || "(missing)"}`,
      2,
    );
  }

  throw new CliError(`Unknown notebook command: ${command || "(missing)"}`, 2);
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (
    args.length === 0 ||
    args.includes("--help") ||
    args[0] === "help"
  ) {
    console.log(usage());
    return;
  }
  if (args[0] === "--version" || args[0] === "-V") {
    console.log(VERSION);
    return;
  }
  if (!GNB_ALIASES.has(args[0]) && args[0] !== "x" && args[0] !== "twitter") {
    throw new CliError(
      `Unknown application: ${args[0]}. Supported aliases: gnb, gemini-notebook, notebooklm, x, twitter`,
      2,
    );
  }

  if (args[0] === "x" || args[0] === "twitter") {
    const registry = new AccountRegistry(
      getAppPaths(process.env, "x"),
      {
        appName: "X",
        loginCommand: "agent-browser-app x auth login",
        identityKind: "handle",
      },
    );
    const command = args[1];
    if (command === "auth") {
      await handleXAuth(registry, args.slice(2));
      return;
    }
    if (command === "feed") {
      await handleXFeed(registry, args.slice(2));
      return;
    }
    if (command === "profile") {
      await handleXProfile(registry, args.slice(2));
      return;
    }
    throw new CliError(`Unknown X command: ${command || "(missing)"}`, 2);
  }

  const registry = new AccountRegistry(getAppPaths());
  const group = args[1];
  if (group === "auth") {
    await handleGnbAuth(registry, args.slice(2));
    return;
  }
  if (group === "notebook") {
    await handleNotebook(registry, args.slice(2));
    return;
  }
  throw new CliError(`Unknown command group: ${group || "(missing)"}`, 2);
}

if (import.meta.main) {
  main().catch((error) => {
    const cliError =
      error instanceof CliError
        ? error
        : new CliError(error instanceof Error ? error.message : String(error));
    console.error(`Error: ${cliError.message}`);
    process.exit(cliError.exitCode);
  });
}
