import type { Store } from './store';
import type { AppState, TimerMode, AppTheme, ThemeColor } from './types';

interface SchemeColor {
  color: string;
  glow: string;
}

const PALETTES: Record<ThemeColor, Record<'dark' | 'light', SchemeColor>> = {
  peach: {
    dark: { color: '#FF8A65', glow: 'rgba(255, 138, 101, 0.22)' },
    light: { color: '#EA580C', glow: 'rgba(234, 88, 12, 0.12)' },
  },
  mint: {
    dark: { color: '#34D399', glow: 'rgba(52, 211, 153, 0.22)' },
    light: { color: '#059669', glow: 'rgba(5, 150, 105, 0.12)' },
  },
  lilac: {
    dark: { color: '#A78BFA', glow: 'rgba(167, 139, 250, 0.22)' },
    light: { color: '#7C3AED', glow: 'rgba(124, 58, 237, 0.12)' },
  },
  ocean: {
    dark: { color: '#38BDF8', glow: 'rgba(56, 189, 248, 0.22)' },
    light: { color: '#0284C7', glow: 'rgba(2, 132, 199, 0.12)' },
  },
  mono: {
    dark: { color: '#F3F4F6', glow: 'rgba(255, 255, 255, 0.18)' },
    light: { color: '#111827', glow: 'rgba(17, 24, 39, 0.08)' },
  },
};

const BREAK_PALETTES: Record<'shortBreak' | 'longBreak', Record<'dark' | 'light', SchemeColor>> = {
  shortBreak: {
    dark: { color: '#34D399', glow: 'rgba(52, 211, 153, 0.22)' },
    light: { color: '#059669', glow: 'rgba(5, 150, 105, 0.12)' },
  },
  longBreak: {
    dark: { color: '#A78BFA', glow: 'rgba(167, 139, 250, 0.22)' },
    light: { color: '#7C3AED', glow: 'rgba(124, 58, 237, 0.12)' },
  },
};

const THEME_TOKENS = {
  dark: {
    bg: '#0E1116',
    bgMid: 'rgba(14, 17, 22, 0.04)',
    bgEdge: 'rgba(14, 17, 22, 0)',
    track: 'rgba(255, 255, 255, 0.08)',
    badgeBg: 'rgba(255, 255, 255, 0.06)',
    textPrimary: '#FFFFFF',
    textSecondary: 'rgba(255, 255, 255, 0.65)',
    dotCenter: '#FFFFFF',
    shadowBlurRing: 14,
    shadowBlurDot: 18,
  },
  light: {
    bg: '#FAF8F5',
    bgMid: 'rgba(250, 248, 245, 0.04)',
    bgEdge: 'rgba(250, 248, 245, 0)',
    track: 'rgba(70, 50, 40, 0.10)',
    badgeBg: 'rgba(70, 50, 40, 0.06)',
    textPrimary: '#1F2421',
    textSecondary: 'rgba(31, 36, 33, 0.65)',
    dotCenter: '#FFFFFF',
    shadowBlurRing: 8,
    shadowBlurDot: 10,
  },
};

const MODE_LABELS: Record<TimerMode, string> = {
  work: 'FOCUS',
  shortBreak: 'SHORT BREAK',
  longBreak: 'LONG BREAK',
};

