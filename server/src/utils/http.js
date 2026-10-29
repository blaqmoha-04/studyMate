// Express 4 doesn't catch rejected promises; this forwards them to the central error handler.
export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
