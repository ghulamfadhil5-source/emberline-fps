// Synthesised sound: every effect is built from oscillators and filtered noise,
// so the game ships no audio files and makes no network request. The context is
// created lazily and resumed on the first user gesture (browsers block audio
// before one); in headless capture it simply stays silent.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.42;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function noise(dur, filterFreq, type, gain, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t, Math.random() * 0.2, dur);
    src.stop(t + dur);
  }

  function tone(freq, dur, type, gain, slideTo = 0, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur);
  }

  const WEAPON_SOUND = {
    pistol: { noise: 900, gain: 0.5, dur: 0.11, thump: 140 },
    rifle: { noise: 700, gain: 0.6, dur: 0.13, thump: 110 },
    smg: { noise: 1100, gain: 0.42, dur: 0.09, thump: 150 },
    shotgun: { noise: 420, gain: 0.85, dur: 0.22, thump: 80 },
    dmr: { noise: 550, gain: 0.8, dur: 0.28, thump: 70 },
  };

  return {
    unlock() {
      ensure();
    },
    shot(kind, distant = false) {
      const s = WEAPON_SOUND[kind] || WEAPON_SOUND.rifle;
      if (distant) {
        noise(s.dur, s.noise, 'lowpass', s.gain * 0.25);
        tone(s.thump, 0.09, 'sine', 0.12, 60);
      } else {
        noise(s.dur, s.noise, 'bandpass', s.gain);
        tone(s.thump, 0.1, 'sine', 0.5, 55);
        noise(0.05, 2600, 'highpass', 0.16);
      }
    },
    dryFire() {
      tone(1400, 0.03, 'square', 0.08);
    },
    reload() {
      tone(900, 0.04, 'square', 0.1);
      tone(600, 0.04, 'square', 0.1, 0, 0.25);
      tone(1100, 0.05, 'square', 0.12, 0, 0.6);
    },
    hit() {
      tone(2200, 0.05, 'square', 0.14);
    },
    kill() {
      tone(880, 0.07, 'square', 0.16);
      tone(1320, 0.09, 'square', 0.16, 0, 0.07);
    },
    hurt() {
      tone(220, 0.16, 'sawtooth', 0.22, 90);
      noise(0.12, 500, 'lowpass', 0.2);
    },
    explosion() {
      noise(0.9, 300, 'lowpass', 1.0);
      tone(70, 0.8, 'sine', 0.9, 28);
      noise(0.3, 3000, 'highpass', 0.3);
    },
    grenadePin() {
      tone(1800, 0.03, 'square', 0.1);
    },
    beep(final = false) {
      tone(final ? 1560 : 1040, 0.09, 'sine', 0.2);
    },
    plantDone() {
      tone(1040, 0.1, 'sine', 0.2);
      tone(1560, 0.14, 'sine', 0.2, 0, 0.12);
    },
    buy() {
      tone(660, 0.05, 'square', 0.12);
      tone(990, 0.07, 'square', 0.12, 0, 0.05);
    },
    denied() {
      tone(220, 0.12, 'square', 0.14, 160);
    },
    roundWin() {
      [523, 659, 784].forEach((f, i) => tone(f, 0.16, 'triangle', 0.2, 0, i * 0.11));
    },
    roundLose() {
      [392, 330, 262].forEach((f, i) => tone(f, 0.2, 'triangle', 0.2, 0, i * 0.13));
    },
    click() {
      tone(1200, 0.03, 'square', 0.08);
    },
  };
}