function resolveTheme(theme?: AppTheme): 'dark' | 'light' {
  if (theme === 'light' || theme === 'dark') return theme;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

export class PipEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private video: HTMLVideoElement;
  private store: Store<AppState>;
  private stream: MediaStream | null = null;

  constructor(canvas: HTMLCanvasElement, video: HTMLVideoElement, store: Store<AppState>) {
    this.canvas = canvas;
    this.video = video;
    this.store = store;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context not supported');
    }
    this.ctx = context;
    this.render(this.store.get());
  }

  render(state: AppState): void {
    const { ctx, canvas } = this;
    const { width, height } = canvas;

    const currentTheme = resolveTheme(state.settings.theme);
    const tokens = THEME_TOKENS[currentTheme];

    const currentMode = state.currentMode;
    const paletteKey = state.settings.themeColor ?? 'peach';
    const scheme: SchemeColor =
      currentMode === 'work'
        ? (PALETTES[paletteKey] ?? PALETTES.peach)[currentTheme]
        : BREAK_PALETTES[currentMode][currentTheme];

    // 1. Adaptive Theme Background
    ctx.fillStyle = tokens.bg;
    ctx.fillRect(0, 0, width, height);

    // 2. Ambient Gradient Glow
    const cx = width / 2;
    const cy = 240;
    const ambient = ctx.createRadialGradient(cx, cy, 10, cx, cy, 230);
    ambient.addColorStop(0, scheme.glow);
    ambient.addColorStop(0.75, tokens.bgMid);
    ambient.addColorStop(1, tokens.bgEdge);
    ctx.fillStyle = ambient;
    ctx.fillRect(0, 0, width, height);

    // 3. Mode Pill Badge
    ctx.font = '700 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const badgeText = MODE_LABELS[currentMode] ?? 'FOCUS';
    const badgeWidth = ctx.measureText(badgeText).width + 28;
    const badgeHeight = 26;
    const badgeX = cx - badgeWidth / 2;
    const badgeY = 56;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 13);
    ctx.fillStyle = tokens.badgeBg;
    ctx.fill();
    ctx.strokeStyle = scheme.color;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = scheme.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, cx, badgeY + badgeHeight / 2);
    ctx.restore();

    // 4. Progress Ring
    const radius = 145;
    const fraction = state.totalDurationMs > 0
      ? Math.max(0, Math.min(1, state.remainingMs / state.totalDurationMs))
      : 0;
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + 2 * Math.PI * fraction;

    // Track
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = tokens.track;
    ctx.lineWidth = 14;
    ctx.stroke();

    // Progress
    if (fraction > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.strokeStyle = scheme.color;
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.shadowColor = scheme.color;
      ctx.shadowBlur = tokens.shadowBlurRing;
      ctx.stroke();
    }
    ctx.restore();

    // 5. Leading Luminous Orbit Dot
    if (fraction > 0) {
      const dotX = cx + radius * Math.cos(endAngle);
      const dotY = cy + radius * Math.sin(endAngle);

      ctx.save();
      ctx.beginPath();
      ctx.arc(dotX, dotY, 8, 0, 2 * Math.PI);
      ctx.fillStyle = scheme.color;
      ctx.shadowColor = scheme.color;
      ctx.shadowBlur = tokens.shadowBlurDot;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(dotX, dotY, 4.5, 0, 2 * Math.PI);
      ctx.fillStyle = tokens.dotCenter;
      ctx.shadowBlur = 0;
      ctx.fill();
      ctx.restore();
    }

    // 6. Bold Tabular Remaining Time Numerals
    const totalSecs = Math.max(0, Math.ceil(state.remainingMs / 1000));
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    const timeText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    ctx.save();
    ctx.font = '700 74px "JetBrains Mono", -apple-system, BlinkMacSystemFont, monospace';
    ctx.fillStyle = tokens.textPrimary;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(timeText, cx, cy);
    ctx.restore();

    // 7. Active Task Subtitle
    const activeTask = state.tasks.find((t) => t.id === state.activeTaskId);
    let taskText = activeTask && !activeTask.completed ? activeTask.text : 'Focus & Flow';
    ctx.save();
    ctx.font = '600 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    if (ctx.measureText(taskText).width > 360) {
      while (ctx.measureText(`${taskText}...`).width > 360 && taskText.length > 0) {
        taskText = taskText.slice(0, -1);
      }
      taskText = `${taskText}...`;
    }
    ctx.fillStyle = tokens.textSecondary;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(taskText, cx, 432);
    ctx.restore();
  }

  async enter(): Promise<void> {
    this.render(this.store.get());
    if (typeof document === 'undefined' || !('pictureInPictureEnabled' in document) || !document.pictureInPictureEnabled) {
      return;
    }
    if (this.isActive()) return;

    if (!this.stream && 'captureStream' in this.canvas) {
      this.stream = (this.canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(15);
      this.video.srcObject = this.stream;
    }

    try {
      if (this.video.paused) {
        await this.video.play().catch(() => {});
      }
      await this.video.requestPictureInPicture();
    } catch (err) {
      console.warn('PiP enter error:', err);
    }
  }

  async exit(): Promise<void> {
    if (typeof document !== 'undefined' && this.isActive() && document.exitPictureInPicture) {
      try {
        await document.exitPictureInPicture();
      } catch (err) {
        console.warn('PiP exit error:', err);
      }
    }
  }

  async toggle(): Promise<void> {
    if (this.isActive()) {
      await this.exit();
    } else {
      await this.enter();
    }
  }

  isActive(): boolean {
    return typeof document !== 'undefined' && document.pictureInPictureElement === this.video;
  }
}
// ponytail: canvas captureStream PiP; add documentPictureInPicture API when multi-interactive controls requested
