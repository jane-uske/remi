/**
 * "Midnight Circuit" — the built-in demo track, synthesized locally with an
 * OfflineAudioContext (no bundled audio files, no network).
 *
 * 120 BPM, 8 bars, Am–F–C–G ×2. Four-on-the-floor kick, snare on 2/4,
 * 16th hats, sub bass, plucked arp through a feedback delay and a soft pad.
 * The strong periodic kick gives the beat detector a clear target.
 */

const BPM = 120;
const BEAT = 60 / BPM; // 0.5s
const BARS = 8;
const DURATION = BARS * 4 * BEAT; // 16s

interface Chord {
  bass: number;
  tones: number[];
  pad: number[];
}

// A minor: Am, F, C, G (frequencies in Hz)
const CHORDS: Chord[] = [
  { bass: 55.0, tones: [220.0, 261.63, 329.63, 440.0], pad: [220.0, 261.63, 329.63] },
  { bass: 43.65, tones: [174.61, 220.0, 261.63, 349.23], pad: [174.61, 220.0, 261.63] },
  { bass: 65.41, tones: [261.63, 329.63, 392.0, 523.25], pad: [261.63, 329.63, 392.0] },
  { bass: 49.0, tones: [196.0, 246.94, 293.66, 392.0], pad: [196.0, 246.94, 293.66] },
];

function makeNoiseBuffer(ctx: OfflineAudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const data = buf.getChannelData(0);
  let seed = 1234567;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 2147483648 - 1) * 0.999;
  }
  return buf;
}

export async function renderDemoTrack(): Promise<AudioBuffer> {
  const sampleRate = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(DURATION * sampleRate), sampleRate);
  const noise = makeNoiseBuffer(ctx, 1.5);

  const master = ctx.createGain();
  master.gain.value = 0.85;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 20;
  comp.ratio.value = 5;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;
  master.connect(comp);
  comp.connect(ctx.destination);

  const kick = (t: number, gain = 1) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.95 * gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + 0.32);
    // click transient
    const click = ctx.createBufferSource();
    click.buffer = noise;
    const cf = ctx.createBiquadFilter();
    cf.type = 'highpass';
    cf.frequency.value = 3500;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.3 * gain, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    click.connect(cf);
    cf.connect(cg);
    cg.connect(master);
    click.start(t, 0.2, 0.03);
  };

  const snare = (t: number, gain = 1) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
    src.connect(bp);
    bp.connect(g);
    g.connect(master);
    src.start(t, 0.4, 0.25);
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(200, t);
    body.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.28 * gain, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    body.connect(bg);
    bg.connect(master);
    body.start(t);
    body.stop(t + 0.12);
  };

  const hat = (t: number, open: boolean, gain = 1) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 8200;
    const g = ctx.createGain();
    const dur = open ? 0.14 : 0.035;
    g.gain.setValueAtTime((open ? 0.17 : 0.12) * gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(hp);
    hp.connect(g);
    g.connect(master);
    src.start(t, 0.6, dur + 0.02);
  };

  const bassNote = (t: number, freq: number, dur: number, gain = 1) => {
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = freq * 2;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.34 * gain, t + 0.015);
    g.gain.setValueAtTime(0.34 * gain, t + dur - 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    saw.connect(lp);
    sub.connect(g);
    lp.connect(g);
    g.connect(master);
    saw.start(t);
    saw.stop(t + dur + 0.02);
    sub.start(t);
    sub.stop(t + dur + 0.02);
  };

  // arp bus with feedback delay
  const arpBus = ctx.createGain();
  arpBus.gain.value = 1;
  const arpLp = ctx.createBiquadFilter();
  arpLp.type = 'lowpass';
  arpLp.frequency.value = 4200;
  const delay = ctx.createDelay(1);
  delay.delayTime.value = BEAT * 0.75;
  const fb = ctx.createGain();
  fb.gain.value = 0.34;
  const wet = ctx.createGain();
  wet.gain.value = 0.3;
  arpBus.connect(arpLp);
  arpLp.connect(master);
  arpLp.connect(delay);
  delay.connect(fb);
  fb.connect(delay);
  delay.connect(wet);
  wet.connect(master);

  const pluck = (t: number, freq: number, gain = 1) => {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = freq * 1.005;
    const og2 = ctx.createGain();
    og2.gain.value = 0.25;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.2 * gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(g);
    osc2.connect(og2);
    og2.connect(g);
    g.connect(arpBus);
    osc.start(t);
    osc.stop(t + 0.2);
    osc2.start(t);
    osc2.stop(t + 0.2);
  };

  const pad = (t: number, freqs: number[], dur: number) => {
    for (const f of freqs) {
      for (const det of [-4, 4]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = f;
        osc.detune.value = det;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 850;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.028, t + 0.5);
        g.gain.setValueAtTime(0.028, t + dur - 0.6);
        g.gain.linearRampToValueAtTime(0, t + dur);
        osc.connect(lp);
        lp.connect(g);
        g.connect(master);
        osc.start(t);
        osc.stop(t + dur + 0.05);
      }
    }
  };

  for (let bar = 0; bar < BARS; bar++) {
    const barT = bar * 4 * BEAT;
    const chord = CHORDS[bar % 4];
    const full = bar >= 1; // bar 0 is a sparser intro so the drop lands

    pad(barT, chord.pad, 4 * BEAT);

    for (let b = 0; b < 4; b++) {
      const t = barT + b * BEAT;
      kick(t, b === 0 ? 1 : 0.92);
      if (full && (b === 1 || b === 3)) snare(t);
      // bass: root on the beat, octave push on the off-beat
      bassNote(t, chord.bass, BEAT * 0.48);
      if (full) bassNote(t + BEAT * 0.5, chord.bass * (b === 3 ? 1.5 : 2), BEAT * 0.24, 0.7);
      // hats on 16ths
      for (let s = 0; s < 4; s++) {
        if (!full && s % 2 === 1) continue;
        const open = b === 3 && s === 2 && bar % 2 === 1;
        hat(t + (s * BEAT) / 4, open, s === 2 ? 1 : 0.65);
      }
      // arp: chord tones on 16ths, skipping some steps for groove
      if (full) {
        const pattern = [0, 2, 1, 3, 0, 3, 2, 1];
        for (let s = 0; s < 2; s++) {
          const step = (b * 2 + s) % pattern.length;
          if (bar % 4 === 3 && b === 3 && s === 1) continue;
          const tone = chord.tones[pattern[step]];
          pluck(t + s * BEAT * 0.5, tone * (step % 3 === 2 ? 2 : 1), bar >= 4 ? 1 : 0.75);
        }
      }
    }
  }

  return ctx.startRendering();
}

export const DEMO_TRACK_NAME = 'Midnight Circuit (built-in)';
