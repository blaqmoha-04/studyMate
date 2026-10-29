// DEVELOPMENT ONLY. Creates one clearly-labelled sample account with sample data.
//   npm run seed
// Refuses to run when NODE_ENV=production. Never run this against a real deployment.
import pg from 'pg';
import { hashPassword } from '../src/utils/crypto.js';

if (process.env.NODE_ENV === 'production') { console.error('Refusing to seed: NODE_ENV=production. Sample accounts must never exist in production.'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(1); }

const EMAIL = 'demo@studymate.test';
const PASSWORD = 'demo-password-123'; // sample credential, development only
const day = (n, h = 12) => new Date(Date.now() + n * 86400000 + (h - 12) * 3600000).toISOString();
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query('DELETE FROM users WHERE lower(email) = $1 AND is_seed_user', [EMAIL]);
  const { rows: [u] } = await client.query(
    `INSERT INTO users (email, name, password_hash, timezone, is_seed_user, terms_accepted_at, terms_version) VALUES ($1,$2,$3,$4,true, now(), 'seed') RETURNING id`,
    [EMAIL, 'Demo Student (sample data)', await hashPassword(PASSWORD), 'UTC']);
  const A = (t, s, p, st, due, est) => client.query(
    `INSERT INTO assignments (user_id,title,subject,priority,status,due_at,estimated_minutes,completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $5='completed' THEN now() END)`, [u.id, t, s, p, st, due, est]);
  await A('[Sample] Physics lab report', 'Physics', 'high', 'in_progress', day(2), 120);
  await A('[Sample] Calculus problem set 4', 'Mathematics', 'urgent', 'todo', day(1), 90);
  await A('[Sample] Essay draft', 'History', 'medium', 'todo', day(6), 180);
  await A('[Sample] Late reading response', 'English', 'low', 'todo', day(-1), 30);
  await A('[Sample] Chemistry quiz prep', 'Chemistry', 'medium', 'completed', day(-3), 45);
  const C = (s, l, loc, d, a, b, col) => client.query(`INSERT INTO class_schedules (user_id,subject,lecturer,location,day_of_week,start_time,end_time,color) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [u.id, s, l, loc, d, a, b, col]);
  await C('Calculus II', 'Dr. Adjei', 'Room 101', 1, '09:00', '10:30', '#2563eb'); await C('Physics', 'Prof. Owusu', 'Lab 2', 2, '11:00', '12:30', '#7c3aed');
  await C('History', 'Dr. Boateng', 'Hall B', 3, '14:00', '15:30', '#059669'); await C('Chemistry', 'Dr. Mensah', 'Lab 1', 4, '10:00', '11:30', '#dc2626');
  await client.query(`INSERT INTO study_notes (user_id,title,subject,content,tags,pinned) VALUES ($1,'[Sample] Newton''s laws','Physics','1. Inertia\n2. F = ma\n3. Action and reaction','{physics,exam}',true)`, [u.id]);
  await client.query(`INSERT INTO exams (user_id,subject,title,exam_at,venue) VALUES ($1,'Mathematics','[Sample] Midterm',$2,'Main Hall')`, [u.id, day(9, 9)]);
  await client.query(`INSERT INTO study_sessions (user_id,status,subject,started_at,ended_at,actual_seconds,accumulated_seconds) VALUES ($1,'completed','Physics',now()-interval '3 hours',now()-interval '2 hours',3600,3600)`, [u.id]);
  await client.query('COMMIT');
  console.log(`Seeded sample user ${EMAIL} (password: ${PASSWORD}) — DEVELOPMENT ONLY.`);
} catch (e) { await client.query('ROLLBACK'); console.error('Seed failed:', e.message); process.exitCode = 1; } finally { await client.end(); }
