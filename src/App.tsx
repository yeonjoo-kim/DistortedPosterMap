import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Laptop, Plus, Volume2, VolumeX } from 'lucide-react';
import { loadPoster } from './lib/extract';
import { exportMap, exportPoster } from './lib/export';
import { PosterPhysics } from './lib/physics';
import { BODY_CONNECTIONS } from './lib/bodyMotion';
import { DEFAULT_SETTINGS } from './lib/types';
import type { PosterAsset, Settings, Telemetry } from './lib/types';
import { useMotionInstrument } from './useMotionInstrument';

const empty: Telemetry = {
  elements: [],
  energy: 0,
  active: false,
  impact: 0,
  deformation: 0,
};

export default function App() {
  const [asset, setAsset] = useState<PosterAsset | null>(null);
  const [name, setName] = useState('poster');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [about, setAbout] = useState(false);
  const [cameraPrompt, setCameraPrompt] = useState(false);
  const promptRef = useRef<HTMLDivElement>(null);
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const [telemetry, setTelemetry] = useState(empty);
  const [menu, setMenu] = useState<'motion' | 'download' | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 12, top: 12 });
  const menuRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const wordmarkRef = useRef<HTMLSpanElement>(null);
  const aboutRef = useRef<HTMLButtonElement>(null);
  const controlsRef = useRef<HTMLElement>(null);
  const controlHovered = useRef(false);
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  const engineRef = useRef<PosterPhysics | null>(null);
  const settingsRef = useRef(settings);
  const loadId = useRef(0);
  settingsRef.current = settings;
  const input = useMotionInstrument(engineRef, settingsRef, setNotice);
  const { driveSound, impactSound } = input;
  const background = asset?.color ?? '#f6ffbd';
  const rgb = background.match(/[\d.]+/g)?.map(Number) ?? [246, 255, 189];
  const dark =
    rgb.length >= 3 && rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 < 135;

  useEffect(() => {
    document.documentElement.style.backgroundColor = background;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', background);
  }, [background]);

  useEffect(() => {
    if (input.status.state === 'connected') setCameraPrompt(false);
  }, [input.status.state]);

  useEffect(() => {
    if (!cameraPrompt) return;
    promptRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        input.stopInput();
        setCameraPrompt(false);
      }
      if (event.key === 'Tab') {
        const items = [
          ...(promptRef.current?.querySelectorAll<HTMLButtonElement>(
            'button:not(:disabled)',
          ) ?? []),
        ];
        const current = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        items[
          (current + (event.shiftKey ? -1 : 1) + items.length) % items.length
        ]?.focus();
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [cameraPrompt, input.stopInput]);

  useEffect(() => {
    if (!asset || !canvasRef.current) return;
    const engine = new PosterPhysics(asset, settingsRef.current);
    engineRef.current = engine;
    engine.onImpact = impactSound;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    let projection = { left: 0, top: 0, scale: 1, ratio: 1 };
    const layout = () => {
      const paper = paperRef.current!.getBoundingClientRect();
      const ratio = Math.min(devicePixelRatio || 1, 2);
      const scale = paper.width / asset.width;
      projection = { left: paper.left, top: paper.top, scale, ratio };
      canvas.width = innerWidth * ratio;
      canvas.height = innerHeight * ratio;
      engine.setBounds({
        x: -paper.left / scale,
        y: -paper.top / scale,
        width: innerWidth / scale,
        height: innerHeight / scale,
      });
      const nodes = [
        wordmarkRef.current,
        aboutRef.current,
        controlsRef.current,
      ];
      engine.setFixtures(
        nodes.flatMap((node, i) => {
          if (!node) return [];
          node.style.transform = '';
          const box = node.getBoundingClientRect();
          return [
            {
              id: ['wordmark', 'about', 'adjust-box'][i],
              x: (box.left + box.width / 2 - paper.left) / scale,
              y: (box.top + box.height / 2 - paper.top) / scale,
              width: box.width / scale,
              height: box.height / scale,
            },
          ];
        }),
      );
    };
    layout();
    window.addEventListener('resize', layout);
    let frame = 0,
      last = performance.now(),
      lastUi = 0;
    const render = (now: number) => {
      engine.settings = settingsRef.current;
      engine.update(now - last);
      last = now;
      const { left, top, scale, ratio } = projection;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(
        ratio * scale,
        0,
        0,
        ratio * scale,
        left * ratio,
        top * ratio,
      );
      engine.render(ctx);
      [wordmarkRef.current, aboutRef.current, controlsRef.current].forEach(
        (node, i) => {
          const fixture = engine.fixtures[i];
          if (node && fixture)
            node.style.transform = `translate(${(fixture.body.position.x - fixture.origin.x) * scale}px, ${(fixture.body.position.y - fixture.origin.y) * scale}px) rotate(${fixture.body.angle}rad)`;
        },
      );
      driveSound(engine.energy);
      if (now - lastUi > 110) {
        setTelemetry(engine.telemetry());
        lastUi = now;
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', layout);
      [wordmarkRef.current, aboutRef.current, controlsRef.current].forEach(
        (node) => {
          if (node) node.style.transform = '';
        },
      );
      engine.dispose();
      engineRef.current = null;
    };
  }, [asset, driveSound, impactSound]);

  useEffect(() => {
    engineRef.current?.pinFixture(
      'adjust-box',
      !!menu || controlHovered.current,
    );
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !controlsRef.current?.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      )
        setMenu(null);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(null);
        menuTrigger.current?.focus();
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const items = [
          ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
            '[role="menuitem"]',
          ) ?? []),
        ];
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        items[
          (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) %
            items.length
        ]?.focus();
        event.preventDefault();
      }
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', keyboard);
    };
  }, [menu]);

  useEffect(() => {
    if (!about) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAbout(false);
        aboutRef.current?.focus();
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        document
          .querySelector<HTMLButtonElement>('.about-dialog button')
          ?.focus();
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [about]);

  async function upload(file?: File) {
    if (!file) return;
    const id = ++loadId.current;
    setLoading(true);
    setNotice('');
    setMenu(null);
    setCameraPrompt(false);
    setAbout(false);
    input.stopInput();
    try {
      const next = await loadPoster(file, 'normal');
      if (id !== loadId.current) return;
      setTelemetry(empty);
      setAsset(next);
      setCameraPrompt(true);
      setName(file.name);
    } catch (error) {
      if (id === loadId.current)
        setNotice(
          error instanceof Error ? error.message : '포스터를 열지 못했습니다.',
        );
    } finally {
      if (id === loadId.current) setLoading(false);
    }
  }

  async function download(format: 'png' | 'jpg' | 'pdf' | 'json') {
    const engine = engineRef.current;
    if (!engine) return;
    setMenu(null);
    setSaving(true);
    setNotice('');
    try {
      if (format === 'json') exportMap(engine, name);
      else await exportPoster(engine, format, name, settings.showPaths, 2);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '저장에 실패했습니다.',
      );
    } finally {
      setSaving(false);
    }
  }

  const area =
    telemetry.elements.reduce((sum, e) => sum + e.areaWeight, 0) || 1;
  const values = ['x', 'y', 'dx', 'dy'].map(
    (key) =>
      telemetry.elements.reduce(
        (sum, e) => sum + e[key as 'x' | 'y' | 'dx' | 'dy'] * e.areaWeight,
        0,
      ) / area,
  );
  const connected = input.status.state === 'connected';
  const sourceLabel = input.source === 'camera' ? '몸동작 감지' : '가속도 센서';
  const toggleMenu = (
    next: 'motion' | 'download',
    trigger: HTMLButtonElement,
  ) => {
    menuTrigger.current = trigger;
    const box = trigger.getBoundingClientRect();
    setMenuPosition({
      left: Math.max(12, Math.min(innerWidth - 272, box.right - 260)),
      top: Math.max(12, Math.min(innerHeight - 380, box.top - 300)),
    });
    setMenu(menu === next ? null : next);
  };

  return (
    <main
      className={`studio ${asset ? 'has-poster' : 'is-empty'} ${dark ? 'dark-poster' : ''} ${telemetry.active ? 'is-distorting' : ''}`}
      style={
        {
          '--poster-background': background,
          '--active-font': telemetry.active
            ? 'MetaAccanthisAlternate'
            : 'MetaAccanthis',
          '--poster-ink': dark ? '#f8f8f0' : '#14170f',
        } as CSSProperties
      }
    >
      <span ref={wordmarkRef} className="wordmark">
        Poster Distorting Map
      </span>
      <button
        ref={aboutRef}
        className="about-button"
        aria-label="About"
        onClick={() => setAbout(true)}
      >
        About
      </button>
      {asset && (
        <canvas
          ref={canvasRef}
          className="poster-canvas"
          aria-label="왜곡되는 포스터"
        />
      )}
      <input
        ref={fileRef}
        className="file-input"
        type="file"
        accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
        aria-label="포스터 파일 선택"
        onChange={(event) => {
          void upload(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <section className="poster-stage" aria-label="포스터">
        <div
          ref={paperRef}
          className={`paper ${dragging ? 'is-dragging' : ''}`}
          style={
            {
              '--poster-ratio': asset ? asset.width / asset.height : 534 / 756,
            } as CSSProperties
          }
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void upload(event.dataTransfer.files[0]);
          }}
          aria-busy={loading}
        >
          <button
            className={`upload-button ${asset ? 'replace-upload' : ''}`}
            aria-label="포스터 올리기"
            title="포스터 올리기 · PDF / JPG / PNG"
            disabled={loading}
            onClick={() => fileRef.current?.click()}
          >
            <Plus aria-hidden="true" size={68} strokeWidth={1} />
          </button>
          {loading && (
            <span className="loading-indicator" role="status">
              포스터를 여는 중…
            </span>
          )}
        </div>
      </section>
      {asset && (
        <aside
          className="controls"
          ref={controlsRef}
          aria-label="포스터 컨트롤"
          onPointerEnter={() => {
            controlHovered.current = true;
            engineRef.current?.pinFixture('adjust-box', true);
          }}
          onPointerLeave={() => {
            controlHovered.current = false;
            if (!menu) engineRef.current?.pinFixture('adjust-box', false);
          }}
        >
          <div
            className={`motion-preview ${connected ? 'connected' : ''}`}
            data-testid="motion-status"
            data-state={input.status.state}
          >
            <video
              ref={input.videoRef}
              autoPlay
              muted
              playsInline
              className={input.source === 'camera' ? 'camera-visible' : ''}
              aria-label="움직임 감지용 카메라 미리보기"
            />
            {input.source === 'camera' && input.sample?.landmarks?.length ? (
              <svg
                className="body-overlay"
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                aria-label="인식된 몸동작"
              >
                {BODY_CONNECTIONS.map(([a, b]) => {
                  const first = input.sample?.landmarks?.[a],
                    second = input.sample?.landmarks?.[b];
                  return first &&
                    second &&
                    (first.visibility ?? 1) >= 0.55 &&
                    (second.visibility ?? 1) >= 0.55 ? (
                    <line
                      key={`${a}-${b}`}
                      x1={first.x}
                      y1={first.y}
                      x2={second.x}
                      y2={second.y}
                    />
                  ) : null;
                })}
              </svg>
            ) : null}
            <div className="motion-status" role="status">
              <span>{input.source ? sourceLabel : '움직임 감지'}</span>
              <span>
                {connected
                  ? `${Math.round((input.sample?.strength ?? 0) * 100)}%`
                  : input.status.state === 'idle'
                    ? 'OFF'
                    : input.status.state === 'requesting'
                      ? '연결 중…'
                      : '연결 확인'}
              </span>
            </div>
            {connected && (
              <div
                className="motion-meter"
                style={{
                  width: `${Math.max(1, (input.sample?.strength ?? 0) * 100)}%`,
                }}
              />
            )}
          </div>
          <div className="mapping-panel">
            <button
              className="mapping-toggle"
              aria-label="움직임 시각화"
              aria-pressed={settings.showPaths}
              title="포스터 전체의 면적 가중 중심 좌표(px). 클릭하여 이동 경로와 좌표를 표시합니다."
              onClick={() =>
                setSettings((s) => ({
                  ...s,
                  showPaths: !s.showPaths,
                  showLabels: !s.showPaths,
                }))
              }
            >
              <span className="mapping-caption">
                움직임 시각화 <span>{settings.showPaths ? 'ON' : 'OFF'}</span>
              </span>
              <span className="coordinate-grid">
                {['Position X', 'Position Y', 'Offset X', 'Offset Y'].map(
                  (label, i) => (
                    <span className="coordinate" key={label}>
                      <span>{label}</span>
                      <output>{values[i].toFixed(0).padStart(3, '0')}</output>
                    </span>
                  ),
                )}
              </span>
            </button>
            <div className="control-row">
              <button
                className="download-button"
                aria-label="다운로드"
                aria-expanded={menu === 'download'}
                aria-haspopup="menu"
                disabled={saving}
                onClick={(event) => toggleMenu('download', event.currentTarget)}
              >
                {saving ? 'Saving…' : 'Download'}
              </button>
              <button
                className={`icon-button ${connected ? 'is-active' : ''}`}
                aria-label="움직임 감지"
                title="움직임 감지"
                aria-expanded={menu === 'motion'}
                aria-haspopup="menu"
                onClick={(event) => toggleMenu('motion', event.currentTarget)}
              >
                <Laptop aria-hidden="true" size={33} strokeWidth={1.4} />
              </button>
              <button
                className="icon-button"
                aria-label="연주 소리"
                title={`연주 소리 ${input.sound === 'running' ? '끄기' : '켜기'}`}
                aria-pressed={input.sound === 'running'}
                onClick={input.toggleSound}
              >
                {input.sound === 'running' ? (
                  <Volume2 aria-hidden="true" size={30} strokeWidth={1.4} />
                ) : (
                  <VolumeX aria-hidden="true" size={30} strokeWidth={1.4} />
                )}
              </button>
            </div>
            {menu &&
              createPortal(
                <div
                  ref={menuRef}
                  className="floating-menu"
                  style={
                    {
                      ...menuPosition,
                      '--active-font': telemetry.active
                        ? 'MetaAccanthisAlternate'
                        : 'MetaAccanthis',
                    } as CSSProperties
                  }
                >
                  {' '}
                  {menu === 'download' && (
                    <div
                      className="popover download-menu"
                      role="menu"
                      aria-label="다운로드 형식"
                    >
                      {(['png', 'jpg', 'pdf', 'json'] as const).map(
                        (format) => (
                          <button
                            role="menuitem"
                            key={format}
                            onClick={() => void download(format)}
                          >
                            {format === 'json'
                              ? '좌표 · 경로 JSON'
                              : format.toUpperCase()}
                          </button>
                        ),
                      )}
                    </div>
                  )}
                  {menu === 'motion' && (
                    <div
                      className="popover motion-menu"
                      role="menu"
                      aria-label="움직임 감지 방식"
                    >
                      <p>
                        카메라를 고정하고 어깨와 팔이 보이도록 춤춰 주세요.
                        몸동작의 크기로 소리와 파괴가 달라집니다.
                      </p>
                      <button
                        role="menuitem"
                        onClick={() => input.startInput('camera')}
                      >
                        카메라로 움직임 감지
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => input.startInput('sensor')}
                      >
                        가속도 센서 확인
                      </button>
                      {input.source && (
                        <button role="menuitem" onClick={input.stopInput}>
                          움직임 감지 중지
                        </button>
                      )}
                      <p className="connection-detail" aria-live="polite">
                        {input.status.message}
                      </p>
                      {input.source === 'camera' && (
                        <p>
                          사람의 관절 움직임을 기기 안에서만 분석합니다. 영상은
                          저장하거나 전송하지 않습니다.
                        </p>
                      )}
                    </div>
                  )}
                </div>,
                document.body,
              )}
          </div>
        </aside>
      )}
      {cameraPrompt && (
        <div className="about-backdrop camera-backdrop">
          <div
            ref={promptRef}
            className="camera-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="camera-title"
            aria-describedby="camera-description"
          >
            <span className="dialog-eyebrow">READY TO DISTORT</span>
            <h1 id="camera-title">춤·몸동작 감지를 켭니다</h1>
            <p id="camera-description">
              카메라를 고정하고 어깨와 팔, 가능하면 전신이 보이도록 서 주세요.
              몸동작이 클수록 헤비메탈 기타 소리와 포스터 파괴가 강해집니다.
            </p>
            <p>
              카메라 영상은 기기 안에서만 분석하며 저장·전송하지 않습니다.
              마이크는 사용하지 않습니다.
            </p>
            {input.source === 'camera' && (
              <p className="camera-connection" role="status">
                {input.status.message}
              </p>
            )}
            <div className="dialog-actions">
              <button
                onClick={() => input.startInput('camera')}
                disabled={
                  input.source === 'camera' &&
                  input.status.state === 'requesting'
                }
              >
                {input.source === 'camera' &&
                input.status.state === 'requesting'
                  ? '카메라 연결 중…'
                  : '카메라 감지 시작'}
              </button>
              <button
                onClick={() => {
                  input.stopInput();
                  setCameraPrompt(false);
                }}
              >
                나중에
              </button>
            </div>
          </div>
        </div>
      )}
      {about && (
        <div className="about-backdrop" onClick={() => setAbout(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="About"
            className="about-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              autoFocus
              aria-label="About 닫기"
              onClick={() => setAbout(false)}
            >
              ×
            </button>
            <p>Poster Distorting Map</p>
            <p>
              포스터를 올리고 카메라 앞에서 몸동작으로 연주하세요. 작은 흔들림은
              부드럽게, 큰 흔들림은 조각으로 남습니다.
            </p>
            <p>파일과 카메라 영상은 기기 안에서만 처리됩니다.</p>
          </div>
        </div>
      )}
      {notice && (
        <div className="notice" role="alert">
          <span>{notice}</span>
          <button aria-label="알림 닫기" onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      )}
    </main>
  );
}
