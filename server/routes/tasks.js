import { Router } from 'express';
import { db, logActivity, TASK_STATUSES } from '../db.js';
import { requireAuth, canEditPhase } from '../auth.js';
import { normaliseDates } from '../dates.js';

const router = Router();
router.use(requireAuth);

function loadTask(id) {
  return db
    .prepare(
      `SELECT t.*, ph.project_id, ph.pic_user_id, ph.name AS phase_name
       FROM tasks t JOIN phases ph ON ph.id = t.phase_id WHERE t.id = ?`
    )
    .get(id);
}

/** Add a sub-timeline under a stage. Open to the PM and to the stage's PIC. */
router.post('/', (req, res) => {
  const phaseId = Number(req.body?.phaseId);
  const { phase, allowed } = canEditPhase(req.user, phaseId);
  if (!phase) return res.status(404).json({ error: 'Stage not found' });
  if (!allowed) {
    return res.status(403).json({ error: 'Only the project manager or this stage’s PIC can add items' });
  }

  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Item name is required' });

  const status = TASK_STATUSES.includes(req.body?.status) ? req.body.status : 'Not Started';
  const { selectedDates, startDate, endDate } = normaliseDates(req.body?.selectedDates);
  const notes = String(req.body?.notes || '').trim();
  const assigneeId = Number(req.body?.assigneeId) || null;

  const pos = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM tasks WHERE phase_id = ?')
    .get(phaseId).m;

  const info = db
    .prepare(
      `INSERT INTO tasks (phase_id, name, status, start_date, end_date, selected_dates,
                          assignee_id, notes, position, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      phaseId, name, status, startDate, endDate, JSON.stringify(selectedDates),
      assigneeId, notes, pos + 1, req.user.id
    );

  logActivity(phase.project_id, req.user.id, 'added', `${name} (${phase.name})`);
  res.status(201).json({ taskId: Number(info.lastInsertRowid) });
});

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const task = loadTask(id);
  if (!task) return res.status(404).json({ error: 'Item not found' });

  const { allowed } = canEditPhase(req.user, task.phase_id);
  if (!allowed) {
    return res.status(403).json({ error: 'Only the project manager or this stage’s PIC can edit items' });
  }

  const name = req.body?.name === undefined ? task.name : String(req.body.name).trim();
  if (!name) return res.status(400).json({ error: 'Item name is required' });

  let status = task.status;
  if (req.body?.status !== undefined) {
    if (!TASK_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ error: 'Unknown status' });
    }
    status = req.body.status;
  }

  let selectedDates = JSON.parse(task.selected_dates || '[]');
  let startDate = task.start_date;
  let endDate = task.end_date;
  if (req.body?.selectedDates !== undefined) {
    const n = normaliseDates(req.body.selectedDates);
    selectedDates = n.selectedDates;
    startDate = n.startDate;
    endDate = n.endDate;
  }

  const notes = req.body?.notes === undefined ? task.notes : String(req.body.notes).trim();
  let assigneeId = task.assignee_id;
  if (req.body?.assigneeId !== undefined) {
    assigneeId = req.body.assigneeId === null || req.body.assigneeId === ''
      ? null
      : Number(req.body.assigneeId) || null;
  }

  let phaseId = task.phase_id;
  if (req.body?.phaseId !== undefined && Number(req.body.phaseId) !== task.phase_id) {
    const target = canEditPhase(req.user, Number(req.body.phaseId));
    if (!target.phase || target.phase.project_id !== task.project_id) {
      return res.status(400).json({ error: 'Cannot move this item to that stage' });
    }
    if (!target.allowed) return res.status(403).json({ error: 'You cannot edit the target stage' });
    phaseId = target.phase.id;
  }

  db.prepare(
    `UPDATE tasks SET phase_id = ?, name = ?, status = ?, start_date = ?, end_date = ?,
     selected_dates = ?, assignee_id = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(
    phaseId, name, status, startDate, endDate, JSON.stringify(selectedDates),
    assigneeId, notes, id
  );

  logActivity(task.project_id, req.user.id, 'updated', name);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const task = loadTask(id);
  if (!task) return res.status(404).json({ error: 'Item not found' });
  const { allowed } = canEditPhase(req.user, task.phase_id);
  if (!allowed) return res.status(403).json({ error: 'You cannot delete this item' });

  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  logActivity(task.project_id, req.user.id, 'removed', task.name);
  res.json({ ok: true });
});

/** Persist a new ordering of items inside one stage. */
router.post('/reorder', (req, res) => {
  const phaseId = Number(req.body?.phaseId);
  const order = Array.isArray(req.body?.order) ? req.body.order.map(Number) : [];
  const { phase, allowed } = canEditPhase(req.user, phaseId);
  if (!phase) return res.status(404).json({ error: 'Stage not found' });
  if (!allowed) return res.status(403).json({ error: 'You cannot reorder this stage' });

  const update = db.prepare('UPDATE tasks SET position = ? WHERE id = ? AND phase_id = ?');
  db.transaction(() => order.forEach((taskId, i) => update.run(i, taskId, phaseId)))();
  res.json({ ok: true });
});

export default router;
