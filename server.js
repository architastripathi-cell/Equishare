const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const db = new sqlite3.Database('./labshare.db', (err) => {
  if (err) console.error('Database connection error:', err.message);
  else console.log('Connected to labshare.db SQLite database.');
});

// Cryptographic Audit Logger Helper
function recordAudit(actor, action, resource, details, callback) {
  const timestamp = new Date().toISOString();
  const rawPayload = `${actor}|${action}|${resource}|${timestamp}|${details}`;
  const logHash = crypto.createHash('sha256').update(rawPayload).digest('hex');
  const auditId = `AUD-${Date.now().toString().slice(-4)}`;

  const stmt = db.prepare(
    `INSERT INTO audit_logs (id, actor, action, resource, details, log_hash) VALUES (?, ?, ?, ?, ?, ?)`
  );
  stmt.run(auditId, actor, action, resource, details, logHash, (err) => {
    if (err) console.error('Audit log failed:', err.message);
    if (callback) callback();
  });
  stmt.finalize();
}

// ---------------------- API ROUTES ---------------------- //

// 1. GET ALL RESOURCES (Catalog)
app.get('/api/resources', (req, res) => {
  db.all(`SELECT * FROM resources`, [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, data: rows });
  });
});

// 2. CREATE NEW RESOURCE (Lab Manager only)
app.post('/api/resources', (req, res) => {
  const { name, category, location, prerequisite, hourlyCredits } = req.body;
  const id = `RES-0${Math.floor(10 + Math.random() * 90)}`;
  const credits = parseInt(hourlyCredits) || 5;

  const stmt = db.prepare(
    `INSERT INTO resources (id, name, category, location, custodian, prerequisite_badge, hourly_credits, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.run(id, name, category, location, 'Prof. Devendra Bharadwaj', prerequisite, credits, 'available', function (err) {
    if (err) return res.status(500).json({ success: false, error: err.message });

    recordAudit('Prof. Devendra Bharadwaj', 'Resource Listed', name, `Prereq: ${prerequisite}, Loc: ${location}`);
    res.status(201).json({ success: true, data: { id, name, category, location, prerequisite, credits } });
  });
  stmt.finalize();
});

// 3. SUBMIT BOOKING (With Prerequisite & Fair-Use Priority Calculation)
app.post('/api/bookings', (req, res) => {
  const { resource_id, applicant_id, duration, purpose } = req.body;
  const numDuration = parseInt(duration) || 2;

  // Retrieve applicant & resource details
  db.get(`SELECT * FROM users WHERE id = ?`, [applicant_id], (err, applicant) => {
    if (err || !applicant) return res.status(404).json({ success: false, message: 'Applicant not found' });

    if (applicant.weekly_hours_used + numDuration > applicant.quota_max_hours) {
      return res.status(400).json({
        success: false,
        message: 'Weekly allocation quota exceeded (Max 12 hrs/week). Request manager override.'
      });
    }

    db.get(`SELECT * FROM resources WHERE id = ?`, [resource_id], (err, resource) => {
      if (err || !resource) return res.status(404).json({ success: false, message: 'Resource not found' });

      // Check certifications for this applicant
      db.all(`SELECT badge_code FROM user_certifications WHERE user_id = ?`, [applicant_id], (err, badges) => {
        const badgeList = (badges || []).map(b => b.badge_code);
        const hasPrereq = badgeList.includes(resource.prerequisite_badge) ? 1 : 0;

        // Fair-share priority formula: (TrainingWeight * 100) / (HoursUsedThisWeek + 1)
        const weight = hasPrereq ? 1.0 : 0.5;
        const priorityScore = parseFloat(((weight * 100) / (applicant.weekly_hours_used + 1)).toFixed(1));

        const bookingId = `REQ-${Math.floor(1000 + Math.random() * 9000)}`;
        const slotDesc = `Tomorrow (${numDuration} Hours Allocated)`;

        const stmt = db.prepare(
          `INSERT INTO bookings (id, resource_id, applicant_id, applicant_name, slot, duration_hours, status, purpose, prerequisite_cleared, priority_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );

        stmt.run(
          bookingId,
          resource_id,
          applicant_id,
          applicant.name,
          slotDesc,
          numDuration,
          'pending',
          purpose,
          hasPrereq,
          priorityScore,
          function (err) {
            if (err) return res.status(500).json({ success: false, error: err.message });

            recordAudit(
              applicant.name,
              'Booking Requested',
              resource.name,
              `Duration: ${numDuration} hrs. Priority: ${priorityScore}. Prereq cleared: ${hasPrereq === 1}`
            );

            res.status(201).json({
              success: true,
              data: {
                id: bookingId,
                resource_name: resource.name,
                applicant_name: applicant.name,
                slot: slotDesc,
                prerequisite_cleared: hasPrereq === 1,
                priority_score: priorityScore,
                status: 'pending'
              }
            });
          }
        );
        stmt.finalize();
      });
    });
  });
});

