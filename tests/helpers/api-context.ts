import { vi } from "vitest";
import type { APIContext } from "astro";

export interface MakeApiContextOpts {
  user?: { id: string } | null;
  params?: Record<string, string>;
  request?: Request;
  url?: string;
  waitUntil?: (p: Promise<unknown>) => void;
}

import { USER_A } from "./ids";

const DEFAULT_USER = { id: USER_A };

/**
 * Synthetic APIContext for route-handler integration tests.
 * Mirrors the shape used in tests/lib/api/analysis-retry-garbage.test.ts.
 */
export function makeApiContext(opts: MakeApiContextOpts = {}): APIContext {
  const url = opts.url ?? "http://localhost/api/analysis";
  return {
    request: opts.request ?? new Request(url, { method: "GET" }),
    params: opts.params ?? {},
    url: new URL(url),
    locals: {
      user: opts.user === undefined ? DEFAULT_USER : opts.user,
      cfContext: { waitUntil: opts.waitUntil ?? vi.fn() },
    },
    cookies: {
      set: vi.fn(),
      get: vi.fn(),
      has: vi.fn(),
      delete: vi.fn(),
      headers: vi.fn(),
    },
    redirect: vi.fn(),
    clientAddress: "127.0.0.1",
    site: new URL("http://localhost"),
    generator: "test",
    props: {},
  } as unknown as APIContext;
}
