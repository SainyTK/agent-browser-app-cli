#!/usr/bin/env bun

import { getAppPaths } from "./config.ts";
import { CliError } from "./errors.ts";
import { AccountRegistry } from "./registry.ts";
import {
  askNotebook,
  createNotebook,
  listSources,
  listNotebooks,
  login,
  readNotebook,
  removeNotebooks,
  removeSources,
  uploadNotebook,
} from "./apps/gnb/service.ts";

const VERSION = "0.1.0";
const APP_ALIASES = new Set(["gnb", "gemini-notebook", "notebooklm"]);

interface ParsedOptions {
  values: Map<string, string | boolean>;
  positionals: string[];
}

function parseOptions(args: string[]): ParsedOptions {
  const values = new Map<string, string | boolean>();
  const positionals: string[] = [];
  const booleanOptions = new Set(["json", "headed", "help"]);

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

function hasFlag(options: ParsedOptions, name: string): boolean {
  return options.values.get(name) === true;
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
  agent-browser-app gnb notebook upload <path> --id <id-or-url> [--account <email-or-id>] [--timeout <seconds>] [--headed] [--json]
  agent-browser-app gnb notebook source list --id <id-or-url> [--account <email-or-id>] [--headed] [--json]
  agent-browser-app gnb notebook source remove <source-id...> --id <id-or-url> [--account <email-or-id>] [--headed] [--json]

Application aliases:
  gnb, gemini-notebook, notebooklm`;
}

async function handleAuth(
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

  if (command === "upload") {
    const path = options.positionals[0];
    const target =
      stringOption(options, "id") || stringOption(options, "url");
    if (!path) {
      throw new CliError("notebook upload requires a file path.", 2);
    }
    if (!target) {
      throw new CliError(
        "notebook upload requires --id <notebook-id-or-url>.",
        2,
      );
    }
    const timeoutSeconds = numberOption(options, "timeout", 1800);
    if (!json) {
      console.log(
        `Uploading ${path} and waiting for Gemini Notebook to finish processing...`,
      );
    }
    const result = await uploadNotebook(
      account,
      target,
      path,
      headed,
      timeoutSeconds,
    );
    if (json) {
      printJson(result);
    } else {
      console.log(`Uploaded ${result.file}`);
      console.log(result.url);
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
  if (!APP_ALIASES.has(args[0])) {
    throw new CliError(
      `Unknown application: ${args[0]}. Supported aliases: gnb, gemini-notebook, notebooklm`,
      2,
    );
  }

  const registry = new AccountRegistry(getAppPaths());
  const group = args[1];
  if (group === "auth") {
    await handleAuth(registry, args.slice(2));
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
