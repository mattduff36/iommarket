export type RuntimeEnv = {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  [key: string]: string | undefined;
};
