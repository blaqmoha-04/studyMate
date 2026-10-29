import { z } from 'zod';
import { isoDate, pagination, nameField, emailField, timezoneField } from './common.js';

const text = (max) => z.string().trim().max(max);
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const nonEmpty = (o) => Object.keys(o).length > 0;
const patchOf = (shape) => z.object(shape).partial().strict().refine(nonEmpty, 'Provide at least one field to update');
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #2563eb');

// ---- assignments
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUSES = ['todo', 'in_progress', 'completed'];
const assignmentShape = {
  title: text(200).min(1, 'Title is required'),
  description: text(5000),
  subject: text(100),
  priority: z.enum(PRIORITIES),
  status: z.enum(STATUSES),
  dueAt: isoDate,
  estimatedMinutes: z.number().int().min(1).max(10080).nullable(),
};
export const assignmentCreate = z.object({ ...assignmentShape, description: assignmentShape.description.default(''),
  subject: assignmentShape.subject.default(''), priority: assignmentShape.priority.default('medium'),
  status: assignmentShape.status.default('todo'), estimatedMinutes: assignmentShape.estimatedMinutes.optional() }).strict();
export const assignmentPatch = patchOf(assignmentShape);
export const assignmentQuery = z.object({
  ...pagination,
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  subject: text(100).optional(),
  q: text(100).optional(),
  overdue: bool.optional(),
  dueFrom: isoDate.optional(),
  dueTo: isoDate.optional(),
  sort: z.enum(['due', 'priority', 'created']).default('due'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

// ---- classes
export const classShape = {
  subject: text(100).min(1, 'Subject is required'),
  lecturer: text(100), location: text(100),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: time, endTime: time, color,
};
export const classCreate = z.object({ ...classShape, lecturer: classShape.lecturer.default(''),
  location: classShape.location.default(''), color: classShape.color.default('#2563eb') }).strict()
  .refine((c) => c.endTime > c.startTime, { path: ['endTime'], message: 'End time must be after start time' });
export const classPatch = patchOf(classShape);

// ---- notes
const tags = z.array(text(30).min(1)).max(20).transform((a) => [...new Set(a.map((t) => t.toLowerCase()))]);
const noteShape = { title: text(200).min(1, 'Title is required'), subject: text(100), content: z.string().max(100000), tags, pinned: z.boolean() };
export const noteCreate = z.object({ ...noteShape, subject: noteShape.subject.default(''), content: noteShape.content.default(''),
  tags: tags.default([]), pinned: noteShape.pinned.default(false) }).strict();
export const notePatch = z.object({ ...Object.fromEntries(Object.entries(noteShape).map(([k, v]) => [k, v.optional()])),
  // Optimistic concurrency for autosave: the updatedAt the client last saw.
  baseUpdatedAt: isoDate.optional() }).strict()
  .refine((o) => Object.keys(o).filter((k) => k !== 'baseUpdatedAt').length > 0, 'Provide at least one field to update');
export const noteQuery = z.object({ ...pagination, q: text(100).optional(), subject: text(100).optional(),
  tag: text(30).optional(), pinned: bool.optional() });

// ---- exams
const examShape = { subject: text(100).min(1, 'Subject is required'), title: text(200).min(1, 'Title is required'),
  examAt: isoDate, venue: text(200), notes: text(5000) };
export const examCreate = z.object({ ...examShape, venue: examShape.venue.default(''), notes: examShape.notes.default('') }).strict();
export const examPatch = patchOf(examShape);
export const examQuery = z.object({ ...pagination, when: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
  subject: text(100).optional(), order: z.enum(['asc', 'desc']).optional() });

// ---- study sessions
const uuid = z.uuid('Invalid id');
const refs = { assignmentId: uuid.nullable(), examId: uuid.nullable() };
export const studyPlanCreate = z.object({ subject: text(100).default(''), notes: text(2000).default(''),
  plannedStart: isoDate, plannedMinutes: z.number().int().min(1).max(720),
  assignmentId: refs.assignmentId.optional(), examId: refs.examId.optional() }).strict();
export const studyPlanPatch = patchOf({ subject: text(100), notes: text(2000), plannedStart: isoDate,
  plannedMinutes: z.number().int().min(1).max(720), ...refs });
export const studyStart = z.object({ subject: text(100).optional(), assignmentId: refs.assignmentId.optional(),
  examId: refs.examId.optional(), focusMinutes: z.number().int().min(1).max(240).optional(),
  breakMinutes: z.number().int().min(1).max(60).optional(), fromPlannedId: uuid.optional() }).strict();
export const studyQuery = z.object({ ...pagination, status: z.enum(['planned', 'running', 'paused', 'completed', 'cancelled']).optional(),
  from: isoDate.optional(), to: isoDate.optional() });

// ---- calendar
export const calendarQuery = z.object({ from: dateOnly, to: dateOnly,
  types: z.string().regex(/^(assignment|class|exam|study)(,(assignment|class|exam|study))*$/).optional() })
  .refine((q) => q.to >= q.from, { path: ['to'], message: '"to" must not be before "from"' })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86400000 <= 93, { path: ['to'], message: 'Range may not exceed 93 days' });

// ---- notifications
export const notificationQuery = z.object({ ...pagination, unread: bool.optional() });

// ---- account
export const profilePatch = z.object({ name: nameField.optional(), email: emailField.optional(), learningGoal: text(500).optional(),
  currentPassword: z.string().max(128).optional() }).strict()
  .refine((o) => o.name !== undefined || o.email !== undefined || o.learningGoal !== undefined, 'Provide something to update')
  .refine((o) => !o.email || o.currentPassword, { path: ['currentPassword'], message: 'Current password is required to change email' });
export const preferencesPatch = patchOf({
  theme: z.enum(['light', 'dark', 'system']), timezone: timezoneField, weekStart: z.number().int().min(0).max(6),
  notifications: z.object({ deadlines: z.boolean(), exams: z.boolean(), study: z.boolean() }).partial().strict(),
});
export const resetProgressBody = z.object({ password: z.string().min(1).max(128), confirm: z.literal('RESET', { error: 'Type RESET to confirm' }) }).strict();
export const deleteAccountBody = z.object({ password: z.string().min(1).max(128), confirm: z.literal('DELETE', { error: 'Type DELETE to confirm' }) }).strict();
