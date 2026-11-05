// Every failure the package raises carries a stable `code` apps can branch on and an HTTP-ish `status`.
export class PayError extends Error {
  constructor(code, message, { status = 400, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "PayError";
    this.code = code;
    this.status = status;
  }
}

export function toPayError(error) {
  if (error instanceof PayError) return error;
  if (typeof error?.type === "string" && error.type.startsWith("Stripe")) {
    return new PayError(error.code || "stripe_error", error.message, { status: error.statusCode || 402, cause: error });
  }
  return new PayError("internal_error", error?.message || String(error), { status: 500, cause: error });
}

// Plain object for Server Actions: `{ error: { code, message } }`.
export function serializePayError(error) {
  const payError = toPayError(error);
  return { code: payError.code, message: payError.message };
}

export function requireValue(value, name) {
  if (value === undefined || value === null || value === "") {
    throw new PayError("invalid_request", `\`${name}\` is required.`);
  }
  return value;
}
