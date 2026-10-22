import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { PosterInstrument } from './lib/instrument';
import { startDeviceMotion } from './lib/motion';
import type { InputStatus, MotionSample } from './lib/motion';
import { startBodyCamera } from './lib/poseCamera';
import type { PosterPhysics } from './lib/physics';
import type { Settings } from './lib/types';

export function useMotionInstrument(
  engine: RefObject<PosterPhysics | null>,
  settings: RefObject<Settings>,
  notice: (message: string) => void,
) {
  const [source, setSource] = useState<'sensor' | 'camera' | null>(null);
  const [status, setStatus] = useState<InputStatus>({
    state: 'idle',
    message: '카메라 앞에서 몸을 움직여 연주하세요.',
  });
  const [sample, setSample] = useState<MotionSample | null>(null);
  const [sound, setSound] = useState<
    'locked' | 'running' | 'muted' | 'unavailable'
  >('locked');
  const videoRef = useRef<HTMLVideoElement>(null);
  const audio = useRef(new PosterInstrument());
  const controller = useRef<AbortController | null>(null);
  const lastUi = useRef(0);
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
        '소리를 시작하지 못했습니다. 브라우저의 사이트 소리 설정을 확인해 주세요.',
      );
    }
  }, []);

  const receive = useCallback(
    (value: MotionSample) => {
      performing.current = value.confidence > 0;
      if (!settings.current.paused && !settings.current.original)
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
      message: '움직임 감지를 멈췄습니다. 카메라도 해제되었습니다.',
    });
    audio.current.silence();
  }, []);

  const startInput = useCallback(
    (next: 'sensor' | 'camera') => {
      controller.current?.abort();
      performing.current = false;
      audio.current.silence();
      const control = new AbortController();
      controller.current = control;
      setSource(next);
      setSample(null);
      if (soundRef.current !== 'muted') void unlockSound();
      const onStatus = (value: InputStatus) => {
        if (!control.signal.aborted) {
          setStatus(value);
          if (['unavailable', 'denied', 'stale'].includes(value.state)) {
            performing.current = false;
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
        void startBodyCamera(
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
