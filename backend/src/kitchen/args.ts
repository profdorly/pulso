import path from "node:path";

/** The value after `flag` (`--flag value` or `--flag=value`), or undefined. */
export function argValue(flag: string, argv: readonly string[] = process.argv): string | undefined {
  const inline = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

export function hasFlag(flag: string, argv: readonly string[] = process.argv): boolean {
  return argv.includes(flag);
}

/**
 * A path the user typed, resolved where they typed it. `npm run --workspace` starts the script
 * inside `backend/`; npm keeps the original directory in INIT_CWD.
 */
export function userPath(value: string): string {
  return path.resolve(process.env.INIT_CWD ?? process.cwd(), value);
}

/** `file` as the user would type it from where they ran the command. */
export function shownPath(file: string): string {
  return path.relative(process.env.INIT_CWD ?? process.cwd(), file) || file;
}
