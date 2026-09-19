import type { Task, AppSettings } from './types';

export interface SessionStats {
  totalFocusMinutes: number;
  completedSessionsToday: number;
}

export interface TodaySessionRecord {
  id: string;
  mode: string;
  duration_minutes: number;
  task_id: string | null;
  created_at: number;
  task_title: string | null;
}

const API_BASE = '/api';

export const ApiClient = {
  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  },

  async getTasks(): Promise<Task[] | null> {
    try {
      const res = await fetch(`${API_BASE}/tasks`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.map((d: { id: string; text: string; completed: boolean; created_at: number; pomodoro_count?: number }) => ({
        id: d.id,
        text: d.text,
        completed: d.completed,
        createdAt: d.created_at,
        pomodoroCount: d.pomodoro_count ?? 0,
      }));
    } catch {
      return null;
    }
  },

  async createTask(text: string, id?: string, pomodoroCount = 0): Promise<Task | null> {
    try {
      const res = await fetch(`${API_BASE}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, id, pomodoro_count: pomodoroCount }),
      });
      if (!res.ok) return null;
      const d = await res.json();
      return { id: d.id, text: d.text, completed: d.completed, createdAt: d.created_at, pomodoroCount: d.pomodoro_count ?? 0 };
    } catch {
      return null;
    }
  },

  async updateTask(id: string, updates: { completed?: boolean; text?: string; pomodoro_count?: number }): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/tasks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async deleteTask(id: string): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/tasks/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async clearCompletedTasks(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/tasks/completed`, {
        method: 'DELETE',
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async getSettings(): Promise<AppSettings | null> {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      if (!res.ok) return null;
      const s = await res.json();
      return {
        workMin: s.work_min,
        shortBreakMin: s.short_break_min,
        longBreakMin: s.long_break_min,
        soundEnabled: s.sound_enabled,
        hapticEnabled: s.haptic_enabled,
        themeColor: s.theme_color || 'peach',
        soundPreset: s.sound_preset || 'chord',
        tickingSound: s.ticking_sound || 'off',
        autoStartBreaks: s.auto_start_breaks ?? false,
        autoStartFocus: s.auto_start_focus ?? false,
        longBreakInterval: s.long_break_interval ?? 4,
        dailyGoalMinutes: s.daily_goal_minutes ?? 120,
        particleIntensity: s.particle_intensity || 'balanced',
        theme: s.theme || 'auto',
        ambientSound: s.ambient_sound || 'none',
        ambientVolume: typeof s.ambient_volume === 'number' ? s.ambient_volume : 0.3,
      };
    } catch {
      return null;
    }
  },

  async updateSettings(settings: AppSettings): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_min: settings.workMin,
          short_break_min: settings.shortBreakMin,
          long_break_min: settings.longBreakMin,
          sound_enabled: settings.soundEnabled,
          haptic_enabled: settings.hapticEnabled,
          theme_color: settings.themeColor,
          sound_preset: settings.soundPreset,
          ticking_sound: settings.tickingSound,
          auto_start_breaks: settings.autoStartBreaks,
          auto_start_focus: settings.autoStartFocus,
          long_break_interval: settings.longBreakInterval,
          daily_goal_minutes: settings.dailyGoalMinutes,
          particle_intensity: settings.particleIntensity,
          theme: settings.theme,
          ambient_sound: settings.ambientSound,
          ambient_volume: settings.ambientVolume,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async recordSession(mode: string, durationMinutes: number, taskId?: string | null): Promise<void> {
    try {
      await fetch(`${API_BASE}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, durationMinutes, taskId }),
      });
    } catch {
      // offline silent fallback
    }
  },

  async getSessionStats(): Promise<SessionStats | null> {
    try {
      const res = await fetch(`${API_BASE}/sessions/stats`);
      if (!res.ok) return null;
      return (await res.json()) as SessionStats;
    } catch {
      return null;
    }
  },

  async getTodaySessions(): Promise<TodaySessionRecord[] | null> {
    try {
      const res = await fetch(`${API_BASE}/sessions/today`);
      if (!res.ok) return null;
      return (await res.json()) as TodaySessionRecord[];
    } catch {
      return null;
    }
  },
};
