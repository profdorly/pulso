import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class EditionLockError extends Error {
  constructor(message = "edition already running") {
    super(message);
    this.name = "EditionLockError";
  }
}

export async function withEditionLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  mkdirSync(path.dirname(lockPath), { recursive: true });

  if (existsSync(lockPath)) {
    const raw = readFileSync(lockPath, "utf8").trim();
    const pid = Number.parseInt(raw, 10);
    if (Number.isFinite(pid) && pidAlive(pid)) {
      throw new EditionLockError();
    }
    unlinkSync(lockPath);
  }

  try {
    writeFileSync(lockPath, String(process.pid), { flag: "wx" });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      throw new EditionLockError();
    }
    throw error;
  }

  try {
    return await fn();
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      // lock already gone
    }
  }
}
