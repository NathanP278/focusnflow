import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'focus.db');
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

// Init DB
const db = new DatabaseSync(DB_PATH);
// ponytail: sqlite single-node pragmas; switch to distributed db when scaling beyond single host
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA cache_size = -2000;
  PRAGMA temp_store = MEMORY;
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    work_min INTEGER,
    short_break_min INTEGER,
    long_break_min INTEGER,
    sound_enabled INTEGER,
    haptic_enabled INTEGER
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    task_id TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
  );
  INSERT OR IGNORE INTO settings (id, work_min, short_break_min, long_break_min, sound_enabled, haptic_enabled)
  VALUES (1, 25, 5, 15, 1, 1);

  CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed);
  CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_mode_duration ON sessions(mode, duration_minutes);
  CREATE INDEX IF NOT EXISTS idx_sessions_task_id ON sessions(task_id);
`);

// Migration: ensure sessions table has foreign key constraint
try {
  const fkList = db.prepare("PRAGMA foreign_key_list('sessions')").all();
  if (fkList.length === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions_migrated (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        task_id TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
      );
      INSERT OR IGNORE INTO sessions_migrated (id, mode, duration_minutes, task_id, created_at)
      SELECT s.id, s.mode, s.duration_minutes,
             CASE WHEN t.id IS NOT NULL THEN s.task_id ELSE NULL END,
             s.created_at
      FROM sessions s
      LEFT JOIN tasks t ON s.task_id = t.id;
      DROP TABLE sessions;
      ALTER TABLE sessions_migrated RENAME TO sessions;
      CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_mode_duration ON sessions(mode, duration_minutes);
      CREATE INDEX IF NOT EXISTS idx_sessions_task_id ON sessions(task_id);
    `);
  }
} catch {}

try {
  db.exec('ALTER TABLE tasks ADD COLUMN pomodoro_count INTEGER DEFAULT 0');
} catch {}
try { db.exec("ALTER TABLE settings ADD COLUMN theme_color TEXT DEFAULT 'peach'"); } catch {}
try { db.exec("ALTER TABLE settings ADD COLUMN sound_preset TEXT DEFAULT 'chord'"); } catch {}
try { db.exec("ALTER TABLE settings ADD COLUMN ticking_sound TEXT DEFAULT 'off'"); } catch {}
try { db.exec("ALTER TABLE settings ADD COLUMN auto_start_breaks INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE settings ADD COLUMN auto_start_focus INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE settings ADD COLUMN long_break_interval INTEGER DEFAULT 4"); } catch {}
try { db.exec("ALTER TABLE settings ADD COLUMN daily_goal_minutes INTEGER DEFAULT 120"); } catch {}
try { db.exec("ALTER TABLE settings ADD COLUMN particle_intensity TEXT DEFAULT 'balanced'"); } catch {}
try { db.exec("ALTER TABLE settings ADD COLUMN theme TEXT DEFAULT 'auto'"); } catch {}
try { db.exec("ALTER TABLE settings ADD COLUMN ambient_sound TEXT DEFAULT 'none'"); } catch {}
try { db.exec("ALTER TABLE settings ADD COLUMN ambient_volume REAL DEFAULT 0.3"); } catch {}

// Prepared statements
const stmtListTasks = db.prepare('SELECT id, text, completed, created_at, COALESCE(pomodoro_count, 0) as pomodoro_count FROM tasks ORDER BY created_at DESC');
const stmtGetTask = db.prepare('SELECT id, text, completed, created_at, COALESCE(pomodoro_count, 0) as pomodoro_count FROM tasks WHERE id = ?');
const stmtInsertTask = db.prepare('INSERT INTO tasks (id, text, completed, created_at, pomodoro_count) VALUES (?, ?, ?, ?, ?)');
const stmtUpdateTask = db.prepare('UPDATE tasks SET text = ?, completed = ?, pomodoro_count = ? WHERE id = ?');
const stmtDeleteTask = db.prepare('DELETE FROM tasks WHERE id = ?');
const stmtDeleteCompletedTasks = db.prepare('DELETE FROM tasks WHERE completed = 1');
const stmtIncTaskPomodoro = db.prepare('UPDATE tasks SET pomodoro_count = COALESCE(pomodoro_count, 0) + 1 WHERE id = ?');

