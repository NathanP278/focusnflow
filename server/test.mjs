import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// ponytail: in-process test runner; switch to external URL if running against deployed container
process.env.NODE_ENV = 'test';
const { server, db } = await import('./index.mjs');

let baseUrl;

before(async () => {
  if (!server.listening) {
    await new Promise((resolve) => server.listen(0, resolve));
  }
  const { port } = server.address();
  baseUrl = `http://localhost:${port}`;

  db.exec(`
    DELETE FROM tasks;
    DELETE FROM sessions;
    UPDATE settings
    SET work_min = 25, short_break_min = 5, long_break_min = 15, sound_enabled = 1, haptic_enabled = 1
    WHERE id = 1;
  `);
});

after(async () => {
  if (server.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
  try {
    db.close();
  } catch {
    // ignore
  }
});

describe('Health Check Endpoint', () => {
  it('GET /api/health returns 200 and status ok', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.equal(typeof data.timestamp, 'number');
  });
});

describe('Task CRUD Lifecycle', () => {
  let createdTaskId;

  it('POST /api/tasks creates a task', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Integration test task' }),
    });
    assert.equal(res.status, 201);

    const task = await res.json();
    assert.ok(task.id);
    assert.equal(task.text, 'Integration test task');
    assert.equal(task.completed, false);
    assert.equal(typeof task.created_at, 'number');
    createdTaskId = task.id;
  });

  it('POST /api/tasks rejects invalid text lengths', async () => {
    const emptyRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    });
    assert.equal(emptyRes.status, 400);

    const longRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'a'.repeat(121) }),
    });
    assert.equal(longRes.status, 400);
  });

  it('GET /api/tasks lists tasks including created task', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`);
    assert.equal(res.status, 200);

    const tasks = await res.json();
    assert.ok(Array.isArray(tasks));
    const found = tasks.find((t) => t.id === createdTaskId);
    assert.ok(found);
    assert.equal(found.text, 'Integration test task');
    assert.equal(found.completed, false);
  });

  it('PATCH /api/tasks/:id updates completed status', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: true }),
    });
    assert.equal(res.status, 200);

    const updated = await res.json();
    assert.equal(updated.id, createdTaskId);
    assert.equal(updated.completed, true);
  });

  it('PATCH /api/tasks/:id rejects invalid completed value', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: 'yes' }),
    });
    assert.equal(res.status, 400);
  });

  it('DELETE /api/tasks/:id deletes task', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}`, {
      method: 'DELETE',
    });
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.deepEqual(body, { success: true });

    // Verify task is gone
    const listRes = await fetch(`${baseUrl}/api/tasks`);
    const tasks = await listRes.json();
    assert.equal(tasks.some((t) => t.id === createdTaskId), false);

    const delAgainRes = await fetch(`${baseUrl}/api/tasks/${createdTaskId}`, {
      method: 'DELETE',
    });
    assert.equal(delAgainRes.status, 404);
  });

  it('DELETE /api/tasks/completed deletes all completed tasks', async () => {
    // Create one active and two completed tasks
    const t1 = await (await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Active task' }),
    })).json();

    const t2 = await (await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Done task 1' }),
    })).json();

    await fetch(`${baseUrl}/api/tasks/${t2.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: true }),
    });

    const delBatchRes = await fetch(`${baseUrl}/api/tasks/completed`, {
      method: 'DELETE',
    });
    assert.equal(delBatchRes.status, 200);

    const listRes = await fetch(`${baseUrl}/api/tasks`);
    const tasks = await listRes.json();
    assert.ok(tasks.some((t) => t.id === t1.id));
    assert.equal(tasks.some((t) => t.id === t2.id), false);

    // Clean up created t1 task to keep DB clean
    await fetch(`${baseUrl}/api/tasks/${t1.id}`, { method: 'DELETE' });
  });
});

describe('Settings Fetch and Update Validation', () => {
  it('GET /api/settings returns current configuration', async () => {
    const res = await fetch(`${baseUrl}/api/settings`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-cache, no-store, must-revalidate');

    const settings = await res.json();
    assert.equal(typeof settings.work_min, 'number');
    assert.equal(typeof settings.short_break_min, 'number');
    assert.equal(typeof settings.long_break_min, 'number');
    assert.equal(typeof settings.sound_enabled, 'boolean');
    assert.equal(typeof settings.haptic_enabled, 'boolean');
    assert.ok(['peach', 'mint', 'lilac', 'ocean', 'mono'].includes(settings.theme_color));
    assert.ok(['chord', 'bowl', 'marimba', 'synth'].includes(settings.sound_preset));
    assert.ok(['off', 'subtle', 'clock'].includes(settings.ticking_sound));
    assert.equal(typeof settings.daily_goal_minutes, 'number');
    assert.ok(['none', 'rain', 'binaural', 'waves'].includes(settings.ambient_sound));
    assert.equal(typeof settings.ambient_volume, 'number');
  });

  it('PUT /api/settings updates settings within valid bounds', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        work_min: 50,
        short_break_min: 10,
        long_break_min: 20,
        sound_enabled: false,
        haptic_enabled: false,
        theme_color: 'mint',
        sound_preset: 'bowl',
        ticking_sound: 'subtle',
        auto_start_breaks: true,
        auto_start_focus: true,
        long_break_interval: 3,
        daily_goal_minutes: 180,
        particle_intensity: 'high',
        theme: 'dark',
        ambient_sound: 'rain',
        ambient_volume: 0.75,
      }),
    });
    assert.equal(res.status, 200);

    const updated = await res.json();
    assert.equal(updated.work_min, 50);
    assert.equal(updated.short_break_min, 10);
    assert.equal(updated.long_break_min, 20);
    assert.equal(updated.sound_enabled, false);
    assert.equal(updated.haptic_enabled, false);
    assert.equal(updated.theme_color, 'mint');
    assert.equal(updated.sound_preset, 'bowl');
    assert.equal(updated.ticking_sound, 'subtle');
    assert.equal(updated.auto_start_breaks, true);
    assert.equal(updated.auto_start_focus, true);
    assert.equal(updated.long_break_interval, 3);
    assert.equal(updated.daily_goal_minutes, 180);
    assert.equal(updated.particle_intensity, 'high');
    assert.equal(updated.theme, 'dark');
    assert.equal(updated.ambient_sound, 'rain');
    assert.equal(updated.ambient_volume, 0.75);

    // Reset back to defaults for clean state
    await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        work_min: 25,
        short_break_min: 5,
        long_break_min: 15,
        sound_enabled: true,
        haptic_enabled: true,
        theme_color: 'peach',
        sound_preset: 'chord',
        ticking_sound: 'off',
        auto_start_breaks: false,
        auto_start_focus: false,
        long_break_interval: 4,
        daily_goal_minutes: 120,
        particle_intensity: 'balanced',
        theme: 'auto',
        ambient_sound: 'none',
        ambient_volume: 0.3,
      }),
    });
  });

  it('PUT /api/settings validates out of range work_min bounds', async () => {
    for (const invalid of [0, -1, 181, 25.5, 'invalid']) {
      const res = await fetch(`${baseUrl}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_min: invalid }),
      });
      assert.equal(res.status, 400);
    }
  });

  it('PUT /api/settings validates out of range break bounds', async () => {
    for (const invalid of [0, 61]) {
      const shortRes = await fetch(`${baseUrl}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ short_break_min: invalid }),
      });
      assert.equal(shortRes.status, 400);

      const longRes = await fetch(`${baseUrl}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ long_break_min: invalid }),
      });
      assert.equal(longRes.status, 400);
    }
  });
});

