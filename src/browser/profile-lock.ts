import { readlink } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { CliError } from "../errors.ts";

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Chrome's SingletonLock is a symlink to "<hostname>-<pid>". Chrome reclaims a
// lock left on this host by a process that no longer runs, so only a lock from
// another host or a live process means the profile is in use.
export async function isProfileInUse(profileDir: string): Promise<boolean> {
  let target: string;
  try {
    target = await readlink(join(profileDir, "SingletonLock"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return false;
    // A regular file is not Chrome's lock format, so keep treating it as in use.
    if (code === "EINVAL") return true;
    throw new CliError("Could not inspect the isolated browser profile lock.");
  }
  const match = /^(.+)-(\d+)$/.exec(target);
  if (!match || match[1] !== hostname()) return true;
  return processIsRunning(Number(match[2]));
}
