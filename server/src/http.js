export class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** Express 4 does not catch async rejections; wrap every async handler. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, ...err.extra });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "bad_json" });
  if (err?.code === "CHAIN_UNAVAILABLE") return res.status(503).json({ error: "chain_unavailable" });
  console.error("[moonshard]", err);
  return res.status(500).json({ error: "internal_error" });
}
