import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  Camera,
  Grip,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { loadPoster } from './lib/extract';
import { exportMap, exportPoster } from './lib/export';
import { PosterPhysics } from './lib/physics';
import { BODY_LINKS, PART_COLORS } from './lib/body';
import { DEFAULT_SETTINGS } from './lib/types';
import type { Point, PosterAsset, Settings, Telemetry } from './lib/types';
import { useMotionInstrument } from './useMotionInstrument';

const empty: Telemetry = {
  elements: [],
  energy: 0,
  active: false,
  impact: 0,
  deformation: 0,
  fragments: 0,
  fractures: 0,
};
export default function App() {
  const [asset, setAsset] = useState<PosterAsset | null>(null),
    [name, setName] = useState('poster');
  const [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [notice, setNotice] = useState('');
  const [about, setAbout] = useState(false),
    [expanded, setExpanded] = useState(false),
    [isDragging, setIsDragging] = useState(false);
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS }),
    [telemetry, setTelemetry] = useState(empty);
  const [recentBreak, setRecentBreak] = useState(false),
    [menu, setMenu] = useState<'motion' | 'download' | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 12, top: 12 }),
    [dropActive, setDropActive] = useState(false),
    [videoRatio, setVideoRatio] = useState(4 / 3);
  const fileRef = useRef<HTMLInputElement>(null),
    canvasRef = useRef<HTMLCanvasElement>(null),
    paperRef = useRef<HTMLDivElement>(null);
  const wordmarkRef = useRef<HTMLSpanElement>(null),
    aboutRef = useRef<HTMLButtonElement>(null),
    panelRef = useRef<HTMLDivElement>(null),
    menuRef = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement | null>(null),
    engineRef = useRef<PosterPhysics | null>(null),
    settingsRef = useRef(settings),
    loadId = useRef(0);
  const projection = useRef({ left: 0, top: 0, scale: 1, ratio: 1 }),
    hovered = useRef(false),
    panelPlaced = useRef(false),
    held = useRef(false),
    menuOpen = useRef(menu);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    position: Point;
  } | null>(null);
  settingsRef.current = settings;
  menuOpen.current = menu;
  const input = useMotionInstrument(engineRef, settingsRef, setNotice);
  const { driveSound, impactSound } = input;
  const font = telemetry.active ? 'MetaAccanthisAlternate' : 'MetaAccanthis';

  function holdPanel() {
    const engine = engineRef.current;
    if (!engine) return;
    const hold =
      panelPlaced.current ||
      hovered.current ||
      !!drag.current ||
      !!menuOpen.current;
    if (hold && !held.current) {
      engine.beginFixtureDrag('adjust-box');
      held.current = true;
    }
    if (!hold && held.current) {
      engine.endFixtureDrag('adjust-box');
      held.current = false;
    }
  }
  useEffect(() => {
    holdPanel();
  }, [menu]);
  useEffect(() => {
    if (!asset || !canvasRef.current) return;
    const engine = new PosterPhysics(asset, settingsRef.current);
    engineRef.current = engine;
    engine.onImpact = impactSound;
    held.current = false;
    const canvas = canvasRef.current,
      ctx = canvas.getContext('2d')!;
    const layout = () => {
      const paper = paperRef.current!.getBoundingClientRect(),
        ratio = Math.min(devicePixelRatio || 1, 2),
        scale = paper.width / asset.width;
      projection.current = { left: paper.left, top: paper.top, scale, ratio };
      canvas.width = innerWidth * ratio;
      canvas.height = innerHeight * ratio;
      engine.annotationScale = 1 / scale;
      engine.annotationLimit = innerWidth < 700 ? 6 : 12;
      engine.setBounds({
        x: -paper.left / scale,
        y: -paper.top / scale,
        width: innerWidth / scale,
        height: innerHeight / scale,
      });
      engine.setFixtures(
        [wordmarkRef.current, aboutRef.current, panelRef.current].flatMap(
          (node, i) => {
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
          },
        ),
      );
      held.current = false;
      holdPanel();
    };
    layout();
    window.addEventListener('resize', layout);
    let frame = 0,
      last = performance.now(),
      lastUi = 0,
      lastFractures = 0,
      lastBreak = -1000;
    const render = (now: number) => {
      engine.settings = settingsRef.current;
      engine.update(now - last);
      last = now;
      const { left, top, scale, ratio } = projection.current;
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
      [wordmarkRef.current, aboutRef.current, panelRef.current].forEach(
        (node, i) => {
          const fixture = engine.fixtures[i];
          if (node && fixture)
            node.style.transform = `translate(${(fixture.body.position.x - fixture.origin.x) * scale}px,${(fixture.body.position.y - fixture.origin.y) * scale}px) rotate(${fixture.body.angle}rad)`;
        },
      );
      driveSound(engine.energy);
      if (now - lastUi > 110) {
        const data = engine.telemetry();
        if (data.fractures > lastFractures) lastBreak = now;
        lastFractures = data.fractures;
        setRecentBreak(now - lastBreak < 650);
        setTelemetry(data);
        lastUi = now;
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', layout);
      [wordmarkRef.current, aboutRef.current, panelRef.current].forEach(
        (node) => {
          if (node) node.style.transform = '';
        },
      );
      engine.dispose();
      engineRef.current = null;
    };
  }, [asset, driveSound, impactSound]);

  useEffect(() => {
    if (!menu) return;
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus();
    const outside = (event: globalThis.PointerEvent) => {
      if (
        !panelRef.current?.contains(event.target as Node) &&
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
        const buttons = [
            ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
              '[role="menuitem"]',
            ) ?? []),
          ],
          i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[
          (i + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
            buttons.length
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
    if (!about && !expanded) return;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAbout(false);
        setExpanded(false);
      }
      if (about && event.key === 'Tab') {
        event.preventDefault();
        document
          .querySelector<HTMLButtonElement>('.about-dialog button')
          ?.focus();
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [about, expanded]);

  async function upload(file?: File) {
    if (!file) return;
    const id = ++loadId.current;
    setLoading(true);
    setNotice('');
    setMenu(null);
    input.stopInput();
    try {
      const next = await loadPoster(file, 'normal');
      if (id !== loadId.current) return;
      panelPlaced.current = false;
      setTelemetry(empty);
      setRecentBreak(false);
      setAsset(next);
      setName(file.name);
      setSettings((s) => ({ ...s, paused: false }));
    } catch (error) {
      if (id === loadId.current)
        setNotice(
          error instanceof Error && !/[가-힣]/.test(error.message)
            ? error.message
            : 'Unable to open this poster. Use a valid PDF, JPG or PNG.',
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
    } catch {
      setNotice('Unable to export this poster. Please try again.');
    } finally {
      setSaving(false);
    }
  }
  function toggleMenu(next: 'motion' | 'download', button: HTMLButtonElement) {
    const box = button.getBoundingClientRect();
    menuTrigger.current = button;
    setMenuPosition({
      left: Math.max(12, Math.min(innerWidth - 292, box.right - 280)),
      top: Math.max(12, Math.min(innerHeight - 330, box.top - 285)),
    });
    setMenu(menu === next ? null : next);
  }
  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (
      event.button !== 0 ||
      (target.closest('button') && !target.closest('[data-drag-handle]'))
    )
      return;
    const position = engineRef.current?.beginFixtureDrag('adjust-box');
    if (!position) return;
    event.preventDefault();
    panelPlaced.current = true;
    held.current = true;
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      position,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
  }
  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const value = drag.current;
    if (!value || value.id !== event.pointerId) return;
    event.preventDefault();
    const scale = projection.current.scale;
    engineRef.current?.moveFixture('adjust-box', {
      x: value.position.x + (event.clientX - value.x) / scale,
      y: value.position.y + (event.clientY - value.y) / scale,
    });
  }
  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    holdPanel();
  }
  const area =
    telemetry.elements.reduce((sum, e) => sum + e.areaWeight, 0) || 1;
  const values = (['x', 'y', 'dx', 'dy'] as const).map(
    (key) =>
      telemetry.elements.reduce((sum, e) => sum + e[key] * e.areaWeight, 0) /
      area,
  );
  const connected = input.status.state === 'connected',
    strength = input.sample?.strength ?? 0,
    percent = Math.round(strength * 100);
  const sourceName =
    input.source === 'body'
      ? 'Body nodes'
      : input.source === 'camera'
        ? 'Camera motion'
        : input.source === 'sensor'
          ? 'Device sensor'
          : 'Choose an input';
  const effect =
    input.source === 'body'
      ? (input.sample?.body?.effect ?? 'REST')
      : strength < 0.08
        ? 'REST'
        : strength < 0.35
          ? 'MOVE'
          : strength < 0.5
            ? 'BEND'
            : 'BREAK ON IMPACT';
  const isSettling =
    telemetry.energy > 0.02 ||
    telemetry.impact > 0.02 ||
    telemetry.elements.some((element) => element.speed > 0.08);
  const result = settings.paused
    ? 'PAUSED'
    : recentBreak
      ? 'FRACTURED'
      : effect === 'REST'
        ? isSettling
          ? 'SETTLING'
          : 'STILL'
        : effect;
  const body = input.sample?.body,
    nodes = new Map(body?.nodes.map((node) => [node.id, node]) ?? []);
  const breakAt = input.source === 'body' ? 65 : 50;
  return (
    <main
      className={`studio ${asset ? 'has-poster' : 'is-empty'} ${telemetry.active ? 'is-distorting' : ''}`}
      style={{ '--active-font': font } as CSSProperties}
    >
      <span ref={wordmarkRef} className="wordmark">
        Poster Distorting Map
      </span>
      <button
        ref={aboutRef}
        className="about-button"
        aria-label="About"
        onPointerEnter={() => engineRef.current?.beginFixtureDrag('about')}
        onPointerLeave={() => engineRef.current?.endFixtureDrag('about')}
        onClick={() => setAbout(true)}
      >
        About
      </button>
      {asset && (
        <canvas
          ref={canvasRef}
          className="poster-canvas"
          aria-label="Distorted poster"
        />
      )}
      <input
        ref={fileRef}
        className="file-input"
        type="file"
        accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
        aria-label="Poster file"
        onChange={(event) => {
          void upload(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <section className="poster-stage" aria-label="Poster">
        <div
          ref={paperRef}
          className={`paper ${dropActive ? 'is-dragging' : ''}`}
          style={
            {
              '--poster-ratio': asset ? asset.width / asset.height : 534 / 756,
            } as CSSProperties
          }
          onDragOver={(event) => {
            event.preventDefault();
            setDropActive(true);
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDropActive(false);
            void upload(event.dataTransfer.files[0]);
          }}
          aria-busy={loading}
        >
          <button
            className={`upload-button ${asset ? 'replace-upload' : ''}`}
            aria-label="Upload poster"
            title="Upload PDF, JPG or PNG"
            disabled={loading}
            onClick={() => fileRef.current?.click()}
          >
            <img src="/design/upload.svg" alt="" />
          </button>
          {loading && (
            <span className="loading-indicator" role="status">
              Opening poster…
            </span>
          )}
          {['coral', 'blue', 'pink', 'green'].map((color) => (
            <img
              key={color}
              className={`tape tape-${color}`}
              src={`/design/tape-${color}.svg`}
              alt=""
              draggable={false}
            />
          ))}
        </div>
      </section>
      {asset && (
        <>
          <aside
            className={`input-preview ${expanded ? 'expanded' : ''}`}
            aria-label="Motion input"
            style={{ '--video-ratio': videoRatio } as CSSProperties}
            data-testid="motion-status"
            data-state={input.status.state}
          >
            <div className="input-heading">
              <span>{sourceName}</span>
              <button
                aria-label={
                  expanded ? 'Shrink tracking view' : 'Expand tracking view'
                }
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
            </div>
            <div className="video-window" style={{ aspectRatio: videoRatio }}>
              <video
                ref={input.videoRef}
                autoPlay
                muted
                playsInline
                onLoadedMetadata={(event) => {
                  const v = event.currentTarget;
                  if (v.videoHeight)
                    setVideoRatio(v.videoWidth / v.videoHeight);
                }}
                className={
                  input.source === 'body'
                    ? 'mirrored'
                    : input.source === 'camera'
                      ? 'camera-visible'
                      : ''
                }
                aria-label="Camera preview"
              />
              {input.source === 'body' && body && (
                <svg
                  className="node-overlay"
                  viewBox="0 0 1 1"
                  preserveAspectRatio="none"
                  aria-label="Tracked body nodes"
                >
                  {BODY_LINKS.map(([a, b]) => {
                    const first = nodes.get(a),
                      second = nodes.get(b);
                    return first && second ? (
                      <line
                        key={`${a}-${b}`}
                        x1={1 - first.x}
                        y1={first.y}
                        x2={1 - second.x}
                        y2={second.y}
                        stroke={PART_COLORS[first.part]}
                      />
                    ) : null;
                  })}
                  {body.nodes.map((node) => (
                    <circle
                      key={node.id}
                      data-part={node.part}
                      cx={1 - node.x}
                      cy={node.y}
                      r={node.strength > 0.35 ? 0.007 : 0.0045}
                      fill={PART_COLORS[node.part]}
                    >
                      <title>
                        {node.label}: {Math.round(node.strength * 100)}%
                      </title>
                    </circle>
                  ))}
                </svg>
              )}
              {!connected && (
                <span className="preview-idle">
                  {input.status.state === 'requesting'
                    ? 'CONNECTING…'
                    : input.status.state === 'idle'
                      ? 'TRACKING OFF'
                      : 'CHECK CONNECTION'}
                </span>
              )}
            </div>
            <div className="input-feedback" data-effect={result}>
              <div className="causal-readout">
                <span>
                  {body?.dominant ?? (connected ? 'Motion' : 'Input')}{' '}
                  <strong>{percent}%</strong>
                </span>
                <span aria-hidden="true">→</span>
                <output aria-label="Poster response">{result}</output>
              </div>
              <div className="input-meter">
                <i style={{ width: `${percent}%` }} />
              </div>
              <div className="response-scale">
                <span>Move 8–34%</span>
                <span>Bend 35–{breakAt - 1}%</span>
                <span>Break ≥{breakAt}%</span>
              </div>
              {input.source === 'body' && (
                <div className="part-presence" aria-label="Detected body parts">
                  {Object.keys(PART_COLORS).map((part) => {
                    const reading = body?.parts.find(
                      (value) => value.part === part,
                    );
                    return (
                      <span
                        key={part}
                        data-detected={!!reading?.detected}
                        data-part={part}
                        style={
                          {
                            '--part-color':
                              PART_COLORS[part as keyof typeof PART_COLORS],
                          } as CSSProperties
                        }
                        title={
                          reading?.detected
                            ? `${part}: ${Math.round(reading.strength * 100)}%`
                            : `${part}: not detected`
                        }
                      >
                        {part}{' '}
                        {reading?.detected
                          ? `${Math.round(reading.strength * 100)}%`
                          : '--'}
                      </span>
                    );
                  })}
                </div>
              )}
              <p className="input-message" role="status">
                {input.status.message}
              </p>
              {connected && (
                <p className="output-count">
                  {telemetry.elements.length} pieces · {telemetry.fragments}{' '}
                  fragments · break occurs on collision
                </p>
              )}
            </div>
          </aside>
          <div
            ref={panelRef}
            className="mapping-panel"
            role="region"
            aria-label="Poster panel"
            data-dragging={isDragging}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerEnter={() => {
              hovered.current = true;
              holdPanel();
            }}
            onPointerLeave={() => {
              hovered.current = false;
              holdPanel();
            }}
          >
            <div className="panel-heading">
              <button
                className="panel-grip"
                data-drag-handle
                aria-label="Move panel"
                title="Drag the panel. Arrow keys move it; Shift moves faster."
                onKeyDown={(event) => {
                  const offset = {
                    ArrowLeft: [-1, 0],
                    ArrowRight: [1, 0],
                    ArrowUp: [0, -1],
                    ArrowDown: [0, 1],
                  }[event.key];
                  if (!offset) return;
                  event.preventDefault();
                  panelPlaced.current = true;
                  const engine = engineRef.current,
                    position = engine?.beginFixtureDrag('adjust-box');
                  if (position && engine) {
                    held.current = true;
                    const step =
                      (event.shiftKey ? 40 : 10) / projection.current.scale;
                    engine.moveFixture('adjust-box', {
                      x: position.x + offset[0] * step,
                      y: position.y + offset[1] * step,
                    });
                    if (!panelPlaced.current && !hovered.current && !menu) {
                      engine.endFixtureDrag('adjust-box');
                      held.current = false;
                    }
                  }
                }}
              >
                <Grip size={16} aria-hidden="true" />
                Poster map · px
              </button>
              <button
                className="mapping-toggle"
                aria-label="Show paths and numbers"
                aria-pressed={settings.showPaths}
                title="Trails follow poster pieces. Toggle their paths and numeric labels."
                onClick={() =>
                  setSettings((s) => ({
                    ...s,
                    showPaths: !s.showPaths,
                    showLabels: !s.showPaths,
                  }))
                }
              >
                {settings.showPaths ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="coordinate-grid">
              {['Position X', 'Position Y', 'Offset X', 'Offset Y'].map(
                (label, i) => (
                  <div className="coordinate" key={label}>
                    <span>{label}</span>
                    <output>
                      {i > 1 && values[i] >= 0.05 ? '+' : ''}
                      {(Math.abs(values[i]) < 0.05 ? 0 : values[i]).toFixed(1)}
                    </output>
                  </div>
                ),
              )}
            </div>
            <div className="control-row">
              <button
                className="download-button"
                aria-label="Download"
                aria-expanded={menu === 'download'}
                aria-haspopup="menu"
                disabled={saving}
                onClick={(event) => toggleMenu('download', event.currentTarget)}
              >
                {saving ? 'Saving…' : 'Download'}
              </button>
              <button
                className="icon-button"
                aria-label={settings.paused ? 'Resume motion' : 'Pause motion'}
                title={settings.paused ? 'Resume motion' : 'Pause motion'}
                aria-pressed={settings.paused}
                onClick={() =>
                  setSettings((s) => ({ ...s, paused: !s.paused }))
                }
              >
                {settings.paused ? (
                  <Play size={23} strokeWidth={1.5} />
                ) : (
                  <Pause size={23} strokeWidth={1.5} />
                )}
              </button>
              <button
                className={`icon-button ${connected ? 'is-active' : ''}`}
                aria-label="Motion input"
                title="Choose motion input"
                aria-expanded={menu === 'motion'}
                aria-haspopup="menu"
                onClick={(event) => toggleMenu('motion', event.currentTarget)}
              >
                <Camera size={26} strokeWidth={1.4} />
              </button>
              <button
                className="icon-button"
                aria-label="Sound"
                title={
                  input.sound === 'running' ? 'Mute sound' : 'Enable sound'
                }
                aria-pressed={input.sound === 'running'}
                onClick={input.toggleSound}
              >
                {input.sound === 'running' ? (
                  <Volume2 size={25} strokeWidth={1.4} />
                ) : (
                  <VolumeX size={25} strokeWidth={1.4} />
                )}
              </button>
            </div>
          </div>
        </>
      )}
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            className="floating-menu"
            style={{ ...menuPosition, '--active-font': font } as CSSProperties}
          >
            {menu === 'download' ? (
              <div className="popover" role="menu" aria-label="Download format">
                {(['png', 'jpg', 'pdf', 'json'] as const).map((format) => (
                  <button
                    role="menuitem"
                    key={format}
                    onClick={() => void download(format)}
                  >
                    {format === 'json'
                      ? 'Coordinates & paths · JSON'
                      : format.toUpperCase()}
                  </button>
                ))}
              </div>
            ) : (
              <div
                className="popover"
                role="menu"
                aria-label="Motion input options"
              >
                <button
                  role="menuitem"
                  onClick={() => input.startInput('body')}
                >
                  Body nodes · fixed camera
                </button>
                <button
                  role="menuitem"
                  onClick={() => input.startInput('camera')}
                >
                  Camera movement · optical flow
                </button>
                <button
                  role="menuitem"
                  onClick={() => input.startInput('sensor')}
                >
                  Device motion sensor
                </button>
                {input.source && (
                  <button role="menuitem" onClick={input.stopInput}>
                    Stop tracking
                  </button>
                )}
                <p className="connection-detail" aria-live="polite">
                  {input.status.message}
                </p>
                <p>
                  Body nodes: keep the camera fixed and your face, hands and
                  body visible. Processing stays on this device. No microphone.
                </p>
              </div>
            )}
          </div>,
          document.body,
        )}
      {about && (
        <div className="about-backdrop" onClick={() => setAbout(false)}>
          <div
            className="about-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="About"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              autoFocus
              className="close-dialog"
              aria-label="Close About"
              onClick={() => setAbout(false)}
            >
              ×
            </button>
            <h1>Poster Distorting Map</h1>
            <p>
              Upload a poster and perform with body nodes, camera movement or a
              device motion sensor.
            </p>
            <h2>Movement → result</h2>
            <p>
              Signals below 8% are filtered out. The strongest active region
              drives all poster pieces. Small gestures move pieces. Medium
              gestures bend and squash them. Body motion at 65% or more enables
              breakage on collision. A hard gesture does not split a piece until
              it hits something. Already created fragments continue moving.
            </p>
            <p>
              Input percentages express normalized node speed, not physical
              distance. Face and fingertip movements use local proportions. Keep
              the camera fixed for body nodes.
            </p>
            <h2>What do the paths measure?</h2>
            <p>
              Trails follow the centers of poster pieces, not your body or the
              laptop. X/Y is the current position; dX/dY is the offset from the
              original position; L is cumulative center travel; R is rotation; W
              is bend amplitude. Distances use analyzed poster pixels with the
              original poster’s top-left as (0,0). Panel coordinates show the
              area-weighted center of all pieces.
            </p>
            <p>
              Node colors identify body regions; trail colors identify poster
              pieces. Each piece receives a random saturated RGB trail color,
              preserved during movement and in exports. A × marks a split. New
              fragments receive their own colors.
            </p>
            <h2>Controls & privacy</h2>
            <p>
              Pause freezes poster physics and sound while camera nodes remain
              live. Drag or touch-drag the panel; arrow keys on its grip move it
              too. Turn paths off for a clean image export. JSON always includes
              the full map.
            </p>
            <p>
              Files and camera frames stay on your device. No recording, uploads
              or microphone. Tracking quality depends on lighting, visible
              landmarks and browser performance.
            </p>
          </div>
        </div>
      )}
      {notice && (
        <div className="notice" role="alert">
          <span>{notice}</span>
          <button aria-label="Dismiss message" onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      )}
    </main>
  );
}
