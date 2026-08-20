import { Router } from 'express';
import { db, DEFAULT_PHASES, logActivity } from '../db.js';
import { requireAuth, requirePM } from '../auth.js';
import { isIsoDate, todayIso } from '../dates.js';

const router = Router();
router.use(requireAuth);

function serialiseProject(p) {
  const phases = db
    .prepare(
      `SELECT ph.*, u.name AS pic_name, u.username AS pic_username
       FROM phases ph LEFT JOIN users u ON u.id = ph.pic_user_id
       WHERE ph.project_id = ? ORDER BY ph.position, ph.id`
    )
    .all(p.id)
    .map((ph) => ({
      id: ph.id,
      projectId: ph.project_id,
      name: ph.name,
      position: ph.position,
      picUserId: ph.pic_user_id,
      picName: ph.pic_name,
      picUsername: ph.pic_username,
      tasks: db
        .prepare(
          `SELECT t.*, u.name AS assignee_name
           FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
           WHERE t.phase_id = ? ORDER BY t.position, t.id`
        )
        .all(ph.id)
        .map((t) => ({
          id: t.id,
          phaseId: t.phase_id,
          name: t.name,
          status: t.status,
          startDate: t.start_date,
          endDate: t.end_date,
          selectedDates: JSON.parse(t.selected_dates || '[]'),
          assigneeId: t.assignee_id,
          assigneeName: t.assignee_name,
          notes: t.notes,
          position: t.position,
          updatedAt: t.updated_at,
        })),
    }));

  return {
    id: p.id,
    name: p.name,
    company: p.company,
    location: p.location,
    client: p.client,
    description: p.description,
    startDate: p.start_date,
    status: p.status,
    position: p.position,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    phases,
  };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM projects ORDER BY position, id').all();
  const projects = rows.map((p) => {
    const counts = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN t.status = 'Complete' THEN 1 ELSE 0 END) AS done,
                MIN(t.start_date) AS first_day, MAX(t.end_date) AS last_day
         FROM tasks t JOIN phases ph ON ph.id = t.phase_id
         WHERE ph.project_id = ?`
      )
      .get(p.id);
    const isPic = db
      .prepare('SELECT COUNT(*) AS c FROM phases WHERE project_id = ? AND pic_user_id = ?')
      .get(p.id, req.user.id).c > 0;
    return {
      id: p.id,
      name: p.name,
      company: p.company,
      location: p.location,
      client: p.client,
      startDate: p.start_date,
      status: p.status,
      position: p.position,
      taskCount: counts.total || 0,
      doneCount: counts.done || 0,
      firstDay: counts.first_day,
      lastDay: counts.last_day,
      isPic,
    };
  });
  res.json({ projects });
});

router.get('/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Project not found' });
  res.json({ project: serialiseProject(p) });
});

router.get('/:id/activity', (req, res) => {
  const rows = db
    .prepare(
      `SELECT a.*, u.name AS user_name FROM activity a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.project_id = ? ORDER BY a.id DESC LIMIT 60`
    )
    .all(Number(req.params.id));
  res.json({
    activity: rows.map((a) => ({
      id: a.id,
      userName: a.user_name || 'Someone',
      action: a.action,
      detail: a.detail,
      createdAt: a.created_at,
    })),
  });
});

router.post('/', requirePM, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const company = String(req.body?.company || '').trim();
  const location = String(req.body?.location || '').trim();
  const client = String(req.body?.client || '').trim();
  const description = String(req.body?.description || '').trim();
  const startDate = String(req.body?.startDate || '').trim() || todayIso();

  if (!name) return res.status(400).json({ error: 'Project name is required' });
  if (!isIsoDate(startDate)) return res.status(400).json({ error: 'Start date is invalid' });

  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM projects').get().m;

  const created = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO projects (name, company, location, client, description, start_date, position, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(name, company, location, client, description, startDate, maxPos + 1, req.user.id);
    const projectId = Number(info.lastInsertRowid);

    // Every project opens with the six standard SSG stages.
    const picks = Array.isArray(req.body?.phasePics) ? req.body.phasePics : [];
    const insertPhase = db.prepare(
      'INSERT INTO phases (project_id, name, position, pic_user_id) VALUES (?, ?, ?, ?)'
    );
    DEFAULT_PHASES.forEach((phaseName, i) => {
      const picId = Number(picks[i]) || null;
      const pic = picId ? db.prepare('SELECT id FROM users WHERE id = ? AND active = 1').get(picId) : null;
      insertPhase.run(projectId, phaseName, i, pic ? pic.id : null);
    });
    return projectId;
  })();

  logActivity(created, req.user.id, 'created the project', name);
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(created);
  res.status(201).json({ project: serialiseProject(p) });
});

router.patch('/:id', requirePM, (req, res) => {
  const id = Number(req.params.id);
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ error: 'Project not found' });

  const next = {
    name: req.body?.name === undefined ? p.name : String(req.body.name).trim(),
    company: req.body?.company === undefined ? p.company : String(req.body.company).trim(),
    location: req.body?.location === undefined ? p.location : String(req.body.location).trim(),
    client: req.body?.client === undefined ? p.client : String(req.body.client).trim(),
    description:
      req.body?.description === undefined ? p.description : String(req.body.description).trim(),
    start_date: req.body?.startDate === undefined ? p.start_date : String(req.body.startDate).trim(),
    status: req.body?.status === undefined ? p.status : String(req.body.status),
  };

  if (!next.name) return res.status(400).json({ error: 'Project name is required' });
  if (!isIsoDate(next.start_date)) return res.status(400).json({ error: 'Start date is invalid' });
  if (!['Active', 'On Hold', 'Complete', 'Cancelled'].includes(next.status)) {
    return res.status(400).json({ error: 'Unknown project status' });
  }

  db.prepare(
    `UPDATE projects SET name = ?, company = ?, location = ?, client = ?, description = ?,
     start_date = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(
    next.name, next.company, next.location, next.client, next.description,
    next.start_date, next.status, id
  );

  logActivity(id, req.user.id, 'updated project details', next.name);
  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  res.json({ project: serialiseProject(updated) });
});

router.delete('/:id', requirePM, (req, res) => {
  const id = Number(req.params.id);
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  res.json({ ok: true });
});

export { serialiseProject };
export default router;