describe('Session Recording and Stats Aggregation', () => {
  it('records sessions and updates aggregated stats', async () => {
    const initialStatsRes = await fetch(`${baseUrl}/api/sessions/stats`);
    const initialStats = await initialStatsRes.json();

    const focusSession = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'work', durationMinutes: 25 }),
    });
    assert.equal(focusSession.status, 201);

    const breakSession = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'shortBreak', durationMinutes: 5 }),
    });
    assert.equal(breakSession.status, 201);

    const updatedStatsRes = await fetch(`${baseUrl}/api/sessions/stats`);
    const updatedStats = await updatedStatsRes.json();

    assert.equal(
      updatedStats.totalFocusMinutes,
      initialStats.totalFocusMinutes + 25
    );
    assert.equal(
      updatedStats.completedSessionsToday,
      initialStats.completedSessionsToday + 2
    );

    const todayListRes = await fetch(`${baseUrl}/api/sessions/today`);
    assert.equal(todayListRes.status, 200);
    const todaySessions = await todayListRes.json();
    assert.ok(Array.isArray(todaySessions));
    assert.ok(todaySessions.length >= 2);
  });

  it('POST /api/sessions rejects invalid session payload', async () => {
    const invalidModeRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: '', durationMinutes: 25 }),
    });
    assert.equal(invalidModeRes.status, 400);

    const invalidDurationRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'work', durationMinutes: 0 }),
    });
    assert.equal(invalidDurationRes.status, 400);
  });

  it('foreign key nullifies task_id on task deletion', async () => {
    const taskRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'FK test task' }),
    });
    const task = await taskRes.json();

    const sessRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'work', durationMinutes: 25, taskId: task.id }),
    });
    const sess = await sessRes.json();
    assert.equal(sess.taskId, task.id);

    // Delete the task
    const delRes = await fetch(`${baseUrl}/api/tasks/${task.id}`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);

    // Verify session still exists and task_id became null
    const todayRes = await fetch(`${baseUrl}/api/sessions/today`);
    const todaySessions = await todayRes.json();
    const foundSess = todaySessions.find((s) => s.id === sess.id);
    assert.ok(foundSess);
    assert.equal(foundSess.task_id, null);
  });
});

