import { lookup } from "node:dns/promises";

type ResolveConnectionOptions = {
  serviceHost: string;
  fallbackHost: string;
  fallbackPort: number;
  fallbackLabel: string;
};

function replacePort(url: URL, port: number): void {
  url.port = String(port);
}

export async function resolveConnectionString(
  rawConnectionString: string,
  options: ResolveConnectionOptions,
): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawConnectionString);
  } catch {
    return rawConnectionString;
  }

  if (url.hostname !== options.serviceHost) {
    return rawConnectionString;
  }

  try {
    await lookup(url.hostname);
    return rawConnectionString;
  } catch {
    const next = new URL(rawConnectionString);
    next.hostname = options.fallbackHost;
    replacePort(next, options.fallbackPort);
    console.log(
      `[Storage] ${options.fallbackLabel} host ${url.hostname} is not resolvable here, falling back to ${options.fallbackHost}:${options.fallbackPort}`,
    );
    return next.toString();
  }
}
