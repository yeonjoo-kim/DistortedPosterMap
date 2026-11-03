import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  Grip,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { CropDialog } from './CropDialog';
import { extractElements, loadPoster } from './lib/extract';
import { exportPieces, exportPoster } from './lib/export';
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
    [showReadings, setShowReadings] = useState(false),
    [chooseInput, setChooseInput] = useState(false),
    [isDragging, setIsDragging] = useState(false);
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS }),
    [telemetry, setTelemetry] = useState(empty);
  const [resetVersion, setResetVersion] = useState(0),
    [menu, setMenu] = useState<'setting' | 'motion' | 'download' | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 12, top: 12 }),
    [dropActive, setDropActive] = useState(false),
    [videoRatio, setVideoRatio] = useState(16 / 9);
  const [pendingPoster, setPendingPoster] = useState<{ asset: PosterAsset; name: string } | null>(null);
  const previewRef = useRef<HTMLElement>(null), tapeRefs = useRef<(HTMLImageElement | null)[]>([]);
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

  const fixtureNodes = () => [
    { id: 'wordmark', node: wordmarkRef.current },
    { id: 'about', node: aboutRef.current },
    { id: 'adjust-box', node: panelRef.current },
    { id: 'camera-preview', node: previewRef.current },
    ...tapeRefs.current.map((node, i) => ({ id: `tape-${i}`, node })),
  ];
  function restart() {
    setMenu(null);
    panelPlaced.current = false;
    hovered.current = false;
    drag.current = null;
    setIsDragging(false);
    setTelemetry(empty);
    setShowReadings(false);
    setSettings({ ...DEFAULT_SETTINGS });
    setResetVersion((version) => version + 1);
  }
  function togglePath() {
    const active = settings.showPaths && settings.blackPaths;
    setShowReadings(false);
    setSettings((state) => ({ ...state, showPaths: !active, blackPaths: true, showLabels: false }));
  }
  function toggleData() {
    setShowReadings(!showReadings);
    setSettings((state) => ({ ...state, showPaths: !showReadings, blackPaths: false, showLabels: false }));
  }
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
      panelRef.current?.parentElement?.style.setProperty('--panel-height', `${panelRef.current.offsetHeight}px`);
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
        fixtureNodes().flatMap(
          ({ id, node }) => {
            if (!node) return [];
            node.style.transform = '';
            const box = node.getBoundingClientRect();
            return [
              {
                id,
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
    // Status, toggles and the alternate font can resize controls during a performance.
    const fixtureObserver = new ResizeObserver(() => {
      panelRef.current?.parentElement?.style.setProperty('--panel-height', `${panelRef.current.offsetHeight}px`);
      for (const node of [panelRef.current, previewRef.current]) {
        if (!node) continue;
        const transform = node.style.transform;
        node.style.transform = '';
        const box = node.getBoundingClientRect(), { left, top, scale } = projection.current;
        node.style.transform = transform;
        engine.resizeFixture(node === previewRef.current ? 'camera-preview' : 'adjust-box', {
          x: (box.left + box.width / 2 - left) / scale,
          y: (box.top + box.height / 2 - top) / scale,
          width: box.width / scale, height: box.height / scale,
        });
      }
    });
    if (previewRef.current) fixtureObserver.observe(previewRef.current);
    if (panelRef.current) fixtureObserver.observe(panelRef.current);
    let frame = 0,
      last = performance.now(),
      lastUi = 0;
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
      fixtureNodes().forEach(
        ({ id, node }) => {
          const fixture = engine.fixtures.find((item) => item.id === id);
          if (node && fixture)
            node.style.transform = `translate(${(fixture.body.position.x - fixture.origin.x) * scale}px,${(fixture.body.position.y - fixture.origin.y) * scale}px) rotate(${fixture.body.angle}rad)`;
        },
      );
      driveSound(engine.energy);
      if (now - lastUi > 110) {
        const data = engine.telemetry();
        setTelemetry(data);
        lastUi = now;
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      fixtureObserver.disconnect();
      window.removeEventListener('resize', layout);
      fixtureNodes().forEach(
        ({ node }) => {
          if (node) node.style.transform = '';
        },
      );
      engine.dispose();
      engineRef.current = null;
    };
  }, [asset, resetVersion, driveSound, impactSound]);

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
    if (!about) return;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAbout(false);
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
  }, [about]);

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
      setPendingPoster({ asset: next, name: file.name });
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
  function useCrop(source: HTMLCanvasElement) {
    if (!pendingPoster) return;
    const next = extractElements(source, 'normal');
    next.pageCount = pendingPoster.asset.pageCount;
    panelPlaced.current = false;
    setTelemetry(empty);
    setName(pendingPoster.name);
    setAsset(next);
    setPendingPoster(null);
    setShowReadings(false);
    setSettings({ ...DEFAULT_SETTINGS });
  }
  useEffect(() => {
    if (!asset) return;
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 && matchMedia('(pointer: coarse)').matches);
    if (mobile) setChooseInput(true);
    else input.startInput('body');
  }, [asset, input.startInput]);
  async function download(format: 'jpg' | 'pdf' | 'pieces') {
    const engine = engineRef.current;
    if (!engine) return;
    setMenu(null);
    setSaving(true);
    setNotice('');
    try {
      if (format === 'pieces') await exportPieces(engine, name);
      else await exportPoster(engine, format, name, settings.showPaths, 2);
    } catch {
      setNotice('Unable to export this poster. Please try again.');
    } finally {
      setSaving(false);
    }
  }
  function toggleMenu(next: 'setting' | 'motion' | 'download', button: HTMLButtonElement) {
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
    panelPlaced.current = true;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    holdPanel();
  }
  const body = input.sample?.body,
    nodes = new Map(body?.nodes.map((node) => [node.id, node]) ?? []);
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
          {!asset && <button
            className={`upload-button ${asset ? 'replace-upload' : ''}`}
            aria-label="Upload poster"
            title="Upload PDF, JPG or PNG"
            disabled={loading}
            onClick={() => fileRef.current?.click()}
          >
            <img src="/design/upload.svg" alt="" />
          </button>}
          {loading && (
            <span className="loading-indicator" role="status">
              Opening poster…
            </span>
          )}
          {['coral', 'blue', 'pink', 'green'].map((color, i) => (
            <img
              key={color}
              ref={(node) => { tapeRefs.current[i] = node; }}
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
            ref={previewRef}
            className="input-preview"
            onPointerEnter={() => engineRef.current?.beginFixtureDrag('camera-preview')}
            onPointerLeave={() => engineRef.current?.endFixtureDrag('camera-preview')}
            aria-label="Motion input"
            style={{ '--video-ratio': videoRatio } as CSSProperties}
            data-source={input.source}
            data-testid="motion-status"
            data-state={input.status.state}
          >
            <div className="video-window">
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
              {showReadings && input.source === 'body' && body && (
                <svg
                  className="node-overlay"
                  viewBox={`0 0 ${videoRatio} 1`}
                  preserveAspectRatio="xMidYMid meet"
                  aria-label="Tracked body nodes"
                >
                  {BODY_LINKS.map(([a, b]) => {
                    const first = nodes.get(a),
                      second = nodes.get(b);
                    return first && second ? (
                      <line
                        key={`${a}-${b}`}
                        x1={(1 - first.x) * videoRatio}
                        y1={first.y}
                        x2={(1 - second.x) * videoRatio}
                        y2={second.y}
                        stroke={PART_COLORS[first.part]}
                      />
                    ) : null;
                  })}
                  {body.nodes.map((node) => (
                    <circle
                      key={node.id}
                      data-part={node.part}
                      cx={(1 - node.x) * videoRatio}
                      cy={node.y}
                      r={node.strength > 0.35 ? 0.007 : 0.0045}
                      fill={PART_COLORS[node.part]}
                    />
                  ))}
                </svg>
              )}
            </div>
          </aside>
          <div
            ref={panelRef}
            className="mapping-panel"
            role="region"
            aria-label="Poster panel"
            data-dragging={isDragging}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              const offset = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
              if (!offset) return;
              event.preventDefault();
              panelPlaced.current = true;
              const engine = engineRef.current, position = engine?.beginFixtureDrag('adjust-box');
              if (engine && position) { held.current = true; const step = (event.shiftKey ? 40 : 10) / projection.current.scale;
                engine.moveFixture('adjust-box', { x: position.x + offset[0] * step, y: position.y + offset[1] * step }); }
            }}
            onLostPointerCapture={(event) => { if (drag.current?.id === event.pointerId) endDrag(event); }}
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
            <span className="panel-grip" data-drag-handle aria-hidden="true"><Grip size={16} /></span>
            {showReadings && (
              <div className="panel-data" aria-label="Motion data">
                <div className="part-presence" aria-label="Detected body parts">
                  {input.source === 'body' ? Object.keys(PART_COLORS).map((part) => {
                    const reading = body?.parts.find((value) => value.part === part);
                    return <span key={part} data-detected={!!reading?.detected} data-part={part}
                      style={{ '--part-color': PART_COLORS[part as keyof typeof PART_COLORS] } as CSSProperties}>
                      {part} {reading?.detected ? `${Math.round(reading.strength * 100)}%` : '—'}
                    </span>;
                  }) : input.source === 'sensor' && input.sample?.confidence
                    ? <span data-detected="true">Motion {Math.round(input.sample.strength * 100)}%</span> : null}
                </div>
              </div>
            )}
            <div className="panel-controls">
              <button className="download-button" aria-label="Path" aria-pressed={settings.showPaths && settings.blackPaths} onClick={togglePath}>Path</button>
              <button className="download-button" aria-label="Data" aria-pressed={showReadings} onClick={toggleData}>Data</button>
              <button className="download-button" aria-label="Download" aria-expanded={menu === 'download'} aria-haspopup="menu" disabled={saving}
                onClick={(event) => toggleMenu('download', event.currentTarget)}>{saving ? 'Saving…' : 'Download'}</button>
              <button className="icon-button" aria-label={settings.paused ? 'Resume motion' : 'Pause motion'}
                aria-pressed={settings.paused} onClick={() => setSettings((state) => ({ ...state, paused: !state.paused }))}>
                {settings.paused ? <Play size={23} strokeWidth={1.5} /> : <Pause size={23} strokeWidth={1.5} />}
              </button>
              <button className="icon-button" aria-label="Setting" title="Movement and sound settings" aria-expanded={menu === 'setting' || menu === 'motion'} aria-haspopup="menu"
                onClick={(event) => toggleMenu('setting', event.currentTarget)}><Activity size={26} strokeWidth={1.4} /></button>
              <button className="restart-button" aria-label="Restart" title="Start again with this poster" onClick={restart}><img src="/design/upload.svg" alt="" /></button>
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
                {(['jpg', 'pdf', 'pieces'] as const).map((format) => (
                  <button
                    role="menuitem"
                    key={format}
                    onClick={() => void download(format)}
                  >
                    {format === 'pieces' ? 'Separate PNGs · ZIP' : format.toUpperCase()}
                  </button>
                ))}
              </div>
            ) : menu === 'setting' ? (
              <div className="popover" role="menu" aria-label="Settings">
                <button role="menuitem" onClick={input.toggleSound}>
                  {input.sound === 'running' ? <Volume2 size={18} /> : <VolumeX size={18} />} Sound {input.sound === 'running' ? 'ON' : 'OFF'}
                </button>
                <button role="menuitem" aria-haspopup="menu" onClick={() => setMenu('motion')}>Motion detection</button>
                <button role="menuitem" onClick={() => { setMenu(null); fileRef.current?.click(); }}>Change poster</button>
              </div>
            ) : (
              <div className="popover" role="menu" aria-label="Motion input options">
                <button role="menuitem" onClick={() => { input.startInput('body'); setMenu(null); }}>Body Nodes</button>
                <button role="menuitem" onClick={() => { input.startInput('sensor'); setMenu(null); }}>Device Motion Sensor</button>
              </div>
            )}
          </div>,
          document.body,
        )}
      {pendingPoster && <CropDialog key={pendingPoster.name + loadId.current} source={pendingPoster.asset.source} onApply={useCrop} onCancel={() => setPendingPoster(null)} />}
      {chooseInput && <div className="about-backdrop">
        <section className="about-dialog input-choice" role="dialog" aria-modal="true" aria-label="Choose motion input">
          <h1>How will you move?</h1>
          <p>Use your body in front of the camera, or move your device.</p>
          <button autoFocus className="download-button" onClick={() => { setChooseInput(false); input.startInput('body'); }}>Body Nodes</button>
          <button className="download-button" onClick={() => { setChooseInput(false); input.startInput('sensor'); }}>Device Motion Sensor</button>
        </section>
      </div>}
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
            <ol>
              <li>There is a distance between what a map refers to and how it is represented.</li>
              <li>A map reveals spatial relationships.</li>
            </ol>
            <p>I see these two qualities of maps reflected in posters. A poster is a medium that speaks of an event or an occasion, yet it cannot stand for the event or occasion itself. A poster is also the outcome of spatial relationships: it is made through careful consideration of the distances, sizes, angles, and colors of its graphic elements. In this sense, the poster is an emblematic medium of design, one that usually reaches completion through this process.</p>
            <p>Lately, I have been thinking a great deal about “standards.”</p>
            <p>While learning design within the setting of a “school,”<br />while making books and posters for public audiences,<br />while experiencing the designer’s role as a technician expected to conceal the self,<br />and while noticing that I no longer try anything beyond what a client asks for.</p>
            <p>Then, recently, two things happened. One day, after attending a wedding, I met my closest colleague while still dressed formally from head to toe—a conventionally put-together version of myself. He looked at me and said, unexpectedly, “Don’t become a K-designer.” Looking back, I think I appeared to him as a “specimen,” equipped with all the things adults are supposed to have in place, and he was warning me that I might drift further and further down that path. I wondered whether his words might also describe the tendencies—or the early signs of them—in my everyday life and in the design I have been doing.</p>
            <p>The other event was attending a very loud live music performance. As someone who does not like noise, I found the experience far removed from my everyday life. More than that, it gave me a synesthetic sense of what it means to use the human “body” to “express dramatically.” It sparked my interest in actively visualizing the body by using it in new ways.</p>
            <p>These two turning points led me to make a website where I could shake up and mix these standards—or the things I am still wondering whether to call standards.</p>
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
