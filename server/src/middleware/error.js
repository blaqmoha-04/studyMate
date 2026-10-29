import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';

const DB_UNAVAILABLE = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE']);

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
}

export function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    let status = 500; let code = 'internal_error'; let message = 'Something went wrong on our side.'; let details;

    if (err instanceof AppError) {
      ({ status, code, message, details } = err);
    } else if (err instanceof ZodError) {
      status = 400; code = 'validation_error'; message = 'Some fields are invalid.';
      details = err.issues.map((i) => ({ field: i.path.join('.') || '(body)', message: i.message }));
    } else if (err.type === 'entity.too.large') {
      status = 413; code = 'payload_too_large'; message = 'Request body is too large.';
    } else if (err.type === 'entity.parse.failed') {
      status = 400; code = 'invalid_json'; message = 'Request body is not valid JSON.';
    } else if (err.code === '23505') {
      status = 409; code = 'conflict'; message = 'A record with these values already exists.';
    } else if (['22P02', '22007', '22008', '22003', '23514', '22001'].includes(err.code)) {
      status = 400; code = 'invalid_value'; message = 'One or more values are invalid.';
    } else if (err.code === '23503') {
      status = 409; code = 'conflict'; message = 'This record is linked to another record that does not exist or is in use.';
    } else if (DB_UNAVAILABLE.has(err.code) || /^(08|57P0|53)/.test(err.code ?? '') ||
               /Connection terminated|timeout exceeded when trying to connect/i.test(err.message ?? '')) {
      status = 503; code = 'database_unavailable'; message = 'The service is temporarily unavailable. Please try again shortly.';
    }

    if (status >= 500) logger.error({ err: { message: err.message, code: err.code, stack: err.stack }, reqId: req.id }, 'request failed');
    res.status(status).json({ error: { code, message, ...(details ? { details } : {}), requestId: req.id } });
  };
}
