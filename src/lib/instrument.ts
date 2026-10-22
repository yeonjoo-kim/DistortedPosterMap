import { clamp, shakeImpulse } from './math';

// E minor power chords: low E, G, A, B, D and the octave.
const RIFF = [40, 43, 45, 47, 50, 52];
export function soundProfile(amplitude: number) {
  const strength = shakeImpulse(amplitude);
  return {
    strength,
    midi: RIFF[Math.min(RIFF.length - 1, Math.floor(strength * RIFF.length))],
    cutoff: 300 + strength ** 2 * 6500,
    drive: 8 + strength * 28,
    pickInterval: 0.31 - strength * 0.22,
    sustain: 0.11 + strength * 0.32,
    gain: strength ** 0.75 * 0.34,
  };
}

export function distortionCurve(amount: number) {
  return Float32Array.from({ length: 2048 }, (_, i) =>
    Math.tanh(((i * 2) / 2047 - 1) * amount),
  );
}

/** Plucked strings -> high-gain amp -> cabinet -> limiter. Entirely local. */
export class PosterInstrument {
  context: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  enabled = true;
  private master: GainNode | null = null;
  private cabinet: BiquadFilterNode | null = null;
  private preamp: GainNode | null = null;
  private strings = new Map<number, AudioBuffer>();
  private voices = new Set<AudioBufferSourceNode>();
  private lastPick = -1;
  private lastImpact = -1;
  private previousStrength = 0;

  async start() {
    if (!this.context || this.context.state === 'closed') {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.context = ctx;
      const master = ctx.createGain();
      master.gain.value = 0;
      this.master = master;
      const preamp = ctx.createGain();
      preamp.gain.value = 8;
      this.preamp = preamp;
      const amp = ctx.createWaveShaper();
      amp.curve = distortionCurve(3);
      amp.oversample = '4x';
      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 65;
      const body = ctx.createBiquadFilter();
      body.type = 'lowshelf';
      body.frequency.value = 180;
      body.gain.value = 5;
      const mids = ctx.createBiquadFilter();
      mids.type = 'peaking';
      mids.frequency.value = 850;
      mids.Q.value = 0.7;
      mids.gain.value = -4;
      const cabinet = ctx.createBiquadFilter();
      cabinet.type = 'lowpass';
      cabinet.frequency.value = 900;
      cabinet.Q.value = 0.75;
      this.cabinet = cabinet;
      preamp.connect(amp);
      amp.connect(highpass);
      highpass.connect(body);
      body.connect(mids);
      mids.connect(cabinet);
      cabinet.connect(master);
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -14;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.1;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      this.analyser = analyser;
      master.connect(limiter);
      limiter.connect(analyser);
      analyser.connect(ctx.destination);
    }
    if (this.context.state !== 'running') await this.context.resume();
    if (this.context.state !== 'running')
      throw new Error('소리를 시작하려면 소리 버튼을 눌러 주세요.');
    this.enabled = true;
  }

  private string(midi: number) {
    const cached = this.strings.get(midi);
    if (cached) return cached;
    const ctx = this.context!;
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    const length = Math.round(ctx.sampleRate / frequency);
    const ring = Float32Array.from({ length }, () => Math.random() * 2 - 1);
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 1.8, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const index = i % length;
      data[i] = ring[index];
      ring[index] = (ring[index] + ring[(index + 1) % length]) * 0.498;
    }
    this.strings.set(midi, buffer);
    return buffer;
  }

  private pick(strength: number, accent = false) {
    const ctx = this.context;
    if (!ctx || !this.preamp || this.voices.size >= 30) return;
    const profile = soundProfile(strength),
      now = ctx.currentTime;
    this.lastPick = now;
    for (const [index, interval] of [0, 7, 12].entries()) {
      const voice = ctx.createBufferSource();
      voice.buffer = this.string(profile.midi + interval);
      voice.detune.value = index === 1 ? -5 : index === 2 ? 5 : 0;
      const envelope = ctx.createGain();
      const start = now + index * 0.003;
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(
        (accent ? 0.35 : 0.25) / (1 + index * 0.35),
        start + 0.003,
      );
      envelope.gain.exponentialRampToValueAtTime(
        0.0001,
        start + profile.sustain,
      );
      voice.connect(envelope);
      envelope.connect(this.preamp);
      this.voices.add(voice);
      voice.start(start);
      voice.stop(start + profile.sustain + 0.02);
      voice.onended = () => {
        voice.disconnect();
        envelope.disconnect();
        this.voices.delete(voice);
      };
    }
  }

  drive(amplitude: number) {
    if (!this.context || this.context.state !== 'running' || !this.master)
      return;
    const profile = soundProfile(this.enabled ? amplitude : 0),
      now = this.context.currentTime;
    this.master.gain.setTargetAtTime(profile.gain, now, 0.025);
    this.cabinet?.frequency.setTargetAtTime(profile.cutoff, now, 0.025);
    this.preamp?.gain.setTargetAtTime(profile.drive, now, 0.025);
    if (
      profile.strength > 0.025 &&
      (now - this.lastPick > profile.pickInterval ||
        profile.strength - this.previousStrength > 0.16)
    )
      this.pick(profile.strength);
    this.previousStrength = profile.strength;
  }

  impact(amplitude: number) {
    const ctx = this.context;
    if (
      !this.enabled ||
      !ctx ||
      ctx.state !== 'running' ||
      amplitude < 0.12 ||
      ctx.currentTime - this.lastImpact < 0.11
    )
      return;
    this.lastImpact = ctx.currentTime;
    this.pick(clamp(amplitude, 0, 1), true);
  }

  mute(value: boolean) {
    this.enabled = !value;
    if (value) this.silence();
  }
  silence() {
    if (this.context && this.master) {
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(0, now, 0.012);
    }
    for (const voice of this.voices) {
      try {
        voice.stop();
      } catch {
        /* Already stopped. */
      }
    }
    this.voices.clear();
    this.previousStrength = 0;
  }
  dispose() {
    this.silence();
    void this.context?.close();
    this.context = null;
    this.analyser = null;
    this.strings.clear();
  }
}
