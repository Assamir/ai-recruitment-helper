export function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function fileResponse(
  body: string,
  opts: { contentType: string; filename?: string; disposition?: "attachment" | "inline" },
): Response {
  const disposition = opts.disposition ?? "inline";
  const headers: Record<string, string> = { "Content-Type": opts.contentType };
  if (opts.filename) {
    headers["Content-Disposition"] = `${disposition}; filename="${opts.filename}"`;
  }
  return new Response(body, { status: 200, headers });
}