// 4. GET ALL BOOKINGS (Queue)
app.get('/api/bookings', (req, res) => {
  db.all(`SELECT * FROM bookings ORDER BY created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, data: rows });
  });
});

// 5. MANAGER APPROVE / REJECT
app.patch('/api/bookings/:id/review', (req, res) => {
  const { status, reason } = req.body; // status: 'approved' | 'rejected'
  const bookingId = req.params.id;

  db.get(`SELECT * FROM bookings WHERE id = ?`, [bookingId], (err, booking) => {
    if (err || !booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    db.run(`UPDATE bookings SET status = ? WHERE id = ?`, [status, bookingId], function (err) {
      if (err) return res.status(500).json({ success: false, error: err.message });

      recordAudit(
        'Prof. Devendra Bharadwaj (Lab Manager)',
        `Booking ${status.toUpperCase()}`,
        booking.resource_id,
        `Decision note: ${reason || 'Approved under CSE research quota.'}`
      );

      res.json({ success: true, message: `Booking marked as ${status}` });
    });
  });
});

// 6. CUSTODY RETURN OR INCIDENT REPORT
app.post('/api/custody/check-out', (req, res) => {
  const { booking_id, is_incident, severity, notes } = req.body;

  db.get(`SELECT * FROM bookings WHERE id = ?`, [booking_id], (err, booking) => {
    if (err || !booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    if (is_incident) {
      db.run(`UPDATE bookings SET status = 'incident-escalated' WHERE id = ?`, [booking_id]);
      db.run(`UPDATE resources SET status = 'maintenance' WHERE id = ?`, [booking.resource_id]);

      recordAudit(
        booking.applicant_name,
        `INCIDENT REPORTED: ${severity.toUpperCase()}`,
        booking.resource_id,
        `Hardware locked. Diagnostic note: ${notes}`
      );

      return res.json({ success: true, message: 'Incident escalated to Prof. Devendra Bharadwaj' });
    }

    db.run(`UPDATE bookings SET status = 'returned' WHERE id = ?`, [booking_id]);
    db.run(`UPDATE resources SET status = 'available' WHERE id = ?`, [booking.resource_id]);

    recordAudit(
      booking.applicant_name,
      'Resource Safely Returned',
      booking.resource_id,
      `Sign-off clean: ${notes}`
    );

    res.json({ success: true, message: 'Resource returned successfully. Balance restored.' });
  });
});

// 7. GET AUDIT TRAIL
app.get('/api/audit', (req, res) => {
  db.all(`SELECT * FROM audit_logs ORDER BY timestamp DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, count: rows.length, data: rows });
  });
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`EquiShare CSE Backend running on http://localhost:${PORT}`);
  console.log(`API endpoints ready: /api/resources, /api/bookings, /api/audit`);
  console.log(`======================================================\n`);
});