describe('Security Headers and Input Sanitization', () => {
  it('returns standard security headers on API responses', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.ok(res.headers.get('content-security-policy'));
    assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.ok(res.headers.get('permissions-policy'));
  });

  it('stats endpoint sets no-cache header', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/stats`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-cache, no-store, must-revalidate');
  });

  it('rejects invalid task ID characters', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Valid text', id: 'bad id with spaces!' }),
    });
    assert.equal(res.status, 400);

    const badRouteRes = await fetch(`${baseUrl}/api/tasks/bad%20id%20with%20spaces!`, {
      method: 'DELETE',
    });
    assert.equal(badRouteRes.status, 400);
  });

  it('rejects invalid session mode and excessive duration', async () => {
    const badModeRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'invalid_mode', durationMinutes: 25 }),
    });
    assert.equal(badModeRes.status, 400);

    const excessiveDurationRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'work', durationMinutes: 2000 }),
    });
    assert.equal(excessiveDurationRes.status, 400);
  });
});

describe('Malformed JSON Handling', () => {
  it('returns 400 on malformed JSON and process keeps running', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"text": "broken json...',
    });
    assert.equal(res.status, 400);

    const body = await res.json();
    assert.equal(body.error, 'Malformed JSON payload');

    // Verify process did not crash
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
  });
});

describe('404 for Unknown Endpoints', () => {
  it('returns 404 for unmatched routes', async () => {
    const getRes = await fetch(`${baseUrl}/api/nonexistent`);
    assert.equal(getRes.status, 404);
    const getBody = await getRes.json();
    assert.equal(getBody.error, 'Not Found');

    const postRes = await fetch(`${baseUrl}/api/unknown/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foo: 'bar' }),
    });
    assert.equal(postRes.status, 404);
  });
});
