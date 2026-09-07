// Short procedural cues: one lazy audio context, no samples or audio loop.
// Each voice stops and disconnects after its decay. Audio failure must never
// interrupt a move, and blocked autoplay must not queue stale game sounds.
// Keep cue calls and synthesis ready, but leave output muted for now.
const SFX_ENABLED = false;
let context;

function audioContext() {
  if (!SFX_ENABLED) return null;
  const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContext) return null;
  context ??= new AudioContext();
  return context;
}

export function unlockAudio() {
  try {
    const ctx = audioContext();
    if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => {});
  } catch { /* Audio is optional. */ }
}

function tone(ctx, start, frequency, endFrequency, duration, volume, type = 'sine') {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + .004);
  gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  oscillator.start(start);
  oscillator.stop(start + duration + .01);
}

function play(cue) {
  try {
    const ctx = audioContext();
    if (!ctx || ctx.state !== 'running') {
      unlockAudio();
      return;
    }
    const now = ctx.currentTime + .005;
    if (cue === 'move') {
      // A light, rounded tap.
      tone(ctx, now, 620, 280, .095, .10, 'triangle');
    } else if (cue === 'capture') {
      // A deeper knock with a short bright impact.
      tone(ctx, now, 240, 85, .18, .16, 'triangle');
      tone(ctx, now, 1050, 450, .055, .045);
    } else if (cue === 'playerTurn') {
      tone(ctx, now, 523.25, 523.25, .2, .075);
      tone(ctx, now + .12, 783.99, 783.99, .28, .065);
    }
  } catch { /* Audio is optional. */ }
}

export const audioCues = {
  move: () => play('move'),
  capture: () => play('capture'),
  // Reserved for a future human/computer turn handoff.
  playerTurn: () => play('playerTurn'),
};
