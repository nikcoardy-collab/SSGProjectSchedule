import { Router } from 'express';
import { logActivity, many, one, run, tx, TASK_STATUSES } from '../db.js';
import { requireAuth, canEditPhase } from '../auth.js';
import { normaliseDates } from '../dates.js';
import { a, idParam, toId } from '../util.js';

const router = Router();
router.use(requireAuth);
router.param('id', idParam);

const startedStatuses = ['In Progress', 'Complete'];
const MAX_DEPS = 20;

function loadTask(id) {
  return one(
    `SELECT t.*, ph.project_id, ph.pic_user_id, ph.name AS phase_name
     FROM tasks t JOIN phases ph ON ph.id = t.phase_id WHERE t.id = ?`,
    [id]
  );
}

function loadPredecessors(taskId) {
  return many(
    `SELECT p.id, p.name, p.status FROM task_deps d
     JOIN tasks p ON p.id = d.depends_on WHERE d.task_id = ? ORDER BY p.id`,
    [taskId]
  );
}

/** Accepts null, a single id, or an array of ids; returns a deduped id list. */
function normaliseDepInput(raw) {
  const list = raw === null || raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return [...new Set(list.map(toId).filter((id) => id !== null))];
}

/**
 * Checks proposed predecessors: each must exist in the same project, none may be
 * the task itself, and none may create a circular chain. Returns the predecessor
 * rows so callers can also enforce the blocked-status rule.
 */
async function validateDependencies(taskId, depIds, projectId) {
  if (depIds.length === 0) return { deps: [] };
  if (depIds.length > MAX_DEPS) return { error: `At most ${MAX_DEPS} links per item` };
  if (taskId !== null && depIds.includes(taskId)) {
    return { error: 'An item cannot come after itself' };
  }

  const placeholders = depIds.map(() => '?').join(', ');
  const deps = await many(
    `SELECT t.id, t.name, t.status, ph.project_id
     FROM tasks t JOIN phases ph ON ph.id = t.phase_id
     WHERE t.id IN (${placeholders})`,
    depIds
  );
  if (deps.length !== depIds.length || deps.some((d) => d.project_id !== projectId)) {
    return { error: 'That item is not in this project' };
  }

  // Walk everything the proposed predecessors transitively come after; finding
  // this task there would close a loop.
  const queue = [...depIds];
  const seen = new Set(queue);
  let hops = 0;
  while (queue.length > 0 && hops < 500) {
    const cur = queue.shift();
    if (cur === taskId) return { error: 'That would create a circular chain' };
    const rows = await many('SELECT depends_on FROM task_deps WHERE task_id = ?', [cur]);
    for (const row of rows) {
      if (!seen.has(row.depends_on)) {
        seen.add(row.depends_on);
        queue.push(row.depends_on);
      }
    }
    hops += 1;
  }

  return { deps };
}

const firstIncomplete = (deps) => deps.find((d) => d.status !== 'Complete');

async function replaceDeps(taskId, depIds) {
  await tx(async (t) => {
    await t.run('DELETE FROM task_deps WHERE task_id = ?', [taskId]);
    for (const depId of depIds) {
      await t.run('INSERT INTO task_deps (task_id, depends_on) VALUES (?, ?)', [taskId, depId]);
    }
  });
}

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

  const depIds = normaliseDepInput(req.body?.dependsOn);
  const depCheck = await validateDependencies(null, depIds, phase.project_id);
  if (depCheck.error) return res.status(400).json({ error: depCheck.error });
  const blocking = firstIncomplete(depCheck.deps);
  if (blocking && startedStatuses.includes(status)) {
    return res.status(400).json({
      error: `Blocked by "${blocking.name}" — that item has to be completed first`,
    });
  }

  const { m } = await one(
    'SELECT coalesce(max(position), -1) AS m FROM tasks WHERE phase_id = ?',
    [phaseId]
  );

  const task = await one(
    `INSERT INTO tasks (phase_id, name, status, start_date, end_date, selected_dates,
                        assignee_id, notes, position, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [phaseId, name, status, startDate, endDate, JSON.stringify(selectedDates),
     assigneeId, notes, m + 1, req.user.id]
  );
  if (depIds.length) await replaceDeps(task.id, depIds);

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

  let deps;
  let depsChanged = false;
  if (req.body?.dependsOn !== undefined) {
    const depIds = normaliseDepInput(req.body.dependsOn);
    const depCheck = await validateDependencies(id, depIds, task.project_id);
    if (depCheck.error) return res.status(400).json({ error: depCheck.error });
    deps = depCheck.deps;
    depsChanged = true;
  } else {
    deps = await loadPredecessors(id);
  }
  const blocking = firstIncomplete(deps);
  if (blocking && startedStatuses.includes(status)) {
    return res.status(400).json({
      error: `Blocked by "${blocking.name}" — that item has to be completed first`,
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
     selected_dates = ?, assignee_id = ?, notes = ?, updated_at = now()
     WHERE id = ?`,
    [phaseId, name, status, startDate, endDate, JSON.stringify(selectedDates),
     assigneeId, notes, id]
  );
  if (depsChanged) await replaceDeps(id, deps.map((d) => d.id));

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
        i, taskId, phaseId,
      ]);
    }
  });
  res.json({ ok: true });
}));

export default router;
