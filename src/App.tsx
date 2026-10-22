import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Crosshair,
  Download,
  FileImage,
  FileJson,
  Fingerprint,
  Focus,
  Grip,
  ImagePlus,
  Layers3,
  LoaderCircle,
  MousePointer2,
  MoveUpRight,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ScanLine,
  Mic2,
  Camera,
  Volume2,
  VolumeX,
  Square,
  ShieldCheck,
  Split,
  Waves,
  X,
} from 'lucide-react';
import { createDemo } from './lib/demo';
import { loadPoster } from './lib/extract';
import { exportMap, exportPoster } from './lib/export';
import { PosterPhysics } from './lib/physics';
import { DEFAULT_SETTINGS } from './lib/types';
import type { Detail, Settings, Telemetry } from './lib/types';
import { useMotionInstrument } from './useMotionInstrument';

const fmt = (n: number, digits = 1) =>
  Number.isFinite(n) ? n.toFixed(digits) : '0.0';

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="toggle-row"
      onClick={onChange}
    >
      <span>
        {label}
        {description && <small>{description}</small>}
      </span>
      <span className={`switch ${checked ? 'on' : ''}`}>
        <span />
      </span>
    </button>
  );
}

export default function App() {
  const [asset, setAsset] = useState(createDemo);
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const [filename, setFilename] = useState('Nothing stays still');
  const [file, setFile] = useState<File | null>(null);
  const [detail, setDetail] = useState<Detail>('normal');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry>({
    elements: [],
    energy: 0,
    active: false,
    impact: 0,
    deformation: 0,
  });
  const [resetKey, setResetKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [format, setFormat] = useState<'png' | 'jpg' | 'pdf'>('png');
  const [exportOverlays, setExportOverlays] = useState(false);
  const [resolution, setResolution] = useState(2);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(100);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const engineRef = useRef<PosterPhysics | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const selectionRef = useRef(selected);
  selectionRef.current = selected;
  const loadId = useRef(0);
  const pauseBeforeExport = useRef(false);
  const pointer = useRef<{
    startX: number;
    startY: number;
    x: number;
    y: number;
    time: number;
    shakeAt: number;
    moved: boolean;
  } | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const input = useMotionInstrument(engineRef, settingsRef, setNotice);
  const { driveSound, impactSound, testMotion } = input;

  useEffect(() => {
    const engine = new PosterPhysics(asset, settingsRef.current);
    engineRef.current = engine;
    engine.onImpact = impactSound;
    setSelected(null);
    setTelemetry(engine.telemetry());
    const surface = canvasRef.current!;
    const ctx = surface.getContext('2d')!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    surface.width = asset.width * dpr;
    surface.height = asset.height * dpr;
    ctx.scale(dpr, dpr);
    let frame = 0,
      last = performance.now(),
      lastTelemetry = 0;
    const animate = (now: number) => {
      engine.settings = settingsRef.current;
      engine.update(now - last);
      last = now;
      engine.render(ctx);
      driveSound(engine.energy);
      if (now - lastTelemetry > 110) {
        setTelemetry(engine.telemetry());
        lastTelemetry = now;
        if (engine.selected !== selectionRef.current)
          setSelected(engine.selected);
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame);
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [asset, resetKey, driveSound, impactSound]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.selected = selected;
  }, [selected]);

  useEffect(() => {
    const stage = stageRef.current!,
      surface = canvasRef.current!;
    const resize = () => {
      const availableW = Math.max(120, stage.clientWidth - 96),
        availableH = Math.max(120, stage.clientHeight - 68);
      const scale = Math.min(
        availableW / asset.width,
        availableH / asset.height,
        1.5,
      );
      surface.style.width = `${asset.width * scale}px`;
      surface.style.height = `${asset.height * scale}px`;
      setZoom(Math.round(scale * 100));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();
    return () => observer.disconnect();
  }, [asset]);

  const shake = useCallback(() => testMotion(), [testMotion]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          'input, select, textarea, button, [role="dialog"]',
        ) ||
        exportOpen ||
        helpOpen
      )
        return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) shake();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [shake, exportOpen, helpOpen]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!exportOpen && !helpOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = modalRef.current;
    modal?.querySelector<HTMLButtonElement>('button')?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (exportOpen) closeExport();
        setHelpOpen(false);
      }
      if (e.key === 'Tab' && modal) {
        const focusables = Array.from(
          modal.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input, select, a[href]',
          ),
        );
        const first = focusables[0],
          last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', listener);
    return () => {
      window.removeEventListener('keydown', listener);
      previous?.focus();
    };
  }, [exportOpen, helpOpen]);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: value }));
  const reset = () => {
    setResetKey((v) => v + 1);
    setSettings((prev) => ({ ...prev, paused: false, original: false }));
  };

  const importFile = async (
    nextFile: File,
    nextDetail = detail,
    nextPage = 1,
  ) => {
    const id = ++loadId.current;
    setBusy(true);
    setError('');
    try {
      const loaded = await loadPoster(nextFile, nextDetail, nextPage);
      if (id !== loadId.current) return;
      setAsset(loaded);
      setFile(nextFile);
      setFilename(nextFile.name);
      setPage(nextPage);
      setSettings((prev) => ({ ...prev, original: false, paused: false }));
      if (!loaded.elements.length)
        setNotice(
          '분리할 요소를 찾지 못했습니다. 대비가 있는 다른 포스터나 세밀한 분리를 시도해 주세요.',
        );
      else
        setNotice(
          `${loaded.elements.length}개의 요소를 분리했습니다. 포스터를 흔들어 보세요.`,
        );
    } catch (err) {
      if (id !== loadId.current) return;
      const message = err instanceof Error ? err.message : '';
      setError(
        message.includes('password') || message.includes('Password')
          ? '암호가 설정된 PDF입니다. 암호를 해제한 파일을 선택해 주세요.'
          : message.match(/[가-힣]/)
            ? message
            : '파일을 읽지 못했습니다. 올바른 PDF, JPG, PNG 파일인지 확인해 주세요.',
      );
    } finally {
      if (id === loadId.current) setBusy(false);
    }
  };
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.files?.[0];
    if (next) void importFile(next);
    e.target.value = '';
  };
  const changeDetail = (next: Detail) => {
    setDetail(next);
    if (file) void importFile(file, next, page);
  };
  const loadDemo = () => {
    loadId.current++;
    setBusy(false);
    setAsset(createDemo());
    setFile(null);
    setFilename('Nothing stays still');
    setPage(1);
    setError('');
    setNotice('');
    setSettings((prev) => ({ ...prev, original: false, paused: false }));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointer.current = {
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      time: performance.now(),
      shakeAt: 0,
      moved: false,
    };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = pointer.current;
    if (!p) return;
    const now = performance.now(),
      dx = e.clientX - p.x,
      dy = e.clientY - p.y;
    if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > 5) {
      p.moved = true;
      setDragging(true);
    }
    const distance = Math.hypot(dx, dy),
      speed = distance / Math.max(1, now - p.time);
    if (p.moved && now - p.shakeAt > 50 && speed > 0.08) {
      testMotion(Math.min(1, speed / 1.6), {
        x: dx / Math.max(1, distance),
        y: dy / Math.max(1, distance),
      });
      p.shakeAt = now;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    p.time = now;
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (pointer.current && !pointer.current.moved) {
      const rect = e.currentTarget.getBoundingClientRect();
      setSelected(
        engineRef.current?.hitTest(
          ((e.clientX - rect.left) / rect.width) * asset.width,
          ((e.clientY - rect.top) / rect.height) * asset.height,
        ) || null,
      );
    }
    pointer.current = null;
    setDragging(false);
  };

  const openExport = () => {
    pauseBeforeExport.current = settings.paused;
    update('paused', true);
    setExportOpen(true);
  };
  const closeExport = () => {
    setExportOpen(false);
    update('paused', pauseBeforeExport.current);
  };
  const save = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    setSaving(true);
    try {
      await exportPoster(engine, format, filename, exportOverlays, resolution);
      setNotice('새로운 포스터를 저장했습니다.');
      closeExport();
    } catch (err) {
      setNotice(
        err instanceof Error
          ? err.message
          : '저장에 실패했습니다. 다시 시도해 주세요.',
      );
    } finally {
      setSaving(false);
    }
  };
  const saveMap = () => {
    if (engineRef.current) exportMap(engineRef.current, filename);
  };
  const copyCoords = async () => {
    const data = telemetry.elements.find((e) => e.id === selected);
    if (!data) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setNotice('선택한 요소의 좌표를 복사했습니다.');
    } catch {
      setNotice(
        '클립보드를 사용할 수 없습니다. 좌표 JSON 저장을 이용해 주세요.',
      );
    }
  };
  const selectedData = telemetry.elements.find((e) => e.id === selected);
  const deformationPoints = selected
    ? engineRef.current?.deformationPoints(selected) || []
    : [];
  const movedCount = telemetry.elements.filter(
    (e) => Math.hypot(e.dx, e.dy) > 1 || e.warp > 0,
  ).length;
  const displacement = telemetry.elements.length
    ? telemetry.elements.reduce((sum, e) => sum + Math.hypot(e.dx, e.dy), 0) /
      telemetry.elements.length
    : 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          href="#"
          className="brand"
          aria-label="OFF/SET 포스터 실험실"
          onClick={(e) => e.preventDefault()}
        >
          <span className="brand-icon">/</span>
          <span>
            OFF<span className="brand-slash">/</span>SET
            <span className="brand-sub">POSTER EXPERIMENT LAB</span>
          </span>
        </a>
        <nav className="header-nav">
          <span className="workspace-tag">
            <span className="status-dot" />
            개인 작업 공간
          </span>
          <span className="header-divider" />
          <button
            className="text-button help-button"
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp size={16} />
            사용 가이드
          </button>
          <button className="primary-button header-export" onClick={openExport}>
            <ArrowDownToLine size={16} />
            포스터 저장
            <ArrowUpRight size={15} />
          </button>
        </nav>
      </header>

      <main>
        <section className="intro">
          <div>
            <div className="eyebrow">
              <span className="tiny-square" />A LITTLE CHAOS, A NEW PERSPECTIVE
            </div>
            <h1>
              질서를 흔들고,
              <br className="mobile-break" /> 새로운 포스터를 만드세요
              <span className="orange">.</span>
            </h1>
            <p>
              덜 마른 점토처럼 흐르고 부딪히는 포스터. 노트북의 움직임이 소리가
              됩니다.
            </p>
          </div>
          <div className="intro-mark">
            <span>
              MAKE ROOM
              <br />
              FOR THE UNEXPECTED.
            </span>
            <MoveUpRight size={36} strokeWidth={1.3} />
          </div>
        </section>

        <div className="workbench">
          <aside className="left-panel panel">
            <div className="panel-heading">
              <span>
                <FileImage size={15} />
                포스터
              </span>
              <span className="step">01 / IMPORT</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              className="visually-hidden"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/png,image/jpeg"
              onChange={onFile}
              aria-label="포스터 파일 선택"
            />
            <button
              className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const dropped = e.dataTransfer.files[0];
                if (dropped) void importFile(dropped);
              }}
            >
              <span className="upload-icon">
                {busy ? (
                  <LoaderCircle className="spin" size={22} />
                ) : (
                  <ImagePlus size={23} strokeWidth={1.5} />
                )}
              </span>
              <strong>
                {busy ? '요소를 분석하고 있어요' : '포스터를 올려보세요'}
              </strong>
              <span>파일을 끌어놓거나 클릭해 선택</span>
              <span className="file-types">
                PDF <i /> JPG <i /> PNG <span>최대 50MB</span>
              </span>
            </button>
            {error && (
              <div className="error-message" role="alert">
                {error}
                <button aria-label="오류 닫기" onClick={() => setError('')}>
                  <X size={14} />
                </button>
              </div>
            )}
            <div className="sample-row">
              <span>먼저 실험해 보고 싶다면</span>
              <button onClick={loadDemo}>
                샘플 사용
                <ArrowUpRight size={12} />
              </button>
            </div>
            <div className="section-divider" />
            <div className="panel-heading layers-heading">
              <span>
                <Layers3 size={15} />
                분리된 요소
                <span className="count-badge" data-testid="element-count">
                  {telemetry.elements.length}
                </span>
              </span>
              <ScanLine size={14} className="muted" />
            </div>
            <div className="separation-control">
              <span>분리 수준</span>
              <select
                aria-label="요소 분리 수준"
                value={detail}
                disabled={busy || !file}
                onChange={(e) => changeDetail(e.target.value as Detail)}
              >
                <option value="coarse">덩어리로</option>
                <option value="normal">자동 분리</option>
                <option value="fine">세밀하게</option>
              </select>
            </div>
            <div className="layer-list" aria-label="분리된 포스터 요소">
              {telemetry.elements.length === 0 && (
                <div className="empty-layers">분리된 요소가 없습니다.</div>
              )}
              {telemetry.elements.slice(0, 220).map((el, index) => {
                const kind = engineRef.current?.entities.find(
                  (entity) => entity.element.id === el.id,
                )?.element.kind;
                return (
                  <button
                    key={el.id}
                    className={`layer-item ${selected === el.id ? 'selected' : ''}`}
                    onClick={() =>
                      setSelected(selected === el.id ? null : el.id)
                    }
                    aria-pressed={selected === el.id}
                  >
                    <span
                      className={`layer-thumbnail ${kind === 'text' ? 'text-thumb' : kind === 'fragment' ? 'fragment-thumb' : 'shape-thumb'}`}
                    >
                      {kind === 'text' ? (
                        'T'
                      ) : kind === 'fragment' ? (
                        <Split size={14} />
                      ) : index % 3 === 0 ? (
                        <span className="thumb-circle" />
                      ) : (
                        <Grip size={15} />
                      )}
                    </span>
                    <span className="layer-name">
                      {el.label}
                      <small>
                        {el.id.toUpperCase()}{' '}
                        <span>
                          ·{' '}
                          {kind === 'text'
                            ? '텍스트'
                            : kind === 'fragment'
                              ? '파편'
                              : '영역'}
                        </span>
                      </small>
                    </span>
                    <span className="layer-dot" />
                  </button>
                );
              })}
            </div>
            <div className="analysis-note">
              <Fingerprint size={14} />
              <span>
                {asset.method}
                <small>요소를 클릭하면 위치를 확인할 수 있어요.</small>
              </span>
            </div>
            <div className="privacy-note">
              <ShieldCheck size={13} />
              파일은 기기 안에서만 처리됩니다.
            </div>
          </aside>

          <section className="canvas-panel" aria-label="포스터 편집 캔버스">
            <div className="canvas-toolbar">
              <span className="document-name">
                <span className="document-dot" />
                {filename}
                {!file && <span className="sample-badge">SAMPLE</span>}
              </span>
              <div className="canvas-tools">
                {asset.pageCount > 1 && (
                  <label className="page-select">
                    페이지
                    <select
                      aria-label="PDF 페이지"
                      value={page}
                      disabled={busy}
                      onChange={(e) =>
                        file &&
                        void importFile(file, detail, Number(e.target.value))
                      }
                    >
                      {Array.from({ length: asset.pageCount }, (_, i) => (
                        <option key={i} value={i + 1}>
                          {i + 1} / {asset.pageCount}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  className={`icon-button ${settings.original ? 'active' : ''}`}
                  title="원본 보기"
                  aria-label="원본 보기"
                  aria-pressed={settings.original}
                  onClick={() => update('original', !settings.original)}
                >
                  <Copy size={15} />
                </button>
                <button
                  className="icon-button"
                  title="처음으로 되돌리기"
                  aria-label="포스터 초기화"
                  onClick={reset}
                >
                  <RotateCcw size={15} />
                </button>
              </div>
            </div>
            <div
              className={`canvas-stage ${dragging ? 'is-dragging' : ''}`}
              ref={stageRef}
            >
              <div className="stage-topline">
                <span>
                  <span
                    className={`live-dot ${settings.paused ? 'paused' : ''}`}
                  />
                  {settings.original
                    ? 'ORIGINAL VIEW'
                    : settings.paused
                      ? 'SIMULATION PAUSED'
                      : 'LIVE EXPERIMENT'}
                </span>
                <span>
                  {asset.width} × {asset.height} PX
                </span>
              </div>
              <div className="ruler ruler-top">
                <span>0</span>
                <span>{Math.round(asset.width / 2)}</span>
                <span>{asset.width}</span>
              </div>
              <div className="stage-axis">
                <span>Y</span>
                <ArrowDown size={11} />
              </div>
              <canvas
                ref={canvasRef}
                className="poster-canvas"
                aria-label="포스터 — 드래그해서 흔들거나 요소를 클릭해 선택"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => {
                  pointer.current = null;
                  setDragging(false);
                }}
              />
              {busy && (
                <div className="canvas-loading">
                  <LoaderCircle className="spin" size={25} />
                  <span>포스터의 요소를 분리하고 있어요</span>
                </div>
              )}
              {settings.original && (
                <span className="original-pill">원본 미리보기</span>
              )}
              <div className="stage-bottomline">
                <span>↳ MOTION BECOMES SOUND</span>
                <span>
                  <Focus size={12} />
                  FIT <span className="zoom-value">{zoom}%</span>
                </span>
              </div>
            </div>
            <div className="interaction-bar">
              <button
                className="pause-button"
                aria-label={
                  settings.paused ? '시뮬레이션 재생' : '시뮬레이션 일시정지'
                }
                onClick={() => update('paused', !settings.paused)}
              >
                {settings.paused ? (
                  <Play size={16} fill="currentColor" />
                ) : (
                  <Pause size={16} fill="currentColor" />
                )}
              </button>
              <span className="interaction-divider" />
              <div className="gesture-hint">
                <MousePointer2 size={17} strokeWidth={1.5} />
                <span>
                  노트북으로 연주하기
                  <small>오른쪽에서 센서 또는 카메라를 연결하세요</small>
                </span>
              </div>
              <button
                className="shake-button"
                onClick={shake}
                disabled={
                  settings.paused ||
                  settings.original ||
                  busy ||
                  !telemetry.elements.length
                }
              >
                <Activity size={18} />
                입력 테스트
                <ArrowUpRight size={15} />
              </button>
            </div>
            <div className="canvas-status">
              <span>
                <span className="status-dot" />
                {telemetry.active
                  ? `${movedCount}개 요소 변형 중`
                  : '준비 완료. 작은 흔들림에서 시작해 보세요.'}
              </span>
              <span className="energy-meter">
                SHAKE ENERGY
                <span className="energy-bars">
                  {Array.from({ length: 15 }, (_, i) => (
                    <i
                      key={i}
                      className={telemetry.energy * 15 > i ? 'filled' : ''}
                    />
                  ))}
                </span>
                <span>{Math.round(telemetry.energy * 100)}%</span>
              </span>
            </div>
          </section>

          <aside className="right-panel panel instrument-panel">
            <div className="panel-heading">
              <span>
                <Mic2 size={15} />
                포스터 악기
              </span>
              <span className="step">02 / PERFORM</span>
            </div>
            <div className="material-intro">
              <span className="material-dot" />
              <div>
                <strong>DAMP CLAY</strong>
                <small>중력 · 점성 변형 · 충돌 균열이 함께 반응합니다.</small>
              </div>
              <Waves size={24} strokeWidth={1.2} />
            </div>
            <p className="instrument-description">
              작은 움직임은 부드럽게 휘어지고,
              <br />큰 움직임은 날카롭게 부서집니다.
            </p>
            <div className="material-meters" aria-label="실시간 재료 반응">
              {[
                {
                  label: '흐름과 휘어짐',
                  value: Math.max(
                    telemetry.deformation,
                    telemetry.energy * 0.5,
                  ),
                },
                { label: '충돌 압력', value: telemetry.impact },
                {
                  label: '균열 · 파편',
                  value:
                    telemetry.elements.filter((e) => e.id.includes('.'))
                      .length / Math.max(1, telemetry.elements.length),
                },
              ].map((meter) => (
                <div key={meter.label}>
                  <span>
                    {meter.label}
                    <b>{Math.round(meter.value * 100)}%</b>
                  </span>
                  <i>
                    <i
                      style={{ width: `${Math.min(100, meter.value * 100)}%` }}
                    />
                  </i>
                </div>
              ))}
            </div>
            <div className="input-section-label">노트북 움직임 감지</div>
            <button
              className={`sensor-button ${input.source === 'sensor' && input.status.state === 'connected' ? 'connected' : ''}`}
              onClick={() => input.startInput('sensor')}
              disabled={
                input.source === 'sensor' && input.status.state === 'requesting'
              }
            >
              <Radio size={15} />
              <span>
                {input.source === 'sensor' &&
                input.status.state === 'requesting'
                  ? '가속도 실측 확인 중…'
                  : '가속도 센서로 연주'}
              </span>
              <ArrowUpRight size={13} />
            </button>
            <button
              className={`sensor-button camera-button ${input.source === 'camera' && input.status.state === 'connected' ? 'connected' : ''}`}
              onClick={() => input.startInput('camera')}
              disabled={
                input.source === 'camera' && input.status.state === 'requesting'
              }
            >
              <Camera size={15} />
              <span>카메라로 움직임 감지</span>
              <ArrowUpRight size={13} />
            </button>
            <div
              className={`motion-status ${input.status.state}`}
              role="status"
              data-testid="motion-status"
            >
              <span className="status-dot" />
              <span>{input.status.message}</span>
            </div>
            <div
              className={`camera-preview ${input.source === 'camera' && ['connected', 'requesting'].includes(input.status.state) ? 'visible' : ''}`}
            >
              <video
                ref={input.videoRef}
                muted
                playsInline
                aria-label="움직임 분석용 카메라 미리보기"
              />
              <span>LOCAL ONLY · 영상 저장·전송 없음</span>
            </div>
            {input.source &&
              ['connected', 'requesting', 'stale'].includes(
                input.status.state,
              ) && (
                <button className="stop-input" onClick={input.stopInput}>
                  <Square size={10} fill="currentColor" />
                  움직임 감지 중지
                </button>
              )}
            <div className="input-reading" data-testid="motion-reading">
              <span>
                {input.sample?.source === 'camera'
                  ? 'CAMERA ESTIMATE'
                  : input.sample?.source === 'sensor'
                    ? 'ACCELERATION'
                    : input.sample?.source === 'test'
                      ? 'TEST INPUT'
                      : 'WAITING FOR MOTION'}
              </span>
              <strong>
                {fmt(input.sample?.magnitude || 0, 2)}
                <small>
                  {input.sample?.source === 'sensor'
                    ? 'm/s²'
                    : input.sample?.source === 'camera'
                      ? 'px/s'
                      : ''}
                </small>
              </strong>
              {input.sample?.source === 'camera' && (
                <span>
                  추적 신뢰도 {Math.round(input.sample.confidence * 100)}%
                </span>
              )}
            </div>
            <p className="motion-method-note">
              M1 맥북에서 가속도 값이 제공되지 않으면 카메라 방식을 사용하세요.
              카메라는 정지한 배경의 상대 이동을 추정하며, 사람이나 배경의
              움직임을 오인할 수 있습니다.
            </p>
            <button
              className={`sound-toggle ${input.sound === 'running' ? 'enabled' : ''}`}
              onClick={input.toggleSound}
              aria-pressed={input.sound === 'running'}
            >
              {input.sound === 'running' ? (
                <Volume2 size={16} />
              ) : (
                <VolumeX size={16} />
              )}
              <span>
                {input.sound === 'running'
                  ? '연주 소리 켜짐'
                  : input.sound === 'muted'
                    ? '연주 소리 꺼짐'
                    : '연주 소리 시작'}
                <small>부드러운 저음 → 날카로운 배음</small>
              </span>
              <span className="sound-wave">∿∿∿</span>
            </button>
            <div className="section-divider" />
            <div className="panel-heading">
              <span>
                <Crosshair size={15} />
                움직임 시각화
              </span>
              <span className="step">03 / MAP</span>
            </div>
            <Toggle
              label="이동 경로"
              description="요소가 지나간 궤적 표시"
              checked={settings.showPaths}
              onChange={() => update('showPaths', !settings.showPaths)}
            />
            <Toggle
              label="좌표 라벨"
              description="요소 ID와 현재 위치 표시"
              checked={settings.showLabels}
              onChange={() => update('showLabels', !settings.showLabels)}
            />
            <div className="coordinate-card">
              <div className="coordinate-header">
                <span>
                  <span className="tiny-square" />
                  {selectedData
                    ? selectedData.id.toUpperCase()
                    : 'LIVE POSITION DATA'}
                </span>
                {selectedData && (
                  <button
                    aria-label="선택 요소 좌표 복사"
                    onClick={() => void copyCoords()}
                  >
                    <Copy size={12} />
                  </button>
                )}
              </div>
              {selectedData ? (
                <>
                  <div className="selected-name">{selectedData.label}</div>
                  <div className="coordinate-grid">
                    <span>
                      POSITION X
                      <b>
                        {fmt(selectedData.x)}
                        <small>px</small>
                      </b>
                    </span>
                    <span>
                      POSITION Y
                      <b>
                        {fmt(selectedData.y)}
                        <small>px</small>
                      </b>
                    </span>
                    <span>
                      OFFSET ΔX
                      <b className="orange">
                        {selectedData.dx >= 0 ? '+' : ''}
                        {fmt(selectedData.dx)}
                        <small>px</small>
                      </b>
                    </span>
                    <span>
                      OFFSET ΔY
                      <b className="orange">
                        {selectedData.dy >= 0 ? '+' : ''}
                        {fmt(selectedData.dy)}
                        <small>px</small>
                      </b>
                    </span>
                  </div>
                  <div className="coordinate-meta">
                    <span>
                      눌림 {fmt(selectedData.compression * 100, 0)}% ·{' '}
                      {fmt(selectedData.rotation)}°
                    </span>
                    <span>변형 ±{fmt(selectedData.warp)}px</span>
                  </div>
                  <details className="vertex-details">
                    <summary>
                      변형 경로 좌표 <ChevronDown size={11} />
                    </summary>
                    <p>중앙선 기준 · 원래 좌표 → 현재 좌표 (px)</p>
                    <table>
                      <thead>
                        <tr>
                          <th>점</th>
                          <th>X</th>
                          <th>Y</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deformationPoints.map((point) => (
                          <tr key={point.id}>
                            <td>{point.id}</td>
                            <td>
                              <small>{fmt(point.before.x, 0)} →</small>{' '}
                              {fmt(point.after.x, 0)}
                            </td>
                            <td>
                              <small>{fmt(point.before.y, 0)} →</small>{' '}
                              {fmt(point.after.y, 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </>
              ) : (
                <>
                  <div className="coordinate-grid overview-grid">
                    <span>
                      ELEMENTS
                      <b>
                        {telemetry.elements.length}
                        <small>개</small>
                      </b>
                    </span>
                    <span>
                      AVG. OFFSET
                      <b>
                        {fmt(displacement)}
                        <small>px</small>
                      </b>
                    </span>
                  </div>
                  <p className="coordinate-empty">
                    <MousePointer2 size={12} />
                    요소를 선택해 상세 좌표를 확인하세요.
                  </p>
                </>
              )}
              <button className="map-download" onClick={saveMap}>
                <FileJson size={13} />
                좌표 · 경로 JSON 저장
                <Download size={12} />
              </button>
            </div>
          </aside>
        </div>
        <footer className="page-footer">
          <span>DESIGNED TO COME UNDONE.</span>
          <span>
            <span className="orange footer-asterisk">✳</span>우연이 만드는, 단
            하나의 포스터.
          </span>
          <span>OFF/SET © 2026</span>
        </footer>
      </main>

      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          <span>{notice}</span>
          <button aria-label="알림 닫기" onClick={() => setNotice('')}>
            <X size={15} />
          </button>
        </div>
      )}

      {(exportOpen || helpOpen) && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              if (exportOpen) closeExport();
              setHelpOpen(false);
            }
          }}
        >
          <div
            className={`modal ${helpOpen ? 'help-modal' : ''}`}
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <button
              className="modal-close icon-button"
              aria-label="창 닫기"
              onClick={() => {
                if (exportOpen) closeExport();
                setHelpOpen(false);
              }}
            >
              <X size={20} />
            </button>
            {exportOpen ? (
              <>
                <div className="eyebrow">04 / KEEP THE UNEXPECTED</div>
                <h2 id="modal-title">
                  이 순간의 포스터를 저장하세요<span className="orange">.</span>
                </h2>
                <p className="modal-description">
                  현재의 형태를 고해상도 이미지로 간직하세요.
                </p>
                <div className="export-preview">
                  <img
                    src={engineRef.current
                      ?.snapshot(exportOverlays, 0.4)
                      .toDataURL()}
                    alt="저장할 포스터 미리보기"
                  />
                  <div>
                    <strong>{filename}</strong>
                    <span>
                      {asset.width * resolution} × {asset.height * resolution}{' '}
                      px
                    </span>
                    <small>
                      {telemetry.elements.length}개 요소 · 현재 상태 저장
                    </small>
                  </div>
                </div>
                <label className="modal-label">파일 형식</label>
                <div className="format-options">
                  {(['png', 'jpg', 'pdf'] as const).map((f) => (
                    <button
                      key={f}
                      className={format === f ? 'selected' : ''}
                      onClick={() => setFormat(f)}
                    >
                      <FileImage size={18} />
                      <strong>{f.toUpperCase()}</strong>
                      <span>
                        {f === 'png'
                          ? '선명한 원본 화질'
                          : f === 'jpg'
                            ? '가벼운 이미지'
                            : '인쇄용 문서'}
                      </span>
                      {format === f && <Check size={13} />}
                    </button>
                  ))}
                </div>
                <label className="resolution-select">
                  이미지 해상도
                  <select
                    aria-label="저장 해상도"
                    value={resolution}
                    onChange={(e) => setResolution(Number(e.target.value))}
                  >
                    <option value="1">
                      1× · {asset.width} × {asset.height}
                    </option>
                    <option value="2">
                      2× · {asset.width * 2} × {asset.height * 2}
                    </option>
                    <option value="3">
                      3× · {asset.width * 3} × {asset.height * 3}
                    </option>
                  </select>
                  <ChevronDown size={14} />
                </label>
                <Toggle
                  label="이동 경로와 좌표 포함"
                  description="현재 켜진 시각화 표시를 이미지에 저장"
                  checked={exportOverlays}
                  onChange={() => setExportOverlays((v) => !v)}
                />
                <button
                  className="primary-button export-confirm"
                  disabled={saving}
                  onClick={() => void save()}
                >
                  {saving ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : (
                    <ArrowDownToLine size={17} />
                  )}
                  {saving
                    ? '저장하는 중…'
                    : `${format.toUpperCase()} 포스터 저장`}
                  <ArrowUpRight size={15} />
                </button>
                <button className="export-json" onClick={saveMap}>
                  <FileJson size={14} />
                  좌표와 변형 경로는 JSON으로 따로 저장할 수 있어요.
                </button>
              </>
            ) : (
              <>
                <div className="eyebrow">A GUIDE TO HAPPY ACCIDENTS</div>
                <h2 id="modal-title">
                  계획하지 않은 디자인의 시작<span className="orange">.</span>
                </h2>
                <div className="guide-step">
                  <span>01</span>
                  <div>
                    <h3>포스터를 올리세요</h3>
                    <p>
                      PDF, JPG, PNG를 최대 50MB까지 지원합니다. PDF의 텍스트와
                      이미지의 픽셀 영역을 자동으로 나눕니다. PDF는 페이지별로
                      선택할 수 있어요.
                    </p>
                  </div>
                </div>
                <div className="guide-step">
                  <span>02</span>
                  <div>
                    <h3>노트북의 움직임으로 연주하세요</h3>
                    <p>
                      가속도 센서 또는 카메라를 연결하세요. 약하게 움직이면
                      요소가 점토처럼 휘고 눌리며, 강하게 움직이면 충돌한 요소가
                      부서집니다. 중력·변형·균열은 항상 함께 작용하고, 소리의
                      음색도 움직임의 강도에 따라 변합니다. 입력 테스트 버튼과
                      드래그, Space는 별도의 테스트 입력입니다.
                    </p>
                  </div>
                </div>
                <div className="guide-step">
                  <span>03</span>
                  <div>
                    <h3>움직임을 살펴보세요</h3>
                    <p>
                      요소를 클릭하면 현재 좌표, 원래 위치로부터의 이동량, 회전,
                      지그재그 변형량이 표시됩니다. 이동 경로와 변형된 꼭짓점은
                      JSON으로 저장됩니다.
                    </p>
                  </div>
                </div>
                <div className="guide-step">
                  <span>04</span>
                  <div>
                    <h3>새로운 포스터를 간직하세요</h3>
                    <p>
                      일시정지로 원하는 순간을 잡고 PNG, JPG, PDF로 저장하세요.
                      PDF 출력은 화면의 형태를 담은 이미지 방식입니다.
                    </p>
                  </div>
                </div>
                <div className="guide-note">
                  <Radio size={17} />
                  <p>
                    <strong>실측 센서와 카메라 추정을 구분합니다</strong>실제
                    가속도 데이터가 수신되어야 센서 연결 완료로 표시됩니다. M1
                    MacBook Pro를 포함한 많은 노트북은 브라우저에 가속도 값을
                    제공하지 않습니다. 이때 내장 카메라로 배경의 상대 이동을
                    분석할 수 있습니다. 정지한 배경과 충분한 조명이 필요하며,
                    사람이 움직이거나 배경이 바뀌면 오인할 수 있습니다. 카메라
                    영상은 기기 안에서만 분석하고 저장하거나 전송하지 않습니다.
                    감지를 중지하거나 탭을 떠나면 카메라를 해제합니다.
                  </p>
                </div>
                <div className="guide-note">
                  <ScanLine size={17} />
                  <p>
                    <strong>요소 분리는 포스터마다 달라요</strong>텍스트가 살아
                    있는 PDF와 단색 배경의 포스터에서 잘 작동합니다. 평면
                    이미지의 글자·사물을 의미 단위로 인식하는 AI 분리는 포함되지
                    않습니다. 사진 위주의 포스터는 조각 단위로 나뉘어요. 긴 변
                    기준 최대 1,200px로 분석합니다.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
