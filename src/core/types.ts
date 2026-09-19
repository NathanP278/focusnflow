export type TimerMode = 'work' | 'shortBreak' | 'longBreak';
export type AppTheme = 'light' | 'dark' | 'auto';
export type ThemeColor = 'peach' | 'mint' | 'lilac' | 'ocean' | 'mono';
export type SoundPreset = 'chord' | 'bowl' | 'marimba' | 'synth';
export type TickingSound = 'off' | 'subtle' | 'clock';
export type ParticleIntensity = 'off' | 'low' | 'balanced' | 'high';
export type AmbientSoundType = 'none' | 'rain' | 'binaural' | 'waves';
export type TaskFilter = 'all' | 'active' | 'completed';

export interface Task {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
  pomodoroCount?: number;
}

export interface AppSettings {
  workMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  soundEnabled: boolean;
  hapticEnabled: boolean;
  autoStartBreaks?: boolean;
  autoStartFocus?: boolean;
  longBreakInterval?: number;
  dailyGoalMinutes?: number;
  theme?: AppTheme;
  themeColor?: ThemeColor;
  soundPreset?: SoundPreset;
  tickingSound?: TickingSound;
  particleIntensity?: ParticleIntensity;
  ambientSound?: AmbientSoundType;
  ambientVolume?: number;
}

export interface AppState {
  settings: AppSettings;
  currentMode: TimerMode;
  currentCycle: number;
  tasks: Task[];
  activeTaskId: string | null;
  isRunning: boolean;
  remainingMs: number;
  totalDurationMs: number;
  zenMode: boolean;
  ambientSound: AmbientSoundType;
  ambientVolume: number;
  taskFilter: TaskFilter;
}

export type WorkerInMessage =
  | { command: 'start'; intervalMs?: number }
  | { command: 'setInterval'; intervalMs: number }
  | { command: 'stop' };

export type WorkerOutMessage = { type: 'tick' };
