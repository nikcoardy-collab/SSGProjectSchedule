import { Router } from 'express';
import { logActivity, many, one, run, tx, TASK_STATUSES } from '../db.js';
import { requireAuth, canEditPhase } from '../auth.js';
import { expandRange, isIsoDate, normaliseDates } from '../dates.js';
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
    `SELECT p.id, p.name, p.status, d.for_day FROM task_deps d
     JOIN tasks p ON p.id = d.depends_on WHERE d.task_id = ? ORDER BY p.id`,
    [taskId]
  );
}

/** The days an item actually occupies, however its dates were stored. */
function effectiveDays(selectedDates, startDate, endDate) {
  if (Array.isArray(selectedDates) && selectedDates.length > 0) return selectedDates;
  if (startDate && endDate) return expandRange(startDate, endDate);
  return [];
}

/**
 * Accepts null, a single id, an array of ids, or an array of {id, forDay}
 * objects. Returns deduped edges; forDay null means the link covers the whole
 * item, an ISO date scopes it to the stretch of work containing that day.
 */
function normaliseDepInput(raw) {
  const list = raw === null || raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const edges = [];
  const seen = new Set();
  for (const entry of list) {
    let id = null;
    let forDay = null;
    if (entry !== null && typeof entry === 'object') {
      id = toId(entry.id);
      if (entry.forDay !== null && entry.forDay !== undefined && entry.forDay !== '') {
        if (!isIsoDate(String(entry.forDay))) return { error: 'A link day is invalid' };
        forDay = String(entry.forDay);
      }
    } else {
      id = toId(entry);
    }
    if (id === null) continue;
    const key = `${id}|${forDay ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push({ id, forDay });
    }
  }
  return { edges };
}

/**
 * Checks proposed predecessors: each must exist in the same project, none may be
 * the task itself, and none may create a circular chain. Returns the predecessor
 * rows so callers can also enforce the blocked-status rule.
 */
async function validateDependencies(taskId, edges, projectId) {
  if (edges.length === 0) return { deps: [] };
  if (edges.length > MAX_DEPS) return { error: `At most ${MAX_DEPS} links per item` };
  const depIds = [...new Set(edges.map((e) => e.id))];
  if (taskId !== null && depIds.includes(taskId)) {
    return { error: 'An item cannot come after itself' };
  }

  const placeholders = depIds.map(() => '?').join(', ');
  const rows = await many(
    `SELECT t.id, t.name, t.status, ph.project_id
     FROM tasks t JOIN phases ph ON ph.id = t.phase_id
     WHERE t.id IN (${placeholders})`,
    depIds
  );
  if (rows.length !== depIds.length || rows.some((d) => d.project_id !== projectId)) {
    return { error: 'That item is not in this project' };
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const deps = edges.map((e) => ({ ...byId.get(e.id), forDay: e.forDay }));

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

/**
 * Which incomplete link stands in the way, honouring scope: item-wide links
 * always count; day-scoped links count only against completing the item, and
 * only while their day is still on the schedule.
 */
function firstBlocking(deps, targetStatus, days) {
  const daySet = new Set(days);
  return deps.find((d) => {
    if (d.status === 'Complete') return false;
    if (d.forDay === null || d.forDay === undefined) return true;
    return targetStatus === 'Complete' && daySet.has(d.forDay);
  });
}

async function replaceDeps(taskId, edges) {
  await tx(async (t) => {
    await t.run('DELETE FROM task_deps WHERE task_id = ?', [taskId]);
    for (const e of edges) {
      await t.run('INSERT INTO task_deps (task_id, depends_on, for_day) VALUES (?, ?, ?)', [
        taskId, e.id, e.forDay,
      ]);
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

  const depInput = normaliseDepInput(req.body?.dependsOn);
  if (depInput.error) return res.status(400).json({ error: depInput.error });
  const depCheck = await validateDependencies(null, depInput.edges, phase.project_id);
  if (depCheck.error) return res.status(400).json({ error: depCheck.error });
  if (startedStatuses.includes(status)) {
    const blocking = firstBlocking(depCheck.deps, status, selectedDates);
    if (blocking) {
      return res.status(400).json({
        error: `Blocked by "${blocking.name}" — that item has to be completed first`,
      });
    }
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
  if (depInput.edges.length) await replaceDeps(task.id, depInput.edges);

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
    const depInput = normaliseDepInput(req.body.dependsOn);
    if (depInput.error) return res.status(400).json({ error: depInput.error });
    const depCheck = await validateDependencies(id, depInput.edges, task.project_id);
    if (depCheck.error) return res.status(400).json({ error: depCheck.error });
    deps = depCheck.deps;
    depsChanged = true;
  } else {
    deps = (await loadPredecessors(id)).map((d) => ({ ...d, forDay: d.for_day ?? null }));
  }
  if (startedStatuses.includes(status)) {
    const days = effectiveDays(selectedDates, startDate, endDate);
    const blocking = firstBlocking(deps, status, days);
    if (blocking) {
      const where = blocking.forDay ? ` (link on that item's ${blocking.forDay} stretch)` : '';
      return res.status(400).json({
        error: `Blocked by "${blocking.name}" — that item has to be completed first${where}`,
      });
    }
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
  if (depsChanged) {
    await replaceDeps(id, deps.map((d) => ({ id: d.id, forDay: d.forDay ?? null })));
  }
  // Dropping days from the schedule retires any links scoped to them.
  if (req.body?.selectedDates !== undefined) {
    const days = effectiveDays(selectedDates, startDate, endDate);
    if (days.length === 0) {
      await run('DELETE FROM task_deps WHERE task_id = ? AND for_day IS NOT NULL', [id]);
    } else {
      const ph = days.map(() => '?').join(', ');
      await run(
        `DELETE FROM task_deps WHERE task_id = ? AND for_day IS NOT NULL AND for_day NOT IN (${ph})`,
        [id, ...days]
      );
    }
  }

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
