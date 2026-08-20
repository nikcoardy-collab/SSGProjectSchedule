import { Router } from 'express';
import { logActivity, one, run, tx, TASK_STATUSES } from '../db.js';
import { requireAuth, canEditPhase } from '../auth.js';
import { normaliseDates } from '../dates.js';
import { a, idParam, toId } from '../util.js';

const router = Router();
router.use(requireAuth);
router.param('id', idParam);

function loadTask(id) {
  return one(
    `SELECT t.*, ph.project_id, ph.pic_user_id, ph.name AS phase_name,
            dep.name AS depends_on_name, dep.status AS depends_on_status
     FROM tasks t
     JOIN phases ph ON ph.id = t.phase_id
     LEFT JOIN tasks dep ON dep.id = t.depends_on
     WHERE t.id = ?`,
    [id]
  );
}

/**
 * Checks a proposed predecessor: it must exist in the same project, must not be
 * the task itself, and must not create a circular chain. Returns the predecessor
 * row so callers can also enforce the blocked-status rule.
 */
async function validateDependency(taskId, dependsOn, projectId) {
  if (dependsOn === null) return { dep: null };
  if (taskId !== null && dependsOn === taskId) {
    return { error: 'An item cannot come after itself' };
  }
  const dep = await one(
    `SELECT t.id, t.name, t.status, t.depends_on, ph.project_id
     FROM tasks t JOIN phases ph ON ph.id = t.phase_id WHERE t.id = ?`,
    [dependsOn]
  );
  if (!dep || dep.project_id !== projectId) {
    return { error: 'That item is not in this project' };
  }
  let cursor = dep.depends_on;
  let hops = 0;
  while (cursor !== null && hops < 100) {
    if (cursor === taskId) return { error: 'That would create a circular chain' };
    const row = await one('SELECT depends_on FROM tasks WHERE id = ?', [cursor]);
    cursor = row ? row.depends_on : null;
    hops += 1;
  }
  return { dep };
}

const startedStatuses = ['In Progress', 'Complete'];

/** Add a sub-timeline item under a stage. Open to the PM and to the stage's PIC. */
router.post('/', a(async (req, res) => {
  const phaseId = toId(req.body?.phaseId);
  if (phaseId === null) return res.status(404).json({ error: 'Stage not found' });
  const { phase, allowed } = await canEditPhase(req.user, phaseId);
  if (!phase) return res.status(404).json({ error: 'Stage not found' });
  if (!allowed) {
    return res
      .status(403)
      .json({ error: 'Only the project manager or this stage’s PIC can add items' });
  }

  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Item name is required' });

  const status = TASK_STATUSES.includes(req.body?.status) ? req.body.status : 'Not Started';
  const { selectedDates, startDate, endDate } = normaliseDates(req.body?.selectedDates);
  const notes = String(req.body?.notes || '').trim();
  const assigneeId = toId(req.body?.assigneeId);

  const dependsOn = toId(req.body?.dependsOn);
  const depCheck = await validateDependency(null, dependsOn, phase.project_id);
  if (depCheck.error) return res.status(400).json({ error: depCheck.error });
  if (depCheck.dep && depCheck.dep.status !== 'Complete' && startedStatuses.includes(status)) {
    return res.status(400).json({
      error: `Blocked by "${depCheck.dep.name}" — that item has to be completed first`,
    });
  }

  const { m } = await one(
    'SELECT coalesce(max(position), -1) AS m FROM tasks WHERE phase_id = ?',
    [phaseId]
  );

  const task = await one(
    `INSERT INTO tasks (phase_id, name, status, start_date, end_date, selected_dates,
                        assignee_id, notes, position, created_by, depends_on)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [phaseId, name, status, startDate, endDate, JSON.stringify(selectedDates),
     assigneeId, notes, m + 1, req.user.id, dependsOn]
  );

  await logActivity(phase.project_id, req.user.id, 'added', `${name} (${phase.name})`);
  res.status(201).json({ taskId: task.id });
}));

router.patch('/:id', a(async (req, res) => {
  const id = Number(req.params.id);
  const task = await loadTask(id);
  if (!task) return res.status(404).json({ error: 'Item not found' });

  const { allowed } = await canEditPhase(req.user, task.phase_id);
  if (!allowed) {
    return res
      .status(403)
      .json({ error: 'Only the project manager or this stage’s PIC can edit items' });
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

  let selectedDates = task.selected_dates ?? [];
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
    assigneeId = toId(req.body.assigneeId);
  }

  let dependsOn = task.depends_on;
  let depName = task.depends_on_name;
  let depStatus = task.depends_on_status;
  if (req.body?.dependsOn !== undefined) {
    dependsOn = toId(req.body.dependsOn);
    const depCheck = await validateDependency(id, dependsOn, task.project_id);
    if (depCheck.error) return res.status(400).json({ error: depCheck.error });
    depName = depCheck.dep ? depCheck.dep.name : null;
    depStatus = depCheck.dep ? depCheck.dep.status : null;
  }
  if (dependsOn && depStatus !== 'Complete' && startedStatuses.includes(status)) {
    return res.status(400).json({
      error: `Blocked by "${depName}" — that item has to be completed first`,
    });
  }

  let phaseId = task.phase_id;
  const requestedPhase = req.body?.phaseId === undefined ? null : toId(req.body.phaseId);
  if (requestedPhase !== null && requestedPhase !== task.phase_id) {
    const target = await canEditPhase(req.user, requestedPhase);
    if (!target.phase || target.phase.project_id !== task.project_id) {
      return res.status(400).json({ error: 'Cannot move this item to that stage' });
    }
    if (!target.allowed) return res.status(403).json({ error: 'You cannot edit the target stage' });
    phaseId = target.phase.id;
  }

  await run(
    `UPDATE tasks SET phase_id = ?, name = ?, status = ?, start_date = ?, end_date = ?,
     selected_dates = ?, assignee_id = ?, notes = ?, depends_on = ?, updated_at = now()
     WHERE id = ?`,
    [phaseId, name, status, startDate, endDate, JSON.stringify(selectedDates),
     assigneeId, notes, dependsOn, id]
  );

  await logActivity(task.project_id, req.user.id, 'updated', name);
  res.json({ ok: true });
}));

router.delete('/:id', a(async (req, res) => {
  const id = Number(req.params.id);
  const task = await loadTask(id);
  if (!task) return res.status(404).json({ error: 'Item not found' });

  const { allowed } = await canEditPhase(req.user, task.phase_id);
  if (!allowed) return res.status(403).json({ error: 'You cannot delete this item' });

  await run('DELETE FROM tasks WHERE id = ?', [id]);
  await logActivity(task.project_id, req.user.id, 'removed', task.name);
  res.json({ ok: true });
}));

/** Persist a new ordering of items inside one stage. */
router.post('/reorder', a(async (req, res) => {
  const phaseId = toId(req.body?.phaseId);
  const order = (Array.isArray(req.body?.order) ? req.body.order : [])
    .map(toId)
    .filter((id) => id !== null);
  if (phaseId === null) return res.status(404).json({ error: 'Stage not found' });
  const { phase, allowed } = await canEditPhase(req.user, phaseId);
  if (!phase) return res.status(404).json({ error: 'Stage not found' });
  if (!allowed) return res.status(403).json({ error: 'You cannot reorder this stage' });

  await tx(async (t) => {
    for (const [i, taskId] of order.entries()) {
      await t.run('UPDATE tasks SET position = ? WHERE id = ? AND phase_id = ?', [
        i,
        taskId,
        phaseId,
      ]);
    }
  });
  res.json({ ok: true });
}));

export default router;
