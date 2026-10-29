// Small helpers for building safe, parameterised SQL. Values are NEVER interpolated into SQL text.
export function buildUpdate(patch, columnMap) {
  const sets = []; const values = [];
  for (const [key, column] of Object.entries(columnMap)) {
    if (patch[key] !== undefined) { values.push(patch[key]); sets.push(`${column} = $${values.length}`); }
  }
  return { sets, values };
}

export const likePattern = (q) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

export function whereBuilder(userId) {
  const where = ['user_id = $1']; const vals = [userId];
  return {
    where, vals,
    add(sql, value) { vals.push(value); where.push(sql.replaceAll('?', `$${vals.length}`)); },
    raw(sql) { where.push(sql); },
    clause() { return where.join(' AND '); },
  };
}

export const pageMeta = (page, pageSize, total) => ({ page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });

const camelKey = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
export function toDto(row, { drop = ['user_id'] } = {}) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) if (!drop.includes(k)) out[camelKey(k)] = v;
  return out;
}
