/**
 * Express 4 does not catch rejections from async handlers, so every route is wrapped
 * to forward them to the error middleware instead of leaving a dangling promise.
 */
export const a = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const MAX_INT4 = 2_147_483_647;

/**
 * Parses a value into a row id, or null when it is not one. Postgres rejects a
 * non-integer parameter for an integer column outright, so ids have to be checked
 * before they reach a query rather than being left to match nothing.
 */
export function toId(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= MAX_INT4 ? n : null;
}

/** Router-level guard: turns `:id` into a number, or 404s if it is not one. */
export const idParam = (req, res, next, value) => {
  const id = toId(value);
  if (id === null) return res.status(404).json({ error: 'Not found' });
  req.params.id = id;
  next();
};
