import { clamp, shakeImpulse } from './math';

export function soundProfile(amplitude: number) {
  const strength = shakeImpulse(amplitude);
  return {
    strength,
    frequency: 105 + Math.sqrt(strength) * 195,
    cutoff: 290 + strength ** 2 * 7100,
    harmonics: strength ** 2.5 * 0.42,
    noise: strength ** 3 * 0.1,
    gain: strength ** 0.8 * 0.3,
  };
}

/** A local synthesizer. No audio files, microphone, or network requests. */
export class PosterInstrument {
  context: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  enabled = true;
  private master: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private sine: OscillatorNode | null = null;
  private overtone: OscillatorNode | null = null;
  private overtoneGain: GainNode | null = null;
  private noiseGain: GainNode | null = null;
  private lastImpact = -1;

  async start() {
    if (!this.context || this.context.state === 'closed') {
      const context = new AudioContext({ latencyHint: 'interactive' });
      this.context = context;
      const master = context.createGain();
      master.gain.value = 0;
      this.master = master;
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -16;
      limiter.knee.value = 15;
      limiter.ratio.value = 10;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.18;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      this.analyser = analyser;
      master.connect(limiter);
      limiter.connect(analyser);
      analyser.connect(context.destination);
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 300;
      filter.Q.value = 0.65;
      filter.connect(master);
      this.filter = filter;
      const sine = context.createOscillator();
      sine.type = 'sine';
      sine.frequency.value = 105;
      sine.connect(filter);
      sine.start();
      this.sine = sine;
      const overtone = context.createOscillator();
      overtone.type = 'sawtooth';
      overtone.frequency.value = 210;
      const overtoneGain = context.createGain();
      overtoneGain.gain.value = 0;
      overtone.connect(overtoneGain);
      overtoneGain.connect(filter);
      overtone.start();
      this.overtone = overtone;
      this.overtoneGain = overtoneGain;
      const buffer = context.createBuffer(
        1,
        context.sampleRate * 2,
        context.sampleRate,
      );
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const noise = context.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      const noiseGain = context.createGain();
      noiseGain.gain.value = 0;
      noise.connect(noiseGain);
      noiseGain.connect(filter);
      noise.start();
      this.noiseGain = noiseGain;
    }
    if (this.context.state !== 'running') await this.context.resume();
    if (this.context.state !== 'running')
      throw new Error(
        '소리를 시작하려면 브라우저에서 연주 시작 버튼을 눌러 주세요.',
      );
    this.enabled = true;
  }

  drive(amplitude: number) {
    if (
      !this.context ||
      this.context.state !== 'running' ||
      !this.master ||
      !this.filter
    )
      return;
    const profile = soundProfile(this.enabled ? amplitude : 0),
      now = this.context.currentTime;
    this.master.gain.setTargetAtTime(profile.gain, now, 0.045);
    this.filter.frequency.setTargetAtTime(profile.cutoff, now, 0.04);
    this.sine?.frequency.setTargetAtTime(profile.frequency, now, 0.06);
    this.overtone?.frequency.setTargetAtTime(
      profile.frequency * (2 + profile.strength * 1.5),
      now,
      0.035,
    );
    this.overtoneGain?.gain.setTargetAtTime(profile.harmonics, now, 0.04);
    this.noiseGain?.gain.setTargetAtTime(profile.noise, now, 0.04);
  }

  impact(amplitude: number) {
    const ctx = this.context;
    if (
      !this.enabled ||
      !ctx ||
      ctx.state !== 'running' ||
      !this.master ||
      amplitude < 0.07 ||
      ctx.currentTime - this.lastImpact < 0.065
    )
      return;
    const strength = clamp(amplitude, 0, 1),
      now = ctx.currentTime;
    this.lastImpact = now;
    const voice = ctx.createOscillator(),
      envelope = ctx.createGain(),
      filter = ctx.createBiquadFilter();
    voice.type = strength > 0.6 ? 'sawtooth' : 'sine';
    voice.frequency.setValueAtTime(130 + strength ** 2 * 2500, now);
    voice.frequency.exponentialRampToValueAtTime(
      90 + strength * 480,
      now + 0.12,
    );
    filter.type = 'lowpass';
    filter.frequency.value = 400 + strength ** 2 * 6500;
    const duration = 0.4 - strength * 0.22;
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(0.09 + strength * 0.18, now + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    voice.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.master);
    voice.start(now);
    voice.stop(now + duration + 0.02);
    voice.onended = () => {
      voice.disconnect();
      filter.disconnect();
      envelope.disconnect();
    };
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
  }
  dispose() {
    this.silence();
    void this.context?.close();
    this.context = null;
    this.analyser = null;
  }
}