const stmtGetSettings = db.prepare(`
  SELECT work_min, short_break_min, long_break_min, sound_enabled, haptic_enabled,
         COALESCE(theme_color, 'peach') as theme_color,
         COALESCE(sound_preset, 'chord') as sound_preset,
         COALESCE(ticking_sound, 'off') as ticking_sound,
         COALESCE(auto_start_breaks, 0) as auto_start_breaks,
         COALESCE(auto_start_focus, 0) as auto_start_focus,
         COALESCE(long_break_interval, 4) as long_break_interval,
         COALESCE(daily_goal_minutes, 120) as daily_goal_minutes,
         COALESCE(particle_intensity, 'balanced') as particle_intensity,
         COALESCE(theme, 'auto') as theme,
         COALESCE(ambient_sound, 'none') as ambient_sound,
         COALESCE(ambient_volume, 0.3) as ambient_volume
  FROM settings WHERE id = 1
`);
const stmtUpdateSettings = db.prepare(`
  UPDATE settings
  SET work_min = ?, short_break_min = ?, long_break_min = ?, sound_enabled = ?, haptic_enabled = ?,
      theme_color = ?, sound_preset = ?, ticking_sound = ?, auto_start_breaks = ?, auto_start_focus = ?,
      long_break_interval = ?, daily_goal_minutes = ?, particle_intensity = ?, theme = ?,
      ambient_sound = ?, ambient_volume = ?
  WHERE id = 1
`);

const stmtInsertSession = db.prepare('INSERT INTO sessions (id, mode, duration_minutes, task_id, created_at) VALUES (?, ?, ?, ?, ?)');
const stmtTotalFocus = db.prepare("SELECT COALESCE(SUM(duration_minutes), 0) as total FROM sessions WHERE mode = 'focus' OR mode = 'work'");
const stmtCompletedToday = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE created_at >= ?');
const stmtTodaySessions = db.prepare(`
  SELECT s.id, s.mode, s.duration_minutes, s.task_id, s.created_at, t.text as task_title
  FROM sessions s
  LEFT JOIN tasks t ON s.task_id = t.id
  WHERE s.created_at >= ?
  ORDER BY s.created_at DESC
  LIMIT 50
`);

const ALLOWED_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const ALLOWED_MODES = new Set(['work', 'focus', 'shortBreak', 'longBreak']);

