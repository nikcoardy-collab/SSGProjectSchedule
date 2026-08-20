/**
 * Populates a running instance with the sample project from the original
 * spreadsheet, so the schedule can be looked at with realistic data.
 *
 *   node scripts/seed-demo.js [baseUrl] [adminUser] [adminPassword]
 */
const BASE = process.argv[2] || process.env.BASE_URL || 'http://localhost:4000';
const ADMIN = process.argv[3] || process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PW = process.argv[4] || process.env.ADMIN_PASSWORD || 'ssg-admin';

let cookie = '';

async function call(path, method = 'GET', body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data.error || text}`);
  return data;
}

const PEOPLE = [
  { username: 'ilham', name: 'Ilham', role: 'user' },
  { username: 'kevin', name: 'Kevin', role: 'user' },
  { username: 'gunarso', name: 'Gunarso', role: 'user' },
];

// Stage → items, with the days each item occupies (from the source schedule).
const PLAN = {
  Tender: [
    ['Client Meeting', 'Complete', ['2026-08-17']],
    ['Preliminary Survey', 'Complete', ['2026-08-18', '2026-08-19']],
    ['Quotation', 'Complete', ['2026-08-20']],
    ['Invoice', 'Complete', ['2026-08-21']],
    ['Client Payment', 'In Progress', ['2026-08-21']],
    ['Project Meeting', 'Not Started', ['2026-08-24']],
    ['Release PO Internal', 'Not Started', ['2026-08-24']],
  ],
  Procurement: [
    ['Order', 'In Progress', range('2026-08-24', '2026-09-04')],
    ['Payment', 'In Progress', range('2026-08-24', '2026-09-01')],
    ['Shipping — auto tee machine', 'Not Started', range('2026-09-02', '2026-09-05')],
    ["Shipping — Carl's Place", 'Not Started', range('2026-09-02', '2026-09-08')],
    ['Shipping — SWG', 'Not Started', range('2026-09-03', '2026-09-09')],
    ['Shipping — Trackman', 'Not Started', range('2026-09-04', '2026-09-10')],
  ],
  Production: [
    ['Padding', 'Not Started', ['2026-08-24']],
    ['Besi', 'Not Started', ['2026-08-25', '2026-08-26']],
    ['Kulit', 'Not Started', ['2026-08-27', '2026-08-28']],
    ['Assembly & QC', 'Not Started', ['2026-08-31', '2026-09-01']],
  ],
  Installation: [
    ['Delivery to customer', 'Not Started', ['2026-09-01']],
    ['Instalasi Golf Sim Set', 'Not Started', range('2026-09-02', '2026-09-04')],
    ['Panggung', 'Not Started', range('2026-09-07', '2026-09-09')],
    ['Platform', 'Not Started', range('2026-09-10', '2026-09-11')],
  ],
  Handover: [
    ['Wiring & Power Connection', 'Not Started', ['2026-09-14', '2026-09-15']],
    ['Simulator PC & Peripherals Setup', 'Not Started', ['2026-09-15']],
    ['Software Installation & Network Setup', 'Not Started', ['2026-09-16']],
  ],
  'Calibration / Testing / Final Handover': [
    ['Trackman iO Calibration', 'Not Started', ['2026-09-17']],
    ['Platform Motor Testing', 'Not Started', ['2026-09-17']],
    ['Software Calibration & Course Loading', 'Not Started', ['2026-09-18']],
    ['Trial Session & Quality Check', 'Not Started', ['2026-09-18']],
    ['Client Training Session', 'Not Started', ['2026-09-21']],
    ['Final Walkthrough & Punch List', 'Not Started', ['2026-09-21']],
    ['Handover & Sign-off', 'Not Started', ['2026-09-22']],
  ],
};

function range(a, b) {
  const out = [];
  const d = new Date(`${a}T00:00:00Z`);
  const end = new Date(`${b}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

async function main() {
  await call('/api/auth/login', 'POST', { username: ADMIN, password: ADMIN_PW });
  console.log('signed in as', ADMIN);

  const { users: existing } = await call('/api/users');
  const byName = new Map(existing.map((u) => [u.username, u]));

  for (const p of PEOPLE) {
    if (byName.has(p.username)) continue;
    const { user } = await call('/api/users', 'POST', { ...p, email: '', password: 'ssg-2026' });
    byName.set(p.username, user);
    console.log('created user', p.username, '(password: ssg-2026)');
  }

  const pics = [
    byName.get('ilham').id,     // Tender
    byName.get('kevin').id,     // Procurement
    byName.get('gunarso').id,   // Production
    byName.get('gunarso').id,   // Installation
    byName.get('gunarso').id,   // Handover
    byName.get('gunarso').id,   // Calibration
  ];

  const { project } = await call('/api/projects', 'POST', {
    name: 'Playce - Alam Sutera',
    company: 'Berkat/Berkarya/Bersatu',
    location: 'Alam Sutera',
    client: '',
    description: 'Golf simulator installation — sample project imported from the schedule sheet.',
    startDate: '2026-08-17',
    phasePics: pics,
  });
  console.log('created project', project.name);

  for (const phase of project.phases) {
    for (const [name, status, dates] of PLAN[phase.name] ?? []) {
      await call('/api/tasks', 'POST', {
        phaseId: phase.id,
        name,
        status,
        selectedDates: dates,
      });
    }
  }

  const { project: full } = await call(`/api/projects/${project.id}`);
  const count = full.phases.reduce((n, p) => n + p.tasks.length, 0);
  console.log(`seeded ${full.phases.length} stages and ${count} items`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
