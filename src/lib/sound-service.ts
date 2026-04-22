/**
 * Sound Service - Generates pleasant success/error tunes using Web Audio API
 * No external audio files needed - all sounds are synthesized
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    // Resume if suspended (browser autoplay policy)
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

interface Note {
  freq: number;
  start: number;
  duration: number;
  gain?: number;
  type?: OscillatorType;
}

function playNotes(notes: Note[], masterGain = 0.15): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const master = ctx.createGain();
  master.gain.value = masterGain;
  master.connect(ctx.destination);

  notes.forEach(({ freq, start, duration, gain = 1, type = 'sine' }) => {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = type;
    osc.frequency.value = freq;

    // Smooth envelope: attack → sustain → release
    const attackTime = 0.02;
    const releaseTime = Math.min(duration * 0.4, 0.15);
    env.gain.setValueAtTime(0, ctx.currentTime + start);
    env.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + attackTime);
    env.gain.setValueAtTime(gain, ctx.currentTime + start + duration - releaseTime);
    env.gain.linearRampToValueAtTime(0, ctx.currentTime + start + duration);

    osc.connect(env);
    env.connect(master);

    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + duration + 0.05);
  });
}

/**
 * Play a premium success chime — uplifting 3-note melody with harmonics
 * Used after: product add, stock out, instant sell
 */
export function playSuccessSound(): void {
  // C5-E5-G5 major chord arpeggio with shimmer
  const baseTime = 0;
  playNotes([
    // Main melody: C5 → E5 → G5 (bright & uplifting)
    { freq: 523.25, start: baseTime,        duration: 0.18, gain: 1,   type: 'sine' },
    { freq: 659.25, start: baseTime + 0.12, duration: 0.18, gain: 0.9, type: 'sine' },
    { freq: 783.99, start: baseTime + 0.24, duration: 0.35, gain: 1,   type: 'sine' },

    // High octave shimmer (adds sparkle)
    { freq: 1046.50, start: baseTime + 0.24, duration: 0.25, gain: 0.3, type: 'sine' },
    { freq: 1567.98, start: baseTime + 0.30, duration: 0.20, gain: 0.15, type: 'sine' },

    // Subtle warmth (low octave)
    { freq: 261.63, start: baseTime,        duration: 0.55, gain: 0.2, type: 'triangle' },
  ], 0.15);
}

/**
 * Play a soft cash-register "ka-ching" style sound for sell operations
 * Used after: instant sell
 */
export function playSellSound(): void {
  const baseTime = 0;
  playNotes([
    // Bright "ding" — metallic bell
    { freq: 1200,  start: baseTime,       duration: 0.08, gain: 0.8,  type: 'square' },
    { freq: 2400,  start: baseTime,       duration: 0.04, gain: 0.3,  type: 'square' },

    // Followed by success chime
    { freq: 523.25, start: baseTime + 0.1, duration: 0.15, gain: 1,   type: 'sine' },
    { freq: 659.25, start: baseTime + 0.2, duration: 0.15, gain: 0.9, type: 'sine' },
    { freq: 783.99, start: baseTime + 0.3, duration: 0.4,  gain: 1,   type: 'sine' },

    // Sparkle
    { freq: 1567.98, start: baseTime + 0.35, duration: 0.25, gain: 0.2, type: 'sine' },

    // Warmth
    { freq: 261.63, start: baseTime + 0.1, duration: 0.6, gain: 0.15, type: 'triangle' },
  ], 0.12);
}

/**
 * Play a stock-out confirmation sound — slightly lower, firm tone
 * Used after: stock out
 */
export function playStockOutSound(): void {
  const baseTime = 0;
  playNotes([
    // Firm two-note descending
    { freq: 440,    start: baseTime,        duration: 0.15, gain: 1,   type: 'sine' },
    { freq: 349.23, start: baseTime + 0.1,  duration: 0.15, gain: 0.9, type: 'sine' },

    // Resolve up — success
    { freq: 523.25, start: baseTime + 0.2,  duration: 0.35, gain: 1,   type: 'sine' },
    { freq: 659.25, start: baseTime + 0.28, duration: 0.3,  gain: 0.7, type: 'sine' },

    // Sparkle
    { freq: 1046.50, start: baseTime + 0.3, duration: 0.25, gain: 0.25, type: 'sine' },

    // Warmth
    { freq: 220, start: baseTime, duration: 0.55, gain: 0.2, type: 'triangle' },
  ], 0.15);
}

/**
 * Play a stock-in sound — ascending, positive
 * Used after: stock in
 */
export function playStockInSound(): void {
  const baseTime = 0;
  playNotes([
    { freq: 349.23, start: baseTime,        duration: 0.15, gain: 1,   type: 'sine' },
    { freq: 440,    start: baseTime + 0.1,  duration: 0.15, gain: 0.9, type: 'sine' },
    { freq: 523.25, start: baseTime + 0.2,  duration: 0.35, gain: 1,   type: 'sine' },
    { freq: 1046.50, start: baseTime + 0.28, duration: 0.2, gain: 0.3, type: 'sine' },
    { freq: 261.63, start: baseTime,        duration: 0.5,  gain: 0.2, type: 'triangle' },
  ], 0.15);
}

/**
 * Play an error sound — short descending tone
 */
export function playErrorSound(): void {
  const baseTime = 0;
  playNotes([
    { freq: 400, start: baseTime,       duration: 0.12, gain: 1,   type: 'sawtooth' },
    { freq: 300, start: baseTime + 0.1, duration: 0.2,  gain: 0.8, type: 'sawtooth' },
  ], 0.08);
}
