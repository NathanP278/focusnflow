import { Store } from './core/store';
import { PrecisionTimer } from './core/worker-timer';
import { SoundEngine } from './core/audio';
import { ParticleEngine } from './core/particles';
import { ApiClient } from './core/api';
import { PipEngine } from './core/pip';
import type { AppState, TimerMode, Task, AppSettings, AppTheme, AmbientSoundType, TaskFilter } from './core/types';

const STORAGE_KEY = 'focus_flow_v2';
const RING_RADIUS = 105;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const DEFAULT_SETTINGS: AppSettings = {
  workMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  soundEnabled: true,
  hapticEnabled: true,
  autoStartBreaks: false,
  autoStartFocus: false,
  longBreakInterval: 4,
  dailyGoalMinutes: 120,
  theme: 'auto',
  themeColor: 'peach',
  soundPreset: 'chord',
  tickingSound: 'off',
  particleIntensity: 'balanced',
  ambientSound: 'none',
  ambientVolume: 0.3,
};

function loadStoredState(): Partial<AppState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
        currentMode: parsed.currentMode || 'work',
        currentCycle: parsed.currentCycle || 1,
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        activeTaskId: parsed.activeTaskId ?? null,
        zenMode: Boolean(parsed.zenMode),
        ambientSound: parsed.ambientSound || 'none',
        ambientVolume: typeof parsed.ambientVolume === 'number' ? parsed.ambientVolume : 0.3,
        taskFilter: parsed.taskFilter || 'all',
      };
    }
  } catch (err) {
    console.warn('Failed loading storage state:', err);
  }
  return {};
}

