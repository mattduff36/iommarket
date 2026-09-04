export function parseRebuildArgs(argv: string[]) {
  const confirmArg = argv.find((arg) => arg.startsWith("--confirm="));
  return {
    confirm: confirmArg ? confirmArg.slice("--confirm=".length) : undefined,
  };
}
