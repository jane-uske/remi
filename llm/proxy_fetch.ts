import { fetch as undiciFetch, ProxyAgent } from "undici";

type OpenAiFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function resolveProxyUrl(targetUrl: string): string | undefined {
  const explicitProxy = process.env.REMI_LLM_PROXY_URL?.trim();
  if (explicitProxy) return explicitProxy;

  const protocol = new URL(targetUrl).protocol;
  if (protocol === "https:") {
    return (
      process.env.HTTPS_PROXY ??
      process.env.https_proxy ??
      process.env.HTTP_PROXY ??
      process.env.http_proxy
    );
  }
  return process.env.HTTP_PROXY ?? process.env.http_proxy;
}

export function createProxyFetch(baseURL: string): OpenAiFetch | undefined {
  const proxyUrl = resolveProxyUrl(baseURL);
  if (!proxyUrl) return undefined;

  const dispatcher = new ProxyAgent(proxyUrl);
  return (input: string | URL | Request, init?: RequestInit) =>
    undiciFetch(input as Parameters<typeof undiciFetch>[0], {
      ...(init as Record<string, unknown>),
      dispatcher,
    } as Parameters<typeof undiciFetch>[1]) as Promise<Response>;
}