function getModeDurationMs(mode: TimerMode, settings: AppSettings): number {
  switch (mode) {
    case 'shortBreak':
      return settings.shortBreakMin * 60 * 1000;
    case 'longBreak':
      return settings.longBreakMin * 60 * 1000;
    default:
      return settings.workMin * 60 * 1000;
  }
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function getModeTitle(mode: TimerMode): string {
  switch (mode) {
    case 'shortBreak':
      return 'Short Break';
    case 'longBreak':
      return 'Long Break';
    default:
      return 'Focus';
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Generate dynamic SVG favicon reflecting time & mode
function updateFavicon(remainingFraction: number, mode: TimerMode, isRunning: boolean): void {
  const favicon = document.getElementById('dynamicFavicon') as HTMLLinkElement | null;
  if (!favicon) return;

  const color = mode === 'work' ? '%23FF8A65' : mode === 'shortBreak' ? '%2334D399' : '%23A78BFA';
  const radius = 13;
  const circ = 2 * Math.PI * radius;
  const offset = (circ * (1 - Math.max(0, Math.min(1, remainingFraction)))).toFixed(2);
  const playSymbol = isRunning
    ? `<rect x='12' y='11' width='3' height='10' fill='%23FFFFFF'/><rect x='17' y='11' width='3' height='10' fill='%23FFFFFF'/>`
    : `<polygon points='13,11 21,16 13,21' fill='%23FFFFFF'/>`;

  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>
    <circle cx='16' cy='16' r='${radius}' fill='none' stroke='%23333333' stroke-width='3.5' opacity='0.3'/>
    <circle cx='16' cy='16' r='${radius}' fill='none' stroke='${color}' stroke-width='3.5' stroke-dasharray='${circ.toFixed(2)}' stroke-dashoffset='${offset}' transform='rotate(-90 16 16)' stroke-linecap='round'/>
    ${playSymbol}
  </svg>`.replace(/\s+/g, ' ');

  favicon.href = `data:image/svg+xml,${svg}`;
}

function showNotification(title: string, body: string): void {
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body,
        icon: '/favicon.ico',
        silent: false,
      });
    } catch {}
  }
}

// App Bootstrap
function initApp(): void {
  const initialPartial = loadStoredState();
  const settings: AppSettings = initialPartial.settings ?? DEFAULT_SETTINGS;
  const currentMode: TimerMode = initialPartial.currentMode ?? 'work';
  const initialDuration = getModeDurationMs(currentMode, settings);

  const initialState: AppState = {
    settings,
    currentMode,
    currentCycle: initialPartial.currentCycle ?? 1,
    tasks: initialPartial.tasks ?? [],
    activeTaskId: initialPartial.activeTaskId ?? null,
    isRunning: false,
    remainingMs: initialDuration,
    totalDurationMs: initialDuration,
    zenMode: initialPartial.zenMode ?? false,
    ambientSound: initialPartial.ambientSound ?? 'none',
    ambientVolume: initialPartial.ambientVolume ?? 0.3,
    taskFilter: initialPartial.taskFilter ?? 'all',
  };

  const store = new Store<AppState>(initialState);

  // Background sync with backend if online
  ApiClient.isHealthy().then(async (online) => {
    if (!online) return;
    const [remoteTasks, remoteSettings] = await Promise.all([
      ApiClient.getTasks(),
      ApiClient.getSettings(),
    ]);
    if (remoteTasks !== null) {
      store.set((prev) => {
        const remoteMap = new Map(remoteTasks.map((t) => [t.id, t]));
        const localOnly = prev.tasks.filter((t) => !remoteMap.has(t.id));
        localOnly.forEach((t) => ApiClient.createTask(t.text, t.id, t.pomodoroCount));
        const merged = [...localOnly, ...remoteTasks].sort((a, b) => b.createdAt - a.createdAt);
        return { tasks: merged };
      });
    }
    if (remoteSettings) {
      if (remoteSettings.themeColor) {
        selectedThemeColor = remoteSettings.themeColor;
      }
      store.set((prev) => ({
        settings: { ...prev.settings, ...remoteSettings },
        ambientSound: remoteSettings.ambientSound ?? prev.ambientSound,
        ambientVolume: remoteSettings.ambientVolume ?? prev.ambientVolume,
        remainingMs: !prev.isRunning ? getModeDurationMs(prev.currentMode, remoteSettings) : prev.remainingMs,
        totalDurationMs: !prev.isRunning ? getModeDurationMs(prev.currentMode, remoteSettings) : prev.totalDurationMs,
      }));
      if (remoteSettings.themeColor) {
        applyThemeColor(remoteSettings.themeColor);
        paletteSwatches.forEach((s) => s.classList.toggle('active', s.dataset.palette === remoteSettings.themeColor));
      }
      if (remoteSettings.theme) {
        applyTheme(remoteSettings.theme);
      }
      if (remoteSettings.ambientSound) {
        ambientChips.forEach((chip) => {
          chip.classList.toggle('active', chip.dataset.sound === remoteSettings.ambientSound);
        });
        if (ambientStatusTag) {
          ambientStatusTag.textContent = remoteSettings.ambientSound === 'none' ? 'Muted' : remoteSettings.ambientSound.toUpperCase();
          ambientStatusTag.classList.toggle('active', remoteSettings.ambientSound !== 'none');
        }
      }
      if (typeof remoteSettings.ambientVolume === 'number') {
        if (ambientVolSlider) ambientVolSlider.value = String(remoteSettings.ambientVolume);
        if (ambientVolVal) ambientVolVal.textContent = `${Math.round(remoteSettings.ambientVolume * 100)}%`;
        sound.setAmbientVolume(remoteSettings.ambientVolume);
      }
      if (particleEngine && remoteSettings.particleIntensity) {
        particleEngine.setIntensity(remoteSettings.particleIntensity);
      }
      pipEngine?.render(store.get());
    }
  }).catch(() => {});

  const sound = new SoundEngine();
  sound.setSoundEnabled(settings.soundEnabled);

  // Background Particles
  const bgCanvas = document.getElementById('bg-canvas') as HTMLCanvasElement | null;
  let particleEngine: ParticleEngine | null = null;
  if (bgCanvas) {
    particleEngine = new ParticleEngine(bgCanvas);
  }

  // DOM Elements
  const appContainer = document.getElementById('appContainer') as HTMLElement | null;
  const progressRing = document.getElementById('progressRing') as SVGCircleElement | null;
  const timeDigits = document.getElementById('timeDigits') as HTMLElement | null;
  const timerStatusBadge = document.getElementById('timerStatusBadge') as HTMLElement | null;
  const dailyStatsText = document.getElementById('dailyStatsText') as HTMLElement | null;
  const dailyStatsBadge = document.getElementById('dailyStatsBadge') as HTMLElement | null;
  const quickAdjustButtons = document.querySelectorAll<HTMLButtonElement>('.quick-adjust-btn');
  const toggleBtn = document.getElementById('toggleBtn') as HTMLButtonElement | null;
  const toggleBtnText = document.getElementById('toggleBtnText') as HTMLElement | null;
  const playPauseIcon = document.getElementById('playPauseIcon') as SVGElement | null;
  const resetBtn = document.getElementById('resetBtn') as HTMLButtonElement | null;
  const skipBtn = document.getElementById('skipBtn') as HTMLButtonElement | null;
  const modeButtons = document.querySelectorAll<HTMLButtonElement>('.mode-btn');
  const cycleDots = document.querySelectorAll<HTMLElement>('.cycle-dot');
  const cycleStepText = document.getElementById('cycleStepText') as HTMLElement | null;

  const soundToggleBtn = document.getElementById('soundToggleBtn') as HTMLButtonElement | null;
  const soundIcon = document.getElementById('soundIcon') as SVGElement | null;
  const hapticToggleBtn = document.getElementById('hapticToggleBtn') as HTMLButtonElement | null;
  const zenToggleBtn = document.getElementById('zenToggleBtn') as HTMLButtonElement | null;
  const themeToggleBtn = document.getElementById('themeToggleBtn') as HTMLButtonElement | null;
  const themeIcon = document.getElementById('themeIcon') as SVGElement | null;

  // Ambient soundscape DOM
  const ambientChips = document.querySelectorAll<HTMLButtonElement>('.ambient-chip');
  const ambientVolSlider = document.getElementById('ambientVolSlider') as HTMLInputElement | null;
  const ambientVolVal = document.getElementById('ambientVolVal') as HTMLElement | null;
  const ambientStatusTag = document.getElementById('ambientStatusTag') as HTMLElement | null;

  // Tasks DOM
  const taskForm = document.getElementById('taskForm') as HTMLFormElement | null;
  const taskInput = document.getElementById('taskInput') as HTMLInputElement | null;
  const taskList = document.getElementById('taskList') as HTMLUListElement | null;
  const taskCounterTag = document.getElementById('taskCounterTag') as HTMLElement | null;
  const clearCompletedBtn = document.getElementById('clearCompletedBtn') as HTMLButtonElement | null;
  const filterTabs = document.querySelectorAll<HTMLButtonElement>('.filter-tab');
  const activeFocusContainer = document.getElementById('activeFocusContainer') as HTMLElement | null;

  // Timeline DOM
  const todayTimelineList = document.getElementById('todayTimelineList') as HTMLElement | null;
  const timelineCountBadge = document.getElementById('timelineCountBadge') as HTMLElement | null;

  // Undo Toast DOM
  const undoToast = document.getElementById('undoToast') as HTMLElement | null;
  const undoToastBtn = document.getElementById('undoToastBtn') as HTMLButtonElement | null;
  let undoTimeoutId: number | null = null;
  let lastDeletedTask: Task | null = null;

  // Settings Modal DOM
  const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement | null;
  const settingsDialog = document.getElementById('settingsDialog') as HTMLDialogElement | null;
  const closeSettingsBtn = document.getElementById('closeSettingsBtn') as HTMLButtonElement | null;
  const cancelSettingsBtn = document.getElementById('cancelSettingsBtn') as HTMLButtonElement | null;
  const settingsForm = document.getElementById('settingsForm') as HTMLFormElement | null;
  const workDurationInput = document.getElementById('workDurationInput') as HTMLInputElement | null;
  const shortBreakInput = document.getElementById('shortBreakInput') as HTMLInputElement | null;
  const longBreakInput = document.getElementById('longBreakInput') as HTMLInputElement | null;
  const longBreakIntervalInput = document.getElementById('longBreakIntervalInput') as HTMLInputElement | null;
  const chimePresetSelect = document.getElementById('chimePresetSelect') as HTMLSelectElement | null;
  const tickingSoundSelect = document.getElementById('tickingSoundSelect') as HTMLSelectElement | null;
  const autoStartBreaksToggle = document.getElementById('autoStartBreaksToggle') as HTMLInputElement | null;
  const autoStartFocusToggle = document.getElementById('autoStartFocusToggle') as HTMLInputElement | null;
  const dailyGoalInput = document.getElementById('dailyGoalInput') as HTMLInputElement | null;
  const particleIntensitySelect = document.getElementById('particleIntensitySelect') as HTMLSelectElement | null;
  const notificationsToggle = document.getElementById('notificationsToggle') as HTMLInputElement | null;
  const paletteSwatches = document.querySelectorAll<HTMLButtonElement>('.palette-swatch');

  // Shortcuts HUD Dialog DOM
  const shortcutsBtn = document.getElementById('shortcutsBtn') as HTMLButtonElement | null;
  const shortcutsDialog = document.getElementById('shortcutsDialog') as HTMLDialogElement | null;
  const closeShortcutsBtn = document.getElementById('closeShortcutsBtn') as HTMLButtonElement | null;
  const okShortcutsBtn = document.getElementById('okShortcutsBtn') as HTMLButtonElement | null;
  const progressOrbitDot = document.getElementById('progressOrbitDot') as SVGCircleElement | null;

  // Picture-in-Picture Engine & Controls DOM
  const pipToggleBtn = document.getElementById('pipToggleBtn') as HTMLButtonElement | null;
  const pipCanvas = document.getElementById('pipCanvas') as HTMLCanvasElement | null;
  const pipVideo = document.getElementById('pipVideo') as HTMLVideoElement | null;

  let pipEngine: PipEngine | null = null;
  if (pipCanvas && pipVideo) {
    try {
      pipEngine = new PipEngine(pipCanvas, pipVideo, store);
    } catch (err) {
      console.warn('Failed to initialize PipEngine:', err);
    }
  }

  // Stats Modal DOM
  const statsDialog = document.getElementById('statsDialog') as HTMLDialogElement | null;
  const closeStatsBtn = document.getElementById('closeStatsBtn') as HTMLButtonElement | null;
  const okStatsBtn = document.getElementById('okStatsBtn') as HTMLButtonElement | null;
  const statsModalTotalFocus = document.getElementById('statsModalTotalFocus') as HTMLElement | null;
  const statsModalCompletedCount = document.getElementById('statsModalCompletedCount') as HTMLElement | null;
  const statsModalCurrentRound = document.getElementById('statsModalCurrentRound') as HTMLElement | null;
  const statsModalSessionsList = document.getElementById('statsModalSessionsList') as HTMLElement | null;

  let targetEndTime: number | null = null;
  let editingTaskId: string | null = null;
  let selectedThemeColor = settings.themeColor || 'peach';
  let lastTickSecond = -1;

  // Theme & Color synchronization
  const applyThemeColor = (color: string) => {
    document.documentElement.setAttribute('data-color', color);
    if (particleEngine) {
      if (color === 'mint') {
        particleEngine.setThemeColors('rgba(16, 185, 129, 0.7)', 'rgba(52, 211, 153, 0.7)');
      } else if (color === 'lilac') {
        particleEngine.setThemeColors('rgba(139, 92, 246, 0.7)', 'rgba(196, 181, 253, 0.7)');
      } else if (color === 'ocean') {
        particleEngine.setThemeColors('rgba(2, 132, 199, 0.7)', 'rgba(56, 189, 248, 0.7)');
      } else if (color === 'mono') {
        particleEngine.setThemeColors('rgba(200, 200, 200, 0.7)', 'rgba(255, 255, 255, 0.7)');
      } else {
        particleEngine.setThemeColors('rgba(255, 138, 101, 0.7)', 'rgba(167, 139, 250, 0.7)');
      }
    }
  };

  applyThemeColor(selectedThemeColor);
  if (particleEngine && settings.particleIntensity) {
    particleEngine.setIntensity(settings.particleIntensity);
  }

  // Hydrate DOM controls from restored store state
  ambientChips.forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.sound === initialState.ambientSound);
  });
  if (ambientStatusTag) {
    ambientStatusTag.textContent = initialState.ambientSound === 'none' ? 'Muted' : initialState.ambientSound.toUpperCase();
    ambientStatusTag.classList.toggle('active', initialState.ambientSound !== 'none');
  }
  if (ambientVolSlider) {
    ambientVolSlider.value = String(initialState.ambientVolume);
  }
  if (ambientVolVal) {
    ambientVolVal.textContent = `${Math.round(initialState.ambientVolume * 100)}%`;
  }
  sound.setAmbientVolume(initialState.ambientVolume);

  filterTabs.forEach((tab) => {
    tab.classList.toggle('active', (tab.dataset.filter || 'all') === initialState.taskFilter);
  });
  paletteSwatches.forEach((swatch) => {
    swatch.classList.toggle('active', swatch.dataset.palette === selectedThemeColor);
  });

  // Theme synchronization
  const applyTheme = (theme: AppTheme) => {
    let resolvedTheme = theme;
    if (theme === 'auto') {
      resolvedTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', resolvedTheme);

    if (themeIcon) {
      themeIcon.innerHTML = resolvedTheme === 'dark'
        ? `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`
        : `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`;
    }
  };

  applyTheme(settings.theme || 'auto');
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (store.get().settings.theme === 'auto') {
      applyTheme('auto');
      pipEngine?.render(store.get());
    }
  });

  // Timeline & Stats Refresh
  const refreshStats = async (): Promise<void> => {
    try {
      const [stats, sessions] = await Promise.all([
        ApiClient.getSessionStats(),
        ApiClient.getTodaySessions(),
      ]);

      if (stats && dailyStatsText) {
        dailyStatsText.textContent = `${stats.totalFocusMinutes}m Focused Today`;
      }
      if (statsModalTotalFocus && stats) {
        statsModalTotalFocus.textContent = `${stats.totalFocusMinutes}m`;
      }
      if (statsModalCompletedCount && stats) {
        statsModalCompletedCount.textContent = String(stats.completedSessionsToday);
      }

      if (sessions && todayTimelineList && timelineCountBadge) {
        timelineCountBadge.textContent = `${sessions.length} sessions`;
        if (sessions.length === 0) {
          todayTimelineList.innerHTML = `<div class="timeline-empty">No sessions logged yet today. Complete your first focus block!</div>`;
          if (statsModalSessionsList) {
            statsModalSessionsList.innerHTML = `<div class="timeline-empty">No sessions completed yet today.</div>`;
          }
        } else {
          const markup = sessions
            .slice(0, 8)
            .map((s) => {
              const date = new Date(s.created_at);
              const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const isWork = s.mode === 'work' || s.mode === 'focus';
              const label = isWork ? (s.task_title ? escapeHtml(s.task_title) : 'Focus Block') : 'Rest Break';
              return `
                <div class="timeline-item">
                  <div class="timeline-left">
                    <span class="timeline-dot ${isWork ? '' : 'break'}"></span>
                    <span class="timeline-label">${label}</span>
                  </div>
                  <span class="timeline-right">${s.duration_minutes}m · ${timeStr}</span>
                </div>
              `;
            })
            .join('');
          todayTimelineList.innerHTML = markup;
          if (statsModalSessionsList) {
            statsModalSessionsList.innerHTML = markup;
          }
        }
      }
    } catch {
      // offline silent fallback
    }
  };

  refreshStats();

  // Cycle UI update helper
  const updateCycleUI = (cycle: number) => {
    cycleDots.forEach((dot) => {
      const dotCycle = parseInt(dot.dataset.cycle || '1', 10);
      dot.classList.toggle('completed', dotCycle < cycle);
      dot.classList.toggle('active', dotCycle === cycle);
    });
    if (cycleStepText) cycleStepText.textContent = `${cycle} of 4`;
    if (statsModalCurrentRound) statsModalCurrentRound.textContent = `${cycle} / 4`;
  };

  // Timer Tick Event
  const onTick = () => {
    const s = store.get();
    if (!s.isRunning || targetEndTime === null) return;

    const diff = targetEndTime - Date.now();
    if (diff <= 0) {
      // Session Complete Celebration!
      timer.stop();
      sound.playChime(s.settings.soundPreset || 'chord');
      sound.triggerHaptic(s.settings.hapticEnabled, [200, 100, 200, 100, 400]);
      if (particleEngine) particleEngine.triggerBurst(undefined, undefined, 45);

      // Record completed session
      const durMinutes = Math.max(1, Math.round(s.totalDurationMs / 60000));
      ApiClient.recordSession(s.currentMode, durMinutes, s.activeTaskId).then(() => {
        refreshStats();
        // Optimistically increment task tally
        if (s.activeTaskId && s.currentMode === 'work') {
          store.set((prev) => ({
            tasks: prev.tasks.map((t) => (t.id === prev.activeTaskId ? { ...t, pomodoroCount: (t.pomodoroCount || 0) + 1 } : t)),
          }));
        }
      });

      // Desktop notification
      const modeLabel = getModeTitle(s.currentMode);
      showNotification(`${modeLabel} Complete!`, `You finished ${durMinutes}m of ${modeLabel.toLowerCase()}. Time to recharge.`);

      // Cycle progression
      const maxCycles = s.settings.longBreakInterval ?? 4;
      let nextMode: TimerMode;
      let nextCycle = s.currentCycle;

      if (s.currentMode === 'work') {
        if (s.currentCycle >= maxCycles) {
          nextMode = 'longBreak';
          nextCycle = 1;
        } else {
          nextMode = 'shortBreak';
          nextCycle = s.currentCycle + 1;
        }
      } else {
        nextMode = 'work';
      }

      const nextDuration = getModeDurationMs(nextMode, s.settings);
      const shouldAutoStart =
        (nextMode !== 'work' && s.settings.autoStartBreaks) ||
        (nextMode === 'work' && s.settings.autoStartFocus);

      if (shouldAutoStart) {
        targetEndTime = Date.now() + nextDuration;
        store.set({
          isRunning: true,
          currentMode: nextMode,
          currentCycle: nextCycle,
          remainingMs: nextDuration,
          totalDurationMs: nextDuration,
        });
        timer.start();
        if (s.ambientSound !== 'none') {
          sound.startAmbient(s.ambientSound, s.ambientVolume);
        }
      } else {
        targetEndTime = null;
        sound.stopAmbient();
        store.set({
          isRunning: false,
          currentMode: nextMode,
          currentCycle: nextCycle,
          remainingMs: nextDuration,
          totalDurationMs: nextDuration,
        });
      }
    } else {
      // Play ticking if enabled and second changed
      const currentSec = Math.floor(diff / 1000);
      if (currentSec !== lastTickSecond) {
        lastTickSecond = currentSec;
        if (s.settings.tickingSound && s.settings.tickingSound !== 'off') {
          sound.playTicking(s.settings.tickingSound);
        }
      }
      store.set({ remainingMs: diff });
    }
  };

  const timer = new PrecisionTimer(onTick, 100);

  // Persistence subscriber - only fires when non-tick state changes
  let prevStorageJson = '';
  store.select(
    (s) => ({
      settings: s.settings,
      currentMode: s.currentMode,
      currentCycle: s.currentCycle,
      tasks: s.tasks,
      activeTaskId: s.activeTaskId,
      zenMode: s.zenMode,
      ambientSound: s.ambientSound,
      ambientVolume: s.ambientVolume,
      taskFilter: s.taskFilter,
    }),
    (stateToPersist) => {
      const payload = JSON.stringify(stateToPersist);
      if (payload !== prevStorageJson) {
        prevStorageJson = payload;
        try {
          localStorage.setItem(STORAGE_KEY, payload);
        } catch (err) {
          console.warn('Failed saving state to storage:', err);
        }
      }
    },
    (a, b) =>
      a.settings === b.settings &&
      a.currentMode === b.currentMode &&
      a.currentCycle === b.currentCycle &&
      a.tasks === b.tasks &&
      a.activeTaskId === b.activeTaskId &&
      a.zenMode === b.zenMode &&
      a.ambientSound === b.ambientSound &&
      a.ambientVolume === b.ambientVolume &&
      a.taskFilter === b.taskFilter
  );

  // Fast Timer Render Subscription
  let prevRemainingFormatted = '';
  let prevRingOffset: number | null = null;
  let prevTitle = '';

  store.select(
    (s) => ({
      remainingMs: s.remainingMs,
      totalDurationMs: s.totalDurationMs,
      currentMode: s.currentMode,
      isRunning: s.isRunning,
    }),
    ({ remainingMs, totalDurationMs, currentMode, isRunning }) => {
      const formatted = formatTime(remainingMs);
      const fraction = totalDurationMs > 0 ? remainingMs / totalDurationMs : 0;

      if (formatted !== prevRemainingFormatted) {
        prevRemainingFormatted = formatted;
        if (timeDigits) timeDigits.textContent = formatted;

        const modeLabel = getModeTitle(currentMode);
        const title = `${formatted} - ${modeLabel} | Focus & Flow`;
        if (title !== prevTitle) {
          prevTitle = title;
          document.title = title;
        }

        updateFavicon(fraction, currentMode, isRunning);
      }

      const offset = RING_CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, fraction)));
      if (prevRingOffset === null || Math.abs(offset - prevRingOffset) >= 0.05) {
        prevRingOffset = offset;
        if (progressRing) progressRing.style.strokeDashoffset = offset.toFixed(2);

        // Update orbiting glow particle tracker on progress ring
        if (progressOrbitDot) {
          const angle = -Math.PI / 2 + 2 * Math.PI * (1 - Math.max(0, Math.min(1, fraction)));
          const cx = 120 + RING_RADIUS * Math.cos(angle);
          const cy = 120 + RING_RADIUS * Math.sin(angle);
          progressOrbitDot.setAttribute('cx', cx.toFixed(2));
          progressOrbitDot.setAttribute('cy', cy.toFixed(2));
        }
      }

      // Sync state to Picture-in-Picture canvas only if PiP window is open
      if (pipEngine?.isActive()) {
        pipEngine.render(store.get());
      }
    },
    (a, b) =>
      a.remainingMs === b.remainingMs &&
      a.totalDurationMs === b.totalDurationMs &&
      a.currentMode === b.currentMode &&
      a.isRunning === b.isRunning
  );

  // Status badge, control buttons, cycle dots
  store.select(
    (s) => ({
      isRunning: s.isRunning,
      currentMode: s.currentMode,
      currentCycle: s.currentCycle,
      zenMode: s.zenMode,
    }),
    ({ isRunning, currentMode, currentCycle, zenMode }) => {
      if (timerStatusBadge) {
        if (!isRunning) {
          timerStatusBadge.textContent = 'Paused';
        } else if (currentMode === 'work') {
          timerStatusBadge.textContent = 'Focusing';
        } else if (currentMode === 'shortBreak') {
          timerStatusBadge.textContent = 'Short Break';
        } else {
          timerStatusBadge.textContent = 'Long Break';
        }
      }

      if (toggleBtn && toggleBtnText && playPauseIcon) {
        if (isRunning) {
          toggleBtn.classList.add('running');
          toggleBtnText.textContent = 'Pause';
          playPauseIcon.innerHTML = `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`;
        } else {
          toggleBtn.classList.remove('running');
          toggleBtnText.textContent = 'Start';
          playPauseIcon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"/>`;
        }
      }

      modeButtons.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === currentMode);
      });

      updateCycleUI(currentCycle);

      if (appContainer) {
        appContainer.classList.toggle('zen-mode', zenMode);
      }
      if (zenToggleBtn) {
        zenToggleBtn.classList.toggle('active', zenMode);
      }
    },
    (a, b) =>
      a.isRunning === b.isRunning &&
      a.currentMode === b.currentMode &&
      a.currentCycle === b.currentCycle &&
      a.zenMode === b.zenMode
  );

  // Render Tasks
  const renderTasks = (state: AppState) => {
    if (!taskList || !taskCounterTag || !activeFocusContainer) return;

    const total = state.tasks.length;
    const completed = state.tasks.filter((t) => t.completed).length;
    taskCounterTag.textContent = `${completed} / ${total}`;

    const filtered = state.tasks.filter((t) => {
      if (state.taskFilter === 'active') return !t.completed;
      if (state.taskFilter === 'completed') return t.completed;
      return true;
    });

    if (filtered.length === 0) {
      taskList.innerHTML = `<li class="empty-task-state">No ${state.taskFilter === 'all' ? '' : state.taskFilter} tasks found.</li>`;
    } else {
      taskList.innerHTML = filtered
        .map((task) => {
          const isEditing = editingTaskId === task.id;
          const pomodoroBadge = task.pomodoroCount && task.pomodoroCount > 0
            ? `<span class="task-pomodoro-badge" title="${task.pomodoroCount} focus sessions completed">⚡ ${task.pomodoroCount}</span>`
            : '';

          return `
            <li class="task-item ${task.completed ? 'completed' : ''} ${task.id === state.activeTaskId ? 'active-item' : ''}" data-id="${task.id}">
              <label class="task-checkbox-wrap" aria-label="Mark task complete">
                <input type="checkbox" ${task.completed ? 'checked' : ''} data-id="${task.id}">
                <div class="custom-check">
                  <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
              </label>
              ${
                isEditing
                  ? `<input type="text" class="task-edit-input" data-edit-id="${task.id}" value="${escapeHtml(task.text)}" maxlength="120">`
                  : `<span class="task-title" data-title-id="${task.id}" title="Double-click to edit">${escapeHtml(task.text)}</span>`
              }
              ${pomodoroBadge}
              <div class="task-actions">
                <button class="task-focus-btn" data-focus-id="${task.id}">
                  ${task.id === state.activeTaskId ? 'Active' : 'Focus'}
                </button>
                <button class="task-del-btn" data-del-id="${task.id}" title="Delete task" aria-label="Delete task">
                  <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </li>
          `;
        })
        .join('');

      // Auto focus inline edit input if active
      if (editingTaskId) {
        const editInput = taskList.querySelector<HTMLInputElement>(`[data-edit-id="${editingTaskId}"]`);
        if (editInput) {
          editInput.focus();
          editInput.select();
        }
      }
    }

    const activeTask = state.tasks.find((t) => t.id === state.activeTaskId);
    if (activeTask) {
      const pBadge = activeTask.pomodoroCount ? ` · ⚡ ${activeTask.pomodoroCount}` : '';
      activeFocusContainer.innerHTML = `
        <div class="active-focus-pill" title="Current Focus Target">
          <span class="dot"></span>
          <span class="task-name">${escapeHtml(activeTask.text)}${pBadge}</span>
          <button class="clear-focus-btn" id="clearActiveFocusBtn" title="Clear active target" aria-label="Clear active focus">
            <svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      `;
      const clearBtn = document.getElementById('clearActiveFocusBtn');
      clearBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        sound.playTick();
        store.set({ activeTaskId: null });
      });
    } else {
      activeFocusContainer.innerHTML = `<div class="no-active-focus">No active task selected</div>`;
    }
  };

  store.select(
    (s) => ({ tasks: s.tasks, activeTaskId: s.activeTaskId, taskFilter: s.taskFilter }),
    () => renderTasks(store.get()),
    (a, b) => a.tasks === b.tasks && a.activeTaskId === b.activeTaskId && a.taskFilter === b.taskFilter
  );

  // Sound & Haptics UI subscriber - only fires when sound/haptic settings change
  store.select(
    (s) => ({
      soundEnabled: s.settings.soundEnabled,
      hapticEnabled: s.settings.hapticEnabled,
    }),
    ({ soundEnabled, hapticEnabled }) => {
      sound.setSoundEnabled(soundEnabled);
      if (soundToggleBtn && soundIcon) {
        soundToggleBtn.classList.toggle('active', soundEnabled);
        soundIcon.innerHTML = soundEnabled
          ? `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>`
          : `<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>`;
      }
      if (hapticToggleBtn) {
        hapticToggleBtn.classList.toggle('active', hapticEnabled);
      }
    },
    (a, b) => a.soundEnabled === b.soundEnabled && a.hapticEnabled === b.hapticEnabled
  );

  // Actions
  function start(): void {
    sound.unlock();
    sound.playTick();
    const s = store.get();
    targetEndTime = Date.now() + s.remainingMs;
    store.set({ isRunning: true });
    timer.start();

    // Start ambient if configured
    if (s.ambientSound !== 'none') {
      sound.startAmbient(s.ambientSound, s.ambientVolume);
    }
  }

  function pause(): void {
    sound.playTick();
    const s = store.get();
    if (!s.isRunning) return;
    const remaining = Math.max(0, (targetEndTime ?? Date.now()) - Date.now());
    targetEndTime = null;
    timer.stop();
    sound.stopAmbient();
    store.set({ isRunning: false, remainingMs: remaining });
  }

  function reset(): void {
    sound.playTick();
    timer.stop();
    sound.stopAmbient();
    targetEndTime = null;
    const s = store.get();
    const dur = getModeDurationMs(s.currentMode, s.settings);
    store.set({ isRunning: false, remainingMs: dur, totalDurationMs: dur });
  }

  function adjustTime(deltaMs: number): void {
    sound.playTick();
    const s = store.get();
    if (s.isRunning && targetEndTime !== null) {
      const now = Date.now();
      const newTarget = Math.max(now + 10000, targetEndTime + deltaMs);
      targetEndTime = newTarget;
      const remaining = Math.max(10000, targetEndTime - now);
      const total = Math.max(remaining, s.totalDurationMs + deltaMs);
      store.set({ remainingMs: remaining, totalDurationMs: total });
    } else {
      const remaining = Math.max(10000, s.remainingMs + deltaMs);
      const total = Math.max(remaining, s.totalDurationMs + deltaMs);
      store.set({ remainingMs: remaining, totalDurationMs: total });
    }
  }

  function switchMode(newMode: TimerMode): void {
    timer.stop();
    sound.stopAmbient();
    sound.playModeSwitch(newMode);
    targetEndTime = null;
    const s = store.get();
    const dur = getModeDurationMs(newMode, s.settings);
    store.set({
      currentMode: newMode,
      isRunning: false,
      remainingMs: dur,
      totalDurationMs: dur,
    });
  }

  // Event Listeners
  toggleBtn?.addEventListener('click', () => {
    if (store.get().isRunning) {
      pause();
    } else {
      start();
    }
  });

  resetBtn?.addEventListener('click', reset);

  quickAdjustButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const delta = parseInt(btn.dataset.adjust || '0', 10);
      if (delta) adjustTime(delta);
    });
  });

  skipBtn?.addEventListener('click', () => {
    sound.playTick();
    const s = store.get();
    let next: TimerMode = 'work';
    let nextCycle = s.currentCycle;

    if (s.currentMode === 'work') {
      if (s.currentCycle >= 4) {
        next = 'longBreak';
        nextCycle = 1;
      } else {
        next = 'shortBreak';
        nextCycle = s.currentCycle + 1;
      }
    }
    store.set({ currentCycle: nextCycle });
    switchMode(next);
  });

  const modeNav = document.querySelector<HTMLElement>('.mode-nav');
  modeNav?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.mode-btn');
    if (btn) {
      const mode = btn.dataset.mode as TimerMode | undefined;
      if (mode && mode !== store.get().currentMode) {
        switchMode(mode);
      }
    }
  });

  modeButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mode = btn.dataset.mode as TimerMode | undefined;
      if (mode && mode !== store.get().currentMode) {
        switchMode(mode);
      }
    });
  });

  // Ambient Soundscape selector & volume
  ambientChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      sound.playTick();
      const soundType = (chip.dataset.sound || 'none') as AmbientSoundType;
      ambientChips.forEach((c) => c.classList.toggle('active', c === chip));

      const updatedSettings = { ...store.get().settings, ambientSound: soundType };
      store.set({ ambientSound: soundType, settings: updatedSettings });
      ApiClient.updateSettings(updatedSettings).catch(() => {});

      if (ambientStatusTag) {
        ambientStatusTag.textContent = soundType === 'none' ? 'Muted' : soundType.toUpperCase();
        ambientStatusTag.classList.toggle('active', soundType !== 'none');
      }

      if (store.get().isRunning) {
        if (soundType === 'none') {
          sound.stopAmbient();
        } else {
          sound.startAmbient(soundType, store.get().ambientVolume);
        }
      }
    });
  });

  let volDebounceTimer: number | null = null;
  ambientVolSlider?.addEventListener('input', () => {
    const val = parseFloat(ambientVolSlider.value) || 0.3;
    const updatedSettings = { ...store.get().settings, ambientVolume: val };
    store.set({ ambientVolume: val, settings: updatedSettings });
    sound.setAmbientVolume(val);
    if (ambientVolVal) ambientVolVal.textContent = `${Math.round(val * 100)}%`;

    if (volDebounceTimer !== null) clearTimeout(volDebounceTimer);
    volDebounceTimer = window.setTimeout(() => {
      ApiClient.updateSettings(store.get().settings).catch(() => {});
    }, 300);
  });

  // Sound & Haptics Toggles
  soundToggleBtn?.addEventListener('click', () => {
    const prev = store.get().settings.soundEnabled;
    const newSettings = { ...store.get().settings, soundEnabled: !prev };
    store.set({ settings: newSettings });
    ApiClient.updateSettings(newSettings).catch(() => {});
    if (!prev) {
      sound.unlock();
      sound.playTick();
    }
  });

  hapticToggleBtn?.addEventListener('click', () => {
    const prev = store.get().settings.hapticEnabled;
    const newSettings = { ...store.get().settings, hapticEnabled: !prev };
    store.set({ settings: newSettings });
    ApiClient.updateSettings(newSettings).catch(() => {});
    if (!prev) {
      sound.triggerHaptic(true, [60]);
    }
  });

  // Zen Mode Toggle
  zenToggleBtn?.addEventListener('click', () => {
    sound.playTick();
    store.set((prev) => ({ zenMode: !prev.zenMode }));
  });

  // Theme Toggle
  themeToggleBtn?.addEventListener('click', () => {
    sound.playTick();
    const current = store.get().settings.theme || 'auto';
    const nextTheme: AppTheme = current === 'auto' ? 'dark' : current === 'dark' ? 'light' : 'auto';
    const newSettings = { ...store.get().settings, theme: nextTheme };
    store.set({ settings: newSettings });
    ApiClient.updateSettings(newSettings).catch(() => {});
    applyTheme(nextTheme);
    pipEngine?.render(store.get());
  });

  // Task Filter Tabs
  filterTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      sound.playTick();
      const filter = (tab.dataset.filter || 'all') as TaskFilter;
      filterTabs.forEach((t) => t.classList.toggle('active', t === tab));
      store.set({ taskFilter: filter });
    });
  });

  // Task Form Submission
  taskForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!taskInput) return;
    const text = taskInput.value.trim();
    if (!text) return;

    sound.playPop();
    const newTask: Task = {
      id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      text,
      completed: false,
      createdAt: Date.now(),
      pomodoroCount: 0,
    };

    store.set((s) => ({
      tasks: [newTask, ...s.tasks],
      activeTaskId: s.activeTaskId ?? newTask.id,
    }));
    taskInput.value = '';

    ApiClient.createTask(text, newTask.id).catch(() => {});
  });

  // Clear Completed Tasks
  clearCompletedBtn?.addEventListener('click', () => {
    sound.playTick();
    store.set((s) => {
      const completedIds = new Set(s.tasks.filter((t) => t.completed).map((t) => t.id));
      return {
        tasks: s.tasks.filter((t) => !t.completed),
        activeTaskId: s.activeTaskId && completedIds.has(s.activeTaskId) ? null : s.activeTaskId,
      };
    });
    ApiClient.clearCompletedTasks().catch(() => {});
  });

  // Task List Delegation (Checkbox, Edit, Focus, Delete)
  taskList?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    // Checkbox toggle
    const checkInput = target.closest('input[type="checkbox"]') as HTMLInputElement | null;
    if (checkInput) {
      sound.playPop();
      const id = checkInput.dataset.id;
      if (id) {
        if (checkInput.checked && particleEngine) {
          const rect = checkInput.getBoundingClientRect();
          particleEngine.triggerBurst(rect.left + 10, rect.top + 10, 20);
        }
        store.set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, completed: checkInput.checked } : t)),
        }));
        ApiClient.updateTask(id, { completed: checkInput.checked }).catch(() => {});
      }
      return;
    }

    // Focus target toggle
    const focusBtn = target.closest('[data-focus-id]') as HTMLElement | null;
    if (focusBtn) {
      sound.playTick();
      const id = focusBtn.dataset.focusId;
      store.set((s) => ({
        activeTaskId: s.activeTaskId === id ? null : (id ?? null),
      }));
      return;
    }

    // Delete task with Undo Toast
    const delBtn = target.closest('[data-del-id]') as HTMLElement | null;
    if (delBtn) {
      sound.playTick();
      const id = delBtn.dataset.delId;
      if (id) {
        const taskToDelete = store.get().tasks.find((t) => t.id === id);
        if (taskToDelete) {
          lastDeletedTask = taskToDelete;
          store.set((s) => ({
            tasks: s.tasks.filter((t) => t.id !== id),
            activeTaskId: s.activeTaskId === id ? null : s.activeTaskId,
          }));

          // Show Undo Toast
          if (undoToast) {
            undoToast.hidden = false;
            if (undoTimeoutId !== null) clearTimeout(undoTimeoutId);
            undoTimeoutId = window.setTimeout(() => {
              if (undoToast) undoToast.hidden = true;
              if (lastDeletedTask) {
                ApiClient.deleteTask(lastDeletedTask.id).catch(() => {});
                lastDeletedTask = null;
              }
            }, 5000);
          }
        }
      }
      return;
    }
  });

  // Inline Task Editing via Double-Click
  taskList?.addEventListener('dblclick', (e) => {
    const target = e.target as HTMLElement;
    const titleEl = target.closest('[data-title-id]') as HTMLElement | null;
    if (titleEl) {
      const id = titleEl.dataset.titleId;
      if (id) {
        editingTaskId = id;
        renderTasks(store.get());
      }
    }
  });

  // Save inline task edit on Enter or Blur
  taskList?.addEventListener('keydown', (e) => {
    const editInput = e.target as HTMLInputElement;
    if (editInput?.classList.contains('task-edit-input')) {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveEdit(editInput);
      } else if (e.key === 'Escape') {
        editingTaskId = null;
        renderTasks(store.get());
      }
    }
  });

  taskList?.addEventListener('focusout', (e) => {
    const editInput = e.target as HTMLInputElement;
    if (editInput?.classList.contains('task-edit-input')) {
      saveEdit(editInput);
    }
  });

  let isSavingEdit = false;
  function saveEdit(input: HTMLInputElement) {
    if (isSavingEdit || !editingTaskId) return;
    const id = input.dataset.editId;
    if (!id || id !== editingTaskId) return;

    isSavingEdit = true;
    editingTaskId = null;
    const newText = input.value.trim();

    if (newText) {
      sound.playTick();
      store.set((s) => ({
        tasks: s.tasks.map((t) => (t.id === id ? { ...t, text: newText } : t)),
      }));
      ApiClient.updateTask(id, { text: newText }).catch(() => {}).finally(() => {
        isSavingEdit = false;
      });
    } else {
      isSavingEdit = false;
      renderTasks(store.get());
    }
  }

  // Undo button in toast
  undoToastBtn?.addEventListener('click', () => {
    if (lastDeletedTask) {
      sound.playPop();
      const restored = lastDeletedTask;
      lastDeletedTask = null;
      if (undoTimeoutId !== null) clearTimeout(undoTimeoutId);
      if (undoToast) undoToast.hidden = true;

      store.set((s) => ({
        tasks: [restored, ...s.tasks],
        activeTaskId: s.activeTaskId ?? restored.id,
      }));
      ApiClient.createTask(restored.text, restored.id, restored.pomodoroCount).catch(() => {});
    }
  });

  // Daily Stats Badge click -> Open Stats Summary Modal
  dailyStatsBadge?.addEventListener('click', () => {
    sound.playTick();
    refreshStats();
    statsDialog?.showModal();
  });

  closeStatsBtn?.addEventListener('click', () => {
    sound.playTick();
    statsDialog?.close();
  });

  okStatsBtn?.addEventListener('click', () => {
    sound.playTick();
    statsDialog?.close();
  });

  statsDialog?.addEventListener('click', (e) => {
    if (e.target === statsDialog) statsDialog.close();
  });

  // Settings Dialog
  const openSettings = () => {
    sound.playTick();
    const { settings } = store.get();
    if (workDurationInput) workDurationInput.value = String(settings.workMin);
    if (shortBreakInput) shortBreakInput.value = String(settings.shortBreakMin);
    if (longBreakInput) longBreakInput.value = String(settings.longBreakMin);
    if (longBreakIntervalInput) longBreakIntervalInput.value = String(settings.longBreakInterval ?? 4);
    if (dailyGoalInput) dailyGoalInput.value = String(settings.dailyGoalMinutes ?? 120);
    if (chimePresetSelect) chimePresetSelect.value = settings.soundPreset || 'chord';
    if (tickingSoundSelect) tickingSoundSelect.value = settings.tickingSound || 'off';
    if (particleIntensitySelect) particleIntensitySelect.value = settings.particleIntensity || 'balanced';
    if (autoStartBreaksToggle) autoStartBreaksToggle.checked = Boolean(settings.autoStartBreaks);
    if (autoStartFocusToggle) autoStartFocusToggle.checked = Boolean(settings.autoStartFocus);

    selectedThemeColor = settings.themeColor || 'peach';
    paletteSwatches.forEach((swatch) => {
      swatch.classList.toggle('active', swatch.dataset.palette === selectedThemeColor);
    });

    if (notificationsToggle) {
      notificationsToggle.checked =
        typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted';
    }
    settingsDialog?.showModal();
  };

  const closeSettings = () => {
    sound.playTick();
    settingsDialog?.close();
  };

  paletteSwatches.forEach((swatch) => {
    swatch.addEventListener('click', () => {
      sound.playTick();
      const palette = (swatch.dataset.palette || 'peach') as any;
      selectedThemeColor = palette;
      paletteSwatches.forEach((s) => s.classList.toggle('active', s === swatch));
      applyThemeColor(palette);

      const newSettings = { ...store.get().settings, themeColor: palette };
      store.set({ settings: newSettings });
      ApiClient.updateSettings(newSettings).catch(() => {});

      pipEngine?.render({
        ...store.get(),
        settings: newSettings,
      });
    });
  });

  settingsBtn?.addEventListener('click', openSettings);
  closeSettingsBtn?.addEventListener('click', closeSettings);
  cancelSettingsBtn?.addEventListener('click', closeSettings);

  settingsDialog?.addEventListener('click', (e) => {
    if (e.target === settingsDialog) closeSettings();
  });

  settingsForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    sound.playTick();

    if (notificationsToggle?.checked && 'Notification' in window && Notification.permission !== 'granted') {
      try {
        await Notification.requestPermission();
      } catch {}
    }

    const w = parseInt(workDurationInput?.value || '25', 10) || 25;
    const s = parseInt(shortBreakInput?.value || '5', 10) || 5;
    const l = parseInt(longBreakInput?.value || '15', 10) || 15;
    const interval = parseInt(longBreakIntervalInput?.value || '4', 10) || 4;
    const goal = parseInt(dailyGoalInput?.value || '120', 10) || 120;
    const chime = (chimePresetSelect?.value || 'chord') as any;
    const tick = (tickingSoundSelect?.value || 'off') as any;
    const intensity = (particleIntensitySelect?.value || 'balanced') as any;
    const autoBreaks = Boolean(autoStartBreaksToggle?.checked);
    const autoFocus = Boolean(autoStartFocusToggle?.checked);

    const newSettings: AppSettings = {
      ...store.get().settings,
      workMin: Math.min(120, Math.max(1, w)),
      shortBreakMin: Math.min(60, Math.max(1, s)),
      longBreakMin: Math.min(60, Math.max(1, l)),
      longBreakInterval: Math.min(8, Math.max(2, interval)),
      dailyGoalMinutes: Math.min(720, Math.max(15, goal)),
      theme: store.get().settings.theme || 'auto',
      themeColor: selectedThemeColor,
      soundPreset: chime,
      tickingSound: tick,
      particleIntensity: intensity,
      autoStartBreaks: autoBreaks,
      autoStartFocus: autoFocus,
      ambientSound: store.get().settings.ambientSound || 'none',
      ambientVolume: store.get().settings.ambientVolume ?? 0.3,
    };

    applyThemeColor(selectedThemeColor);
    if (particleEngine) {
      particleEngine.setIntensity(intensity);
    }

    ApiClient.updateSettings(newSettings).catch(() => {});

    store.set((prev) => {
      const next: Partial<AppState> = { settings: newSettings };
      if (!prev.isRunning) {
        const dur = getModeDurationMs(prev.currentMode, newSettings);
        next.remainingMs = dur;
        next.totalDurationMs = dur;
      }
      return next;
    });

    pipEngine?.render(store.get());

    settingsDialog?.close();
  });

  // Shortcuts Dialog Wiring
  const openShortcuts = () => {
    sound.playTick();
    shortcutsDialog?.showModal();
  };
  const closeShortcuts = () => {
    sound.playTick();
    shortcutsDialog?.close();
  };

  shortcutsBtn?.addEventListener('click', openShortcuts);
  closeShortcutsBtn?.addEventListener('click', closeShortcuts);
  okShortcutsBtn?.addEventListener('click', closeShortcuts);
  shortcutsDialog?.addEventListener('click', (e) => {
    if (e.target === shortcutsDialog) closeShortcuts();
  });

  // Interactive 3D Perspective Tilt on Cards (Desktop fine pointer only)
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.querySelectorAll<HTMLElement>('.card').forEach((card) => {
      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = ((y - centerY) / centerY) * -3.2;
        const rotateY = ((x - centerX) / centerX) * 3.2;
        card.style.transform = `perspective(900px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateY(-2px)`;
      });
      card.addEventListener('mouseleave', () => {
        card.style.transform = '';
      });
      card.addEventListener('click', () => {
        card.style.transform = '';
      });
    });
  }

  // Picture-in-Picture event wiring
  pipToggleBtn?.addEventListener('click', () => {
    sound.playTick();
    pipEngine?.toggle().catch((err) => console.warn('PiP toggle error:', err));
  });

  pipVideo?.addEventListener('enterpictureinpicture', () => {
    pipToggleBtn?.classList.add('active');
  });

  pipVideo?.addEventListener('leavepictureinpicture', () => {
    pipToggleBtn?.classList.remove('active');
  });

  // Global Keyboard Shortcuts: Space, R, S, Z, T, M, P, ?, Escape
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    const tagName = target?.tagName?.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea' || target?.isContentEditable) {
      if (e.key === 'Escape') {
        (target as HTMLElement).blur();
      }
      return;
    }

    if (settingsDialog?.open || statsDialog?.open || shortcutsDialog?.open) {
      if (e.key === 'Escape') {
        settingsDialog?.close();
        statsDialog?.close();
        shortcutsDialog?.close();
      }
      return;
    }

    if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) {
      e.preventDefault();
      openShortcuts();
    } else if (e.code === 'Space') {
      e.preventDefault();
      if (target && tagName === 'button') target.blur();
      if (store.get().isRunning) {
        pause();
      } else {
        start();
      }
    } else if (e.code === 'KeyR') {
      e.preventDefault();
      reset();
    } else if (e.code === 'KeyS') {
      e.preventDefault();
      sound.playTick();
      const s = store.get();
      let next: TimerMode = 'work';
      let nextCycle = s.currentCycle;
      const maxCycles = s.settings.longBreakInterval ?? 4;
      if (s.currentMode === 'work') {
        if (s.currentCycle >= maxCycles) {
          next = 'longBreak';
          nextCycle = 1;
        } else {
          next = 'shortBreak';
          nextCycle = s.currentCycle + 1;
        }
      }
      store.set({ currentCycle: nextCycle });
      switchMode(next);
    } else if (e.code === 'KeyZ') {
      e.preventDefault();
      sound.playTick();
      store.set((prev) => ({ zenMode: !prev.zenMode }));
    } else if (e.code === 'KeyT') {
      e.preventDefault();
      taskInput?.focus();
    } else if (e.code === 'KeyM') {
      e.preventDefault();
      const prevSound = store.get().settings.soundEnabled;
      const newSettings = { ...store.get().settings, soundEnabled: !prevSound };
      store.set({ settings: newSettings });
      ApiClient.updateSettings(newSettings).catch(() => {});
    } else if (e.code === 'KeyP') {
      e.preventDefault();
      sound.playTick();
      pipEngine?.toggle().catch(() => {});
    }
  });
}

// Start application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