function getCorsHeaders(req) {
  const origin = req?.headers?.origin;
  const allowOrigin = (origin && (origin === ALLOWED_ORIGIN || origin.startsWith('http://localhost:'))) ? origin : ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function sendJson(res, statusCode, data, req = null, extraHeaders = {}) {
  const cors = getCorsHeaders(req);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...cors,
    ...extraHeaders,
  });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    req.setEncoding('utf8');
    let raw = '';
    let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      raw += chunk;
      if (raw.length > 1e6) {
        tooLarge = true;
        req.pause();
        req.destroy(new Error('Payload too large'));
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (tooLarge) return;
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function formatTask(row) {
  return {
    id: row.id,
    text: row.text,
    completed: Boolean(row.completed),
    created_at: row.created_at,
    pomodoro_count: row.pomodoro_count || 0,
  };
}

function formatSettings(row) {
  return {
    work_min: row.work_min,
    short_break_min: row.short_break_min,
    long_break_min: row.long_break_min,
    sound_enabled: Boolean(row.sound_enabled),
    haptic_enabled: Boolean(row.haptic_enabled),
    theme_color: row.theme_color || 'peach',
    sound_preset: row.sound_preset || 'chord',
    ticking_sound: row.ticking_sound || 'off',
    auto_start_breaks: Boolean(row.auto_start_breaks),
    auto_start_focus: Boolean(row.auto_start_focus),
    long_break_interval: row.long_break_interval ?? 4,
    daily_goal_minutes: row.daily_goal_minutes ?? 120,
    particle_intensity: row.particle_intensity || 'balanced',
    theme: row.theme || 'auto',
    ambient_sound: row.ambient_sound || 'none',
    ambient_volume: typeof row.ambient_volume === 'number' ? row.ambient_volume : 0.3,
  };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' http://localhost:* ws://localhost:*;");
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    res.setHeader('Cache-Control', 'no-store');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, getCorsHeaders(req));
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    // Health
    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, { status: 'ok', timestamp: Date.now() }, req);
    }

    // Tasks - list
    if (req.method === 'GET' && pathname === '/api/tasks') {
      const rows = stmtListTasks.all();
      return sendJson(res, 200, rows.map(formatTask), req);
    }

    // Tasks - create
    if (req.method === 'POST' && pathname === '/api/tasks') {
      const body = await parseJsonBody(req);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (text.length < 1 || text.length > 120) {
        return sendJson(res, 400, { error: 'Text must be between 1 and 120 characters' }, req);
      }
      if (body.id !== undefined && (typeof body.id !== 'string' || !ID_REGEX.test(body.id.trim()))) {
        return sendJson(res, 400, { error: 'Invalid id format' }, req);
      }
      const id = (typeof body.id === 'string' && body.id.trim().length > 0) ? body.id.trim() : crypto.randomUUID();
      const createdAt = (typeof body.created_at === 'number' && Number.isSafeInteger(body.created_at)) ? body.created_at : Date.now();
      const pomodoroCount = (typeof body.pomodoro_count === 'number' && Number.isSafeInteger(body.pomodoro_count) && body.pomodoro_count >= 0)
        ? body.pomodoro_count
        : 0;
      stmtInsertTask.run(id, text, 0, createdAt, pomodoroCount);
      return sendJson(res, 201, { id, text, completed: false, created_at: createdAt, pomodoro_count: pomodoroCount }, req);
    }

    // Tasks - batch delete completed
    if (req.method === 'DELETE' && pathname === '/api/tasks/completed') {
      stmtDeleteCompletedTasks.run();
      return sendJson(res, 200, { success: true }, req);
    }

    // Tasks - update / delete
    const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskMatch) {
      const id = taskMatch[1];
      if (!ID_REGEX.test(id)) {
        return sendJson(res, 400, { error: 'Invalid id format' }, req);
      }

      if (req.method === 'PATCH') {
        const body = await parseJsonBody(req);
        const existing = stmtGetTask.get(id);
        if (!existing) {
          return sendJson(res, 404, { error: 'Task not found' }, req);
        }
        let updatedText = existing.text;
        let updatedCompleted = existing.completed;
        let updatedPomodoros = existing.pomodoro_count || 0;

        if (body.text !== undefined) {
          if (typeof body.text !== 'string' || body.text.trim().length < 1 || body.text.trim().length > 120) {
            return sendJson(res, 400, { error: 'Text must be between 1 and 120 characters' }, req);
          }
          updatedText = body.text.trim();
        }
        if (body.completed !== undefined) {
          if (typeof body.completed !== 'boolean') {
            return sendJson(res, 400, { error: 'Completed must be a boolean' }, req);
          }
          updatedCompleted = body.completed ? 1 : 0;
        }
        if (body.pomodoro_count !== undefined) {
          if (typeof body.pomodoro_count !== 'number' || !Number.isSafeInteger(body.pomodoro_count) || body.pomodoro_count < 0) {
            return sendJson(res, 400, { error: 'pomodoro_count must be a non-negative integer' }, req);
          }
          updatedPomodoros = body.pomodoro_count;
        }

        stmtUpdateTask.run(updatedText, updatedCompleted, updatedPomodoros, id);
        return sendJson(res, 200, {
          id,
          text: updatedText,
          completed: Boolean(updatedCompleted),
          created_at: existing.created_at,
          pomodoro_count: updatedPomodoros,
        }, req);
      }

      if (req.method === 'DELETE') {
        const existing = stmtGetTask.get(id);
        if (!existing) {
          return sendJson(res, 404, { error: 'Task not found' }, req);
        }
        stmtDeleteTask.run(id);
        return sendJson(res, 200, { success: true }, req);
      }
    }

    // Settings - get
    if (req.method === 'GET' && pathname === '/api/settings') {
      const row = stmtGetSettings.get();
      return sendJson(res, 200, formatSettings(row), req, {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      });
    }

    // Settings - put
    if (req.method === 'PUT' && pathname === '/api/settings') {
      const body = await parseJsonBody(req);
      const current = stmtGetSettings.get();

      const workMin = body.work_min !== undefined ? Number(body.work_min) : current.work_min;
      const shortBreakMin = body.short_break_min !== undefined ? Number(body.short_break_min) : current.short_break_min;
      const longBreakMin = body.long_break_min !== undefined ? Number(body.long_break_min) : current.long_break_min;
      const soundEnabled = body.sound_enabled !== undefined ? (body.sound_enabled ? 1 : 0) : current.sound_enabled;
      const hapticEnabled = body.haptic_enabled !== undefined ? (body.haptic_enabled ? 1 : 0) : current.haptic_enabled;

      const themeColor = ['peach', 'mint', 'lilac', 'ocean', 'mono'].includes(body.theme_color)
        ? body.theme_color
        : (current.theme_color || 'peach');
      const soundPreset = ['chord', 'bowl', 'marimba', 'synth'].includes(body.sound_preset)
        ? body.sound_preset
        : (current.sound_preset || 'chord');
      const tickingSound = ['off', 'subtle', 'clock'].includes(body.ticking_sound)
        ? body.ticking_sound
        : (current.ticking_sound || 'off');
      const autoStartBreaks = body.auto_start_breaks !== undefined
        ? (body.auto_start_breaks ? 1 : 0)
        : (current.auto_start_breaks || 0);
      const autoStartFocus = body.auto_start_focus !== undefined
        ? (body.auto_start_focus ? 1 : 0)
        : (current.auto_start_focus || 0);
      const longBreakInterval = Number.isInteger(body.long_break_interval) && body.long_break_interval >= 2 && body.long_break_interval <= 10
        ? body.long_break_interval
        : (current.long_break_interval || 4);
      const dailyGoalMinutes = Number.isInteger(body.daily_goal_minutes) && body.daily_goal_minutes >= 10 && body.daily_goal_minutes <= 1440
        ? body.daily_goal_minutes
        : (current.daily_goal_minutes || 120);
      const particleIntensity = ['off', 'low', 'balanced', 'high'].includes(body.particle_intensity)
        ? body.particle_intensity
        : (current.particle_intensity || 'balanced');
      const theme = ['light', 'dark', 'auto'].includes(body.theme)
        ? body.theme
        : (current.theme || 'auto');
      const ambientSound = ['none', 'rain', 'binaural', 'waves'].includes(body.ambient_sound)
        ? body.ambient_sound
        : (current.ambient_sound || 'none');
      const ambientVolume = typeof body.ambient_volume === 'number' && !Number.isNaN(body.ambient_volume) && body.ambient_volume >= 0 && body.ambient_volume <= 1
        ? body.ambient_volume
        : (typeof current.ambient_volume === 'number' ? current.ambient_volume : 0.3);

      if (!Number.isInteger(workMin) || workMin < 1 || workMin > 180) {
        return sendJson(res, 400, { error: 'work_min must be an integer between 1 and 180' });
      }
      if (!Number.isInteger(shortBreakMin) || shortBreakMin < 1 || shortBreakMin > 60) {
        return sendJson(res, 400, { error: 'short_break_min must be an integer between 1 and 60' });
      }
      if (!Number.isInteger(longBreakMin) || longBreakMin < 1 || longBreakMin > 60) {
        return sendJson(res, 400, { error: 'long_break_min must be an integer between 1 and 60' });
      }

      stmtUpdateSettings.run(
        workMin,
        shortBreakMin,
        longBreakMin,
        soundEnabled,
        hapticEnabled,
        themeColor,
        soundPreset,
        tickingSound,
        autoStartBreaks,
        autoStartFocus,
        longBreakInterval,
        dailyGoalMinutes,
        particleIntensity,
        theme,
        ambientSound,
        ambientVolume
      );

      return sendJson(res, 200, {
        work_min: workMin,
        short_break_min: shortBreakMin,
        long_break_min: longBreakMin,
        sound_enabled: Boolean(soundEnabled),
        haptic_enabled: Boolean(hapticEnabled),
        theme_color: themeColor,
        sound_preset: soundPreset,
        ticking_sound: tickingSound,
        auto_start_breaks: Boolean(autoStartBreaks),
        auto_start_focus: Boolean(autoStartFocus),
        long_break_interval: longBreakInterval,
        daily_goal_minutes: dailyGoalMinutes,
        particle_intensity: particleIntensity,
        theme: theme,
        ambient_sound: ambientSound,
        ambient_volume: ambientVolume,
      });
    }

    // Sessions - stats
    if (req.method === 'GET' && pathname === '/api/sessions/stats') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      const totalRow = stmtTotalFocus.get();
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const todayRow = stmtCompletedToday.get(startOfDay.getTime());

      return sendJson(res, 200, {
        totalFocusMinutes: totalRow.total || 0,
        completedSessionsToday: todayRow.count || 0,
      }, req);
    }

    // Sessions - today detailed list
    if (req.method === 'GET' && pathname === '/api/sessions/today') {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const rows = stmtTodaySessions.all(startOfDay.getTime());
      return sendJson(res, 200, rows, req);
    }

    // Sessions - create
    if (req.method === 'POST' && pathname === '/api/sessions') {
      const body = await parseJsonBody(req);
      const { mode, durationMinutes, taskId } = body;

      if (!mode || typeof mode !== 'string' || !ALLOWED_MODES.has(mode)) {
        return sendJson(res, 400, { error: 'Mode must be one of: work, focus, shortBreak, longBreak' }, req);
      }
      const duration = Number(durationMinutes);
      if (!Number.isSafeInteger(duration) || duration <= 0 || duration > 1440) {
        return sendJson(res, 400, { error: 'durationMinutes must be an integer between 1 and 1440' }, req);
      }
      if (taskId && (typeof taskId !== 'string' || !ID_REGEX.test(taskId))) {
        return sendJson(res, 400, { error: 'Invalid taskId format' }, req);
      }

      const id = crypto.randomUUID();
      const createdAt = Date.now();

      db.exec('BEGIN IMMEDIATE');
      try {
        stmtInsertSession.run(id, mode, duration, taskId || null, createdAt);

        if ((mode === 'work' || mode === 'focus') && taskId) {
          try {
            stmtIncTaskPomodoro.run(taskId);
          } catch {
            // ignore if task not found
          }
        }
        db.exec('COMMIT');
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch {}
        throw err;
      }

      return sendJson(res, 201, {
        id,
        mode,
        durationMinutes: duration,
        taskId: taskId || null,
        created_at: createdAt,
      }, req);
    }

    // 404
    return sendJson(res, 404, { error: 'Not Found' });
  } catch (err) {
    if (err.message === 'Invalid JSON') {
      return sendJson(res, 400, { error: 'Malformed JSON payload' });
    }
    if (err.message === 'Payload too large') {
      return sendJson(res, 413, { error: 'Payload too large' });
    }
    // ponytail: upgrade to structured logger when adding monitoring agent
    return sendJson(res, 500, { error: 'Internal Server Error' });
  }
});

let isShuttingDown = false;
function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  server.close(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    // ponytail: simple stdout; replace with pino/winston if observability stack added
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

export { server, db };
