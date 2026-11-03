import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { PosterInstrument } from './lib/instrument';
import { startDeviceMotion } from './lib/motion';
import type { InputStatus, MotionSample } from './lib/motion';
import { startCameraMotion } from './lib/vision';
import { startBodyCamera } from './lib/bodyCamera';
import type { PosterPhysics } from './lib/physics';
import type { Settings } from './lib/types';

export function useMotionInstrument(
  engine: RefObject<PosterPhysics | null>,
  settings: RefObject<Settings>,
  notice: (message: string) => void,
) {
  const [source, setSource] = useState<'sensor' | 'camera' | 'body' | null>(
    null,
  );
  const [status, setStatus] = useState<InputStatus>({
    state: 'idle',
    message: 'Choose body nodes or a device motion sensor.',
  });
  const [sample, setSample] = useState<MotionSample | null>(null);
  const [sound, setSound] = useState<
    'locked' | 'running' | 'muted' | 'unavailable'
  >('locked');
  const videoRef = useRef<HTMLVideoElement>(null);
  const audio = useRef(new PosterInstrument());
  const controller = useRef<AbortController | null>(null);
  const lastUi = useRef(0);
  const startingMotion = useRef(0);
  const performing = useRef(false);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const noticeRef = useRef(notice);
  noticeRef.current = notice;

  const unlockSound = useCallback(async () => {
    try {
      await audio.current.start();
      setSound('running');
    } catch {
      setSound('unavailable');
      noticeRef.current(
        'Sound could not start. Check your browser sound settings.',
      );
    }
  }, []);

  const receive = useCallback(
    (raw: MotionSample) => {
      const value =
        raw.strength < 0.08
          ? { ...raw, strength: 0, direction: { x: 0, y: 0 } }
          : raw;
      performing.current = value.confidence > 0;
      // Require sustained measured movement before releasing the initial poster.
      if (!engine.current?.active && value.source === 'body') {
        startingMotion.current = value.strength >= 0.12 && value.confidence > 0 ? startingMotion.current + 1 : 0;
      }
      if (!settings.current.paused && !settings.current.original &&
        (engine.current?.active || value.source !== 'body' || startingMotion.current >= 2))
        engine.current?.applyMotion(value);
      const now = performance.now();
      if (now - lastUi.current > 95 || value.source === 'test') {
        lastUi.current = now;
        setSample(value);
      }
    },
    [engine, settings],
  );

  const stopInput = useCallback(() => {
    performing.current = false;
    controller.current?.abort();
    controller.current = null;
    setSource(null);
    setSample(null);
    setStatus({
      state: 'idle',
      message: 'Tracking stopped. The camera has been released.',
    });
    audio.current.silence();
  }, []);

  const startInput = useCallback(
    (next: 'sensor' | 'camera' | 'body') => {
      controller.current?.abort();
      performing.current = false;
      audio.current.silence();
      const control = new AbortController();
      controller.current = control;
      setSource(next);
      setSample(null);
      startingMotion.current = 0;
      if (soundRef.current !== 'muted') void unlockSound();
      const onStatus = (value: InputStatus) => {
        if (!control.signal.aborted) {
          setStatus(value);
          if (['unavailable', 'denied', 'stale'].includes(value.state)) {
            performing.current = false;
            setSample(null);
            audio.current.silence();
          }
        }
      };
      const onSample = (value: MotionSample) => {
        if (!control.signal.aborted) receive(value);
      };
      if (next === 'sensor')
        void startDeviceMotion(onSample, onStatus, control.signal);
      else if (videoRef.current)
        void (next === 'body' ? startBodyCamera : startCameraMotion)(
          videoRef.current,
          onSample,
          onStatus,
          control.signal,
        );
    },
    [receive, unlockSound],
  );

  const toggleSound = useCallback(() => {
    if (soundRef.current === 'running') {
      audio.current.mute(true);
      setSound('muted');
    } else {
      void unlockSound();
    }
  }, [unlockSound]);

  const driveSound = useCallback(
    (strength: number) => {
      audio.current.drive(
        !performing.current ||
          document.hidden ||
          settings.current.paused ||
          settings.current.original
          ? 0
          : strength,
      );
    },
    [settings],
  );
  const impactSound = useCallback(
    (strength: number) => {
      if (
        performing.current &&
        !settings.current.paused &&
        !settings.current.original
      )
        audio.current.impact(strength);
    },
    [settings],
  );

  useEffect(() => {
    const visibility = () => {
      if (document.hidden) stopInput();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      controller.current?.abort();
      audio.current.dispose();
    };
  }, [stopInput]);

  return {
    source,
    status,
    sample,
    sound,
    videoRef,
    startInput,
    stopInput,
    toggleSound,
    driveSound,
    impactSound,
  };
}
