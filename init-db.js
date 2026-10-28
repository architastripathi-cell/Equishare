const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./labshare.db');

console.log('Initializing EquiShare CSE Database...');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT CHECK(role IN ('student', 'manager', 'admin')) DEFAULT 'student',
    weekly_hours_used REAL DEFAULT 0.0,
    quota_max_hours REAL DEFAULT 12.0,
    credits_balance INTEGER DEFAULT 100
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_certifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    badge_code TEXT NOT NULL,
    verified INTEGER DEFAULT 1,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    location TEXT NOT NULL,
    custodian TEXT NOT NULL,
    prerequisite_badge TEXT NOT NULL,
    hourly_credits INTEGER DEFAULT 5,
    status TEXT DEFAULT 'available'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    resource_id TEXT,
    applicant_id TEXT,
    applicant_name TEXT,
    slot TEXT NOT NULL,
    duration_hours INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    purpose TEXT NOT NULL,
    prerequisite_cleared INTEGER DEFAULT 0,
    priority_score REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    details TEXT NOT NULL,
    log_hash TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  console.log('Seeding initial CSE Department records...');
  const insertUser = db.prepare(`INSERT OR IGNORE INTO users VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insertUser.run('CSE-2024-884', 'Archita Tripathi', 'archita@cse.edu', 'student', 4.5, 12.0, 60);
  insertUser.run('PROF-DB-01', 'Prof. Devendra Bharadwaj', 'dbharadwaj@cse.edu', 'manager', 0, 999.0, 500);
  insertUser.finalize();

  const insertBadge = db.prepare(`INSERT OR IGNORE INTO user_certifications (user_id, badge_code) VALUES (?, ?)`);
  insertBadge.run('CSE-2024-884', 'CUDA-TensorRT-DLI');
  insertBadge.run('CSE-2024-884', 'HPC-Slurm-Safety-v2');
  insertBadge.finalize();

  const insertRes = db.prepare(`INSERT OR IGNORE INTO resources VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  insertRes.run('RES-01', 'NVIDIA DGX H100 GPU Cluster Node', 'ai-hpc', 'CSE HPC Center - Rack 04', 'Prof. Devendra Bharadwaj', 'HPC-Slurm-Safety-v2', 10, 'in-use');
  insertRes.run('RES-02', 'Qualcomm Snapdragon Edge AI & Robotics Bench', 'embedded', 'Lab 204: Cyber-Physical Systems Lab', 'Prof. Devendra Bharadwaj', 'Embedded-Safety-Cert-1', 4, 'available');
  insertRes.run('RES-03', 'Keysight 100GHz Real-Time Oscilloscope', 'hardware', 'Lab 108: Hardware Architecture Lab', 'Prof. Devendra Bharadwaj', 'Hardware-Lab-Clearance', 6, 'available');
  insertRes.run('RES-04', 'QuEra / Qiskit Quantum Workstation', 'quantum', 'Lab 315: Quantum Computing Pod', 'Prof. Devendra Bharadwaj', 'Quantum-Info-Prereq-301', 8, 'available');
  insertRes.finalize();

  console.log('SQLite Database successfully initialized as labshare.db!');
});

db.close();
