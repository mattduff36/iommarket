function missingRequestStore(api: "cookies" | "headers" | "draftMode"): never {
  throw new Error(
    `\`${api}\` was called outside a request scope. Read more: https://nextjs.org/docs/messages/next-dynamic-api-wrong-context`,
  );
}

export async function cookies(): Promise<{
  get: (name: string) => { name: string; value: string } | undefined;
  set: (...args: unknown[]) => void;
}> {
  missingRequestStore("cookies");
}

export async function headers(): Promise<Headers> {
  missingRequestStore("headers");
}

export async function draftMode(): Promise<{
  isEnabled: boolean;
  enable: () => void;
  disable: () => void;
}> {
  missingRequestStore("draftMode");
}
