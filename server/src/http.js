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

// Errors the body parser raises about the CLIENT's request, by their `type`.
const CLIENT_ERROR_CODES = {
  "entity.parse.failed": "bad_json",
  "entity.too.large": "payload_too_large",
  "charset.unsupported": "unsupported_media",
  "encoding.unsupported": "unsupported_media",
};
const STATUS_CODES = {
  400: "bad_request",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  413: "payload_too_large",
  415: "unsupported_media",
  431: "headers_too_large",
};

/** The 4xx status a framework error carries (body-parser, express, http-errors set `status` and `statusCode`), or null. */
function clientStatus(err) {
  const status = err?.status ?? err?.statusCode;
  return Number.isInteger(status) && status >= 400 && status < 500 ? status : null;
}

/** Client mistakes are the client's business: logged only when LOG_LEVEL=debug, never as errors. */
function debug(message) {
  if (process.env.LOG_LEVEL === "debug") console.debug("[moonshard]", message);
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, ...err.extra });
  if (err?.code === "CHAIN_UNAVAILABLE") return res.status(503).json({ error: "chain_unavailable" });
  const status = clientStatus(err);
  if (status) {
    const code = CLIENT_ERROR_CODES[err.type] ?? STATUS_CODES[status] ?? "bad_request";
    debug(`${status} ${code} ${req.method} ${req.path}: ${err.message}`);
    return res.status(status).json({ error: code });
  }
  console.error("[moonshard]", err);
  return res.status(500).json({ error: "internal_error" });
}
