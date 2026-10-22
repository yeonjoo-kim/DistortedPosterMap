import Matter from 'matter-js';
import { canvas } from './demo';
import {
  clamp,
  shakeImpulse,
  clayOffset,
  materialResponse,
  MATERIAL_MIX,
} from './math';
import type { MotionSample } from './motion';
import type {
  ElementTelemetry,
  Point,
  PosterAsset,
  PosterElement,
  Settings,
  Telemetry,
} from './types';

interface Entity {
  element: PosterElement;
  body: Matter.Body;
  anchor: Point;
  origin: Point;
  path: Point[];
  distance: number;
  previousPosition: Point;
  warp: number;
  sharpness: number;
  compression: number;
  damage: number;
  scaleX: number;
  scaleY: number;
  strain: number;
  releaseThreshold: number;
  areaWeight: number;
  parentId?: string;
  sourceMap?: {
    clipX: number;
    clipY: number;
    pad: number;
    warp: number;
    sharpness: number;
    scaleX: number;
    scaleY: number;
    height: number;
    origin: Point;
    anchor: Point;
  };
}

export class PosterPhysics {
  engine = Matter.Engine.create({
    enableSleeping: true,
    positionIterations: 6,
  });
  asset: PosterAsset;
  entities: Entity[] = [];
  settings: Settings;
  selected: string | null = null;
  annotationLimit = 12;
  annotationScale = 1;
  completedTrails: { id: string; path: Point[]; end: Point }[] = [];
  energy = 0;
  impactEnergy = 0;
  active = false;
  lastInput: MotionSample | null = null;
  onImpact?: (strength: number) => void;
  bounds = { x: 0, y: 0, width: 0, height: 0 };
  fixtures: {
    id: string;
    body: Matter.Body;
    origin: Point;
    width: number;
    height: number;
  }[] = [];
  private walls: Matter.Body[] = [];
  private toBreak = new Set<Entity>();
  private frame = 0;
  private peak = 0;
  private peakAge = 0;

  constructor(asset: PosterAsset, settings: Settings) {
    this.asset = asset;
    this.settings = { ...settings };
    const { width: w, height: h } = asset;
    this.setBounds({ x: 0, y: 0, width: w, height: h });
    asset.elements.forEach((element, index) => {
      const body = Matter.Bodies.rectangle(
        element.x,
        element.y,
        Math.max(3, element.width - 2),
        Math.max(3, element.height - 2),
        { friction: 0.65, frictionAir: 0.035, restitution: 0.05 },
      );
      Matter.Body.setStatic(body, true);
      this.entities.push({
        element,
        body,
        anchor: { x: element.width / 2, y: element.height / 2 },
        origin: { x: element.x, y: element.y },
        path: [{ x: element.x, y: element.y }],
        distance: 0,
        previousPosition: { x: element.x, y: element.y },
        warp: 0,
        sharpness: 0,
        compression: 0,
        damage: 0,
        scaleX: 1,
        scaleY: 1,
        strain: 0,
        areaWeight: element.width * element.height,
        releaseThreshold:
          0.035 +
          (((index * 7) % Math.max(1, asset.elements.length)) /
            Math.max(1, asset.elements.length)) *
            0.3,
      });
      Matter.Composite.add(this.engine.world, body);
    });
    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      for (const pair of event.pairs) {
        const relative = Matter.Vector.sub(
          pair.bodyA.velocity,
          pair.bodyB.velocity,
        );
        const speed = Math.abs(
          Matter.Vector.dot(relative, pair.collision.normal),
        );
        const impact = clamp(speed / 13, 0, 1);
        if (impact < 0.035) continue;
        this.impactEnergy = Math.max(this.impactEnergy, impact);
        this.onImpact?.(impact * (0.35 + this.energy * 0.65));
        for (const body of [pair.bodyA, pair.bodyB]) {
          const entity = this.entities.find((e) => e.body === body);
          if (!entity || body.isStatic) continue;
          entity.compression = Math.min(
            0.47,
            entity.compression + impact * 0.36,
          );
          entity.warp = Math.min(
            entity.element.width * 0.27 * MATERIAL_MIX.zigzag,
            entity.warp +
              MATERIAL_MIX.zigzag *
                impact *
                Math.min(18, entity.element.width * 0.12),
          );
          entity.damage = Math.min(
            1,
            entity.damage +
              impact * impact * (0.1 + this.peak * MATERIAL_MIX.fracture),
          );
          if (
            !entity.parentId &&
            materialResponse(this.peak).canFracture &&
            this.peakAge < 2.8 &&
            speed > 4.5 - MATERIAL_MIX.fracture * 2.5 &&
            entity.element.width > 20 &&
            entity.element.height > 14
          )
            this.toBreak.add(entity);
        }
      }
    });
  }

  setBounds(bounds: { x: number; y: number; width: number; height: number }) {
    this.bounds = bounds;
    this.walls.forEach((body) =>
      Matter.Composite.remove(this.engine.world, body),
    );
    const { x, y, width: w, height: h } = bounds;
    this.walls = [
      Matter.Bodies.rectangle(x + w / 2, y + h + 40, w + 160, 80, {
        isStatic: true,
      }),
      Matter.Bodies.rectangle(x - 40, y + h / 2, 80, h + 160, {
        isStatic: true,
      }),
      Matter.Bodies.rectangle(x + w + 40, y + h / 2, 80, h + 160, {
        isStatic: true,
      }),
      Matter.Bodies.rectangle(x + w / 2, y - 40, w + 160, 80, {
        isStatic: true,
      }),
    ];
    Matter.Composite.add(this.engine.world, this.walls);
  }

  setFixtures(
    items: {
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }[],
  ) {
    this.fixtures.forEach(({ body }) =>
      Matter.Composite.remove(this.engine.world, body),
    );
    this.fixtures = items.map(({ id, x, y, width, height }) => {
      const body = Matter.Bodies.rectangle(x, y, width, height, {
        friction: 0.5,
        frictionAir: 0.07,
        restitution: 0.08,
      });
      Matter.Body.setStatic(body, true);
      return { id, body, origin: { x, y }, width, height };
    });
    Matter.Composite.add(
      this.engine.world,
      this.fixtures.map(({ body }) => body),
    );
  }

  applyMotion(sample: MotionSample) {
    this.shake(sample.strength, sample.direction);
    this.lastInput = { ...sample, direction: { ...sample.direction } };
  }

  shake(amplitude = 0.55, direction: Point = { x: 0.85, y: -0.95 }) {
    if (this.settings.paused || this.settings.original) return;
    const strength = shakeImpulse(amplitude);
    if (strength < 0.012) return;
    this.active = true;
    this.energy = Math.max(this.energy, strength);
    if (strength > this.peak || this.peakAge > 1.8) {
      this.peak = strength;
      this.peakAge = 0;
    }
    const profile = materialResponse(strength);
    for (const { body } of this.fixtures) {
      Matter.Body.setStatic(body, false);
      Matter.Sleeping.set(body, false);
      Matter.Body.setVelocity(body, {
        x: clamp(body.velocity.x + direction.x * strength * 11, -24, 24),
        y: clamp(body.velocity.y + direction.y * strength * 9, -24, 24),
      });
      Matter.Body.setAngularVelocity(
        body,
        clamp(
          body.angularVelocity + direction.x * strength * 0.008,
          -0.035,
          0.035,
        ),
      );
    }
    for (const entity of this.entities) {
      entity.strain += strength * 0.52;
      if (
        entity.body.isStatic &&
        strength < 0.72 &&
        entity.strain < entity.releaseThreshold
      )
        continue;
      Matter.Body.setStatic(entity.body, false);
      Matter.Sleeping.set(entity.body, false);
      entity.body.restitution = profile.restitution;
      const jitter = Math.random() - 0.5;
      Matter.Body.setVelocity(entity.body, {
        x: clamp(
          entity.body.velocity.x + (direction.x * 15 + jitter * 5) * strength,
          -30,
          30,
        ),
        y: clamp(
          entity.body.velocity.y + (direction.y * 12 + jitter * 4) * strength,
          -30,
          30,
        ),
      });
      Matter.Body.setAngularVelocity(
        entity.body,
        clamp(
          entity.body.angularVelocity +
            (Math.random() - 0.5) * strength * 0.075,
          -0.2,
          0.2,
        ),
      );
      entity.warp = Math.min(
        entity.element.width * 0.27 * MATERIAL_MIX.zigzag,
        entity.warp +
          MATERIAL_MIX.zigzag *
            strength *
            Math.min(14, entity.element.width * 0.09),
      );
      entity.sharpness = Math.max(entity.sharpness, strength);
      entity.compression = Math.min(
        0.47,
        entity.compression + strength * 0.055,
      );
    }
  }

  update(delta: number) {
    if (this.settings.paused || this.settings.original) return;
    const dt = clamp(delta, 0, 1000 / 60) / 1000;
    this.energy *= Math.exp(-dt * 2.5);
    this.impactEnergy *= Math.exp(-dt * 4);
    this.peakAge += dt;
    if (!this.active) return;
    this.engine.gravity.y = materialResponse(this.energy).gravity;
    Matter.Engine.update(this.engine, Math.max(0.1, dt * 1000));
    // Count every physics step, independently of the sampled drawing trail.
    for (const entity of this.entities) {
      const position = entity.body.position;
      const step = Math.hypot(
        position.x - entity.previousPosition.x,
        position.y - entity.previousPosition.y,
      );
      if (Number.isFinite(step)) entity.distance += step;
      entity.previousPosition = { ...position };
    }
    this.frame++;
    if (this.entities.length < 220)
      for (const entity of [...this.toBreak].slice(0, 6)) {
        if (this.entities.length + 3 > 220) break;
        this.fracture(entity);
      }
    this.toBreak.clear();
    for (const entity of this.entities) {
      entity.compression *= Math.exp(-dt * 4.2);
      entity.warp *= Math.exp(-dt * 0.065);
      entity.sharpness = Math.max(
        this.energy,
        entity.sharpness * Math.exp(-dt * 0.45),
      );
      if (!entity.body.isStatic) {
        const compression = entity.compression + entity.damage * 0.035;
        const sx = 1 + compression * 0.72,
          sy = 1 - compression * 0.62;
        if (
          Math.abs(sx - entity.scaleX) + Math.abs(sy - entity.scaleY) >
          0.001
        ) {
          const angle = entity.body.angle;
          Matter.Body.setAngle(entity.body, 0);
          Matter.Body.scale(
            entity.body,
            sx / entity.scaleX,
            sy / entity.scaleY,
          );
          Matter.Body.setAngle(entity.body, angle);
          entity.scaleX = sx;
          entity.scaleY = sy;
        }
        entity.body.restitution = materialResponse(this.energy).restitution;
      }
      if (
        !Number.isFinite(entity.body.position.x) ||
        !Number.isFinite(entity.body.position.y)
      ) {
        Matter.Body.setPosition(entity.body, entity.origin);
        Matter.Body.setVelocity(entity.body, { x: 0, y: 0 });
      } else if (
        Math.abs(entity.body.position.x - this.bounds.x) >
          this.bounds.width * 3 ||
        Math.abs(entity.body.position.y - this.bounds.y) >
          this.bounds.height * 3
      ) {
        Matter.Body.setPosition(entity.body, {
          x: clamp(
            entity.body.position.x,
            this.bounds.x + 5,
            this.bounds.x + this.bounds.width - 5,
          ),
          y: clamp(
            entity.body.position.y,
            this.bounds.y + 5,
            this.bounds.y + this.bounds.height - 5,
          ),
        });
        Matter.Body.setVelocity(entity.body, { x: 0, y: 0 });
      }
      const last = entity.path[entity.path.length - 1];
      if (
        this.frame % 4 === 0 &&
        Math.hypot(
          entity.body.position.x - last.x,
          entity.body.position.y - last.y,
        ) > 1.5
      ) {
        entity.path.push({ ...entity.body.position });
        // Thin old samples, preserving the start and the detailed recent trail.
        if (entity.path.length > 360)
          entity.path = [
            ...entity.path.slice(0, -180).filter((_, index) => index % 2 === 0),
            ...entity.path.slice(-180),
          ];
      }
    }
  }

  private fracture(entity: Entity) {
    if (!this.entities.includes(entity) || entity.parentId) return;
    const { element: el, body } = entity;
    const pad = Math.ceil(entity.warp + 2);
    const texture = canvas(
      (el.width + pad * 2) * entity.scaleX,
      el.height * entity.scaleY,
    );
    const textureCtx = texture.getContext('2d')!;
    textureCtx.scale(entity.scaleX, entity.scaleY);
    const strip = Math.max(1, Math.ceil(el.height / 70));
    for (let y = 0; y < el.height; y += strip) {
      const h = Math.min(strip, el.height - y);
      textureCtx.drawImage(
        el.sprite,
        0,
        y,
        el.width,
        h,
        pad + clayOffset(y, el.height, entity.warp, entity.sharpness),
        y,
        el.width,
        h,
      );
    }
    const parentAnchor = {
      x: (entity.anchor.x + pad) * entity.scaleX,
      y: entity.anchor.y * entity.scaleY,
    };
    const center = {
      x: texture.width * (0.4 + Math.random() * 0.2),
      y: texture.height * (0.4 + Math.random() * 0.2),
    };
    const corners = [
      { x: 0, y: 0 },
      { x: texture.width, y: 0 },
      { x: texture.width, y: texture.height },
      { x: 0, y: texture.height },
    ];
    const fragments: Entity[] = [];
    for (let i = 0; i < 4; i++) {
      const points = [corners[i], corners[(i + 1) % 4], center];
      const minX = Math.floor(Math.min(...points.map((p) => p.x))),
        minY = Math.floor(Math.min(...points.map((p) => p.y)));
      const maxX = Math.ceil(Math.max(...points.map((p) => p.x))),
        maxY = Math.ceil(Math.max(...points.map((p) => p.y)));
      const sprite = canvas(maxX - minX, maxY - minY),
        ctx = sprite.getContext('2d')!;
      ctx.beginPath();
      points.forEach((p, j) =>
        j
          ? ctx.lineTo(p.x - minX, p.y - minY)
          : ctx.moveTo(p.x - minX, p.y - minY),
      );
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(texture, -minX, -minY);
      const centroid = {
        x: points.reduce((s, p) => s + p.x, 0) / 3,
        y: points.reduce((s, p) => s + p.y, 0) / 3,
      };
      const dx = centroid.x - parentAnchor.x,
        dy = centroid.y - parentAnchor.y;
      const world = {
        x:
          body.position.x +
          dx * Math.cos(body.angle) -
          dy * Math.sin(body.angle),
        y:
          body.position.y +
          dx * Math.sin(body.angle) +
          dy * Math.cos(body.angle),
      };
      const origin = {
        x:
          entity.origin.x +
          dx / entity.scaleX -
          clayOffset(
            centroid.y / entity.scaleY,
            el.height,
            entity.warp,
            entity.sharpness,
          ),
        y: entity.origin.y + dy / entity.scaleY,
      };
      const fragmentBody = Matter.Bodies.fromVertices(
        world.x,
        world.y,
        [points],
        {
          friction: 0.35,
          frictionAir: 0.025,
          restitution: materialResponse(this.energy).restitution,
        },
      );
      Matter.Body.setAngle(fragmentBody, body.angle);
      Matter.Body.setVelocity(fragmentBody, {
        x: body.velocity.x + (Math.random() - 0.5) * 3,
        y: body.velocity.y - Math.random() * 2,
      });
      Matter.Body.setAngularVelocity(
        fragmentBody,
        body.angularVelocity + (Math.random() - 0.5) * 0.06,
      );
      const id = `${el.id}.${i + 1}`;
      fragments.push({
        element: {
          ...el,
          id,
          label: `${el.label} · ${i + 1}`,
          kind: 'fragment',
          sprite,
          width: sprite.width,
          height: sprite.height,
          x: origin.x,
          y: origin.y,
        },
        body: fragmentBody,
        anchor: { x: centroid.x - minX, y: centroid.y - minY },
        origin,
        path: [{ ...world }],
        distance: entity.distance,
        previousPosition: { ...world },
        warp: 0,
        sharpness: entity.sharpness,
        compression: 0,
        damage: entity.damage * 0.5,
        scaleX: 1,
        scaleY: 1,
        strain: 1,
        releaseThreshold: 0,
        areaWeight:
          (entity.areaWeight *
            Math.abs(
              (points[1].x - points[0].x) * (points[2].y - points[0].y) -
                (points[2].x - points[0].x) * (points[1].y - points[0].y),
            )) /
          (2 * texture.width * texture.height),
        parentId: el.id,
        sourceMap: {
          clipX: minX,
          clipY: minY,
          pad,
          warp: entity.warp,
          sharpness: entity.sharpness,
          scaleX: entity.scaleX,
          scaleY: entity.scaleY,
          height: el.height,
          origin: { ...entity.origin },
          anchor: { ...entity.anchor },
        },
      });
    }
    this.completedTrails.push({
      id: el.id,
      path: [
        ...entity.path.map((point) => ({ ...point })),
        { ...body.position },
      ],
      end: { ...body.position },
    });
    Matter.Composite.remove(this.engine.world, body);
    this.entities = this.entities.filter((e) => e !== entity);
    this.entities.push(...fragments);
    fragments.forEach((e) => Matter.Composite.add(this.engine.world, e.body));
    if (this.selected === el.id) this.selected = fragments[0].element.id;
  }

  hitTest(x: number, y: number) {
    const hit = [...this.entities]
      .reverse()
      .find((entity) =>
        Matter.Vertices.contains(entity.body.vertices, { x, y }),
      );
    return hit?.element.id || null;
  }

  render(ctx: CanvasRenderingContext2D, overlays = true) {
    const { width, height } = this.asset;
    ctx.clearRect(0, 0, width, height);
    if (this.settings.original) {
      ctx.drawImage(this.asset.source, 0, 0);
      return;
    }
    if (!this.active && !this.selected) ctx.drawImage(this.asset.source, 0, 0);
    else {
      ctx.drawImage(this.asset.background, 0, 0);
      for (const entity of this.entities) {
        const { element: el, body, anchor, warp } = entity;
        ctx.save();
        ctx.translate(body.position.x, body.position.y);
        ctx.rotate(body.angle);
        ctx.scale(entity.scaleX, entity.scaleY);
        if (warp > 0.1) {
          const strip = Math.max(1, Math.ceil(el.height / 70));
          for (let y = 0; y < el.height; y += strip) {
            const h = Math.min(strip, el.height - y);
            ctx.drawImage(
              el.sprite,
              0,
              y,
              el.width,
              h,
              -anchor.x + clayOffset(y, el.height, warp, entity.sharpness),
              y - anchor.y,
              el.width,
              h,
            );
          }
        } else ctx.drawImage(el.sprite, -anchor.x, -anchor.y);
        ctx.restore();
      }
    }
    if (!overlays) return;
    this.drawTracking(ctx);
  }

  private drawTracking(ctx: CanvasRenderingContext2D) {
    const scale = this.annotationScale;
    const trace = (path: Point[], end: Point, archived = false) => {
      if (!path.length) return;
      ctx.beginPath();
      path.forEach((point, i) =>
        i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y),
      );
      ctx.lineTo(end.x, end.y);
      ctx.strokeStyle = archived ? 'rgba(220,87,48,.35)' : 'rgba(220,87,48,.7)';
      ctx.lineWidth = (archived ? 0.8 : 1.1) * scale;
      ctx.setLineDash([]);
      ctx.stroke();
      if (archived) {
        ctx.beginPath();
        ctx.moveTo(end.x - 3 * scale, end.y - 3 * scale);
        ctx.lineTo(end.x + 3 * scale, end.y + 3 * scale);
        ctx.moveTo(end.x + 3 * scale, end.y - 3 * scale);
        ctx.lineTo(end.x - 3 * scale, end.y + 3 * scale);
        ctx.stroke();
      }
    };
    if (this.settings.showPaths) {
      ctx.save();
      for (const trail of this.completedTrails)
        trace(trail.path, trail.end, true);
      for (const entity of this.entities) {
        const { origin, body, path } = entity;
        // The dotted displacement is distinct from the actual travelled route.
        ctx.strokeStyle = 'rgba(220,87,48,.28)';
        ctx.lineWidth = 0.65 * scale;
        ctx.setLineDash([3 * scale, 4 * scale]);
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(body.position.x, body.position.y);
        ctx.stroke();
        trace(path, body.position);
        ctx.fillStyle = '#fff9e9';
        ctx.strokeStyle = '#dc5730';
        ctx.lineWidth = scale;
        ctx.beginPath();
        ctx.arc(origin.x, origin.y, 2.5 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        const previous = path.length > 1 ? path[path.length - 2] : path[0];
        const angle = Math.atan2(
          body.position.y - previous.y,
          body.position.x - previous.x,
        );
        ctx.save();
        ctx.translate(body.position.x, body.position.y);
        ctx.rotate(angle);
        ctx.fillStyle = '#dc5730';
        ctx.beginPath();
        ctx.moveTo(4 * scale, 0);
        ctx.lineTo(-3 * scale, -2.6 * scale);
        ctx.lineTo(-3 * scale, 2.6 * scale);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        if (entity.warp > 0.2 || entity.compression > 0.02) {
          const points = this.deformationPoints(entity.element.id);
          ctx.strokeStyle = 'rgba(30,137,128,.8)';
          ctx.lineWidth = 1.2 * scale;
          ctx.beginPath();
          points.forEach((point, i) =>
            i
              ? ctx.lineTo(point.after.x, point.after.y)
              : ctx.moveTo(point.after.x, point.after.y),
          );
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    if (!this.settings.showLabels) return;
    const used: { x: number; y: number; width: number; height: number }[] =
      this.fixtures.map(({ body }) => ({
        x: body.bounds.min.x,
        y: body.bounds.min.y,
        width: body.bounds.max.x - body.bounds.min.x,
        height: body.bounds.max.y - body.bounds.min.y,
      }));
    const signed = (value: number) => {
      const n = Math.abs(value) < 0.05 ? 0 : value;
      return `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
    };
    const candidates = [...this.entities]
      .sort((a, b) => b.distance - a.distance)
      .slice(0, this.annotationLimit);
    ctx.save();
    ctx.font = `${10 * scale}px monospace`;
    ctx.textBaseline = 'top';
    for (const entity of candidates) {
      const { body, origin } = entity;
      const lines = [
        `${entity.element.id.toUpperCase()}  X ${body.position.x.toFixed(1)}  Y ${body.position.y.toFixed(1)}`,
        `ΔX ${signed(body.position.x - origin.x)}  ΔY ${signed(body.position.y - origin.y)}`,
        `L ${entity.distance.toFixed(1)}  θ ${signed((body.angle * 180) / Math.PI)}°  W ${entity.warp.toFixed(1)}`,
      ];
      const width = Math.min(
        this.bounds.width - 8 * scale,
        Math.max(...lines.map((line) => ctx.measureText(line).width)) +
          12 * scale,
      );
      const height = 42 * scale;
      const locations = [
        [8, -47],
        [8, 10],
        [-width / scale - 8, -47],
        [-width / scale - 8, 10],
        [-width / scale / 2, -85],
        [-width / scale / 2, 45],
        [-width / scale / 2, -132],
        [-width / scale / 2, -179],
        [-width / scale / 2, -226],
      ];
      const boxes = locations.map(([dx, dy]) => ({
        x: clamp(
          body.position.x + dx * scale,
          this.bounds.x + 4 * scale,
          this.bounds.x + this.bounds.width - width - 4 * scale,
        ),
        y: clamp(
          body.position.y + dy * scale,
          this.bounds.y + 4 * scale,
          this.bounds.y + this.bounds.height - height - 4 * scale,
        ),
        width,
        height,
      }));
      const overlap = (box: (typeof boxes)[number]) =>
        used.reduce(
          (sum, other) =>
            sum +
            Math.max(
              0,
              Math.min(box.x + box.width, other.x + other.width) -
                Math.max(box.x, other.x),
            ) *
              Math.max(
                0,
                Math.min(box.y + box.height, other.y + other.height) -
                  Math.max(box.y, other.y),
              ),
          0,
        );
      const box = boxes.sort((a, b) => overlap(a) - overlap(b))[0];
      if (used.length && overlap(box) > width * height * 0.05) continue;
      used.push(box);
      ctx.strokeStyle = 'rgba(181,91,52,.5)';
      ctx.lineWidth = 0.7 * scale;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(body.position.x, body.position.y);
      ctx.lineTo(
        clamp(body.position.x, box.x, box.x + width),
        clamp(body.position.y, box.y, box.y + height),
      );
      ctx.stroke();
      ctx.fillStyle = 'rgba(250,255,220,.95)';
      ctx.fillRect(box.x, box.y, width, height);
      ctx.strokeRect(box.x, box.y, width, height);
      ctx.fillStyle = '#30392b';
      lines.forEach((line, i) =>
        ctx.fillText(
          line,
          box.x + 6 * scale,
          box.y + (5 + i * 12) * scale,
          width - 10 * scale,
        ),
      );
    }
    ctx.restore();
  }

  snapshot(overlays: boolean, multiplier = 2) {
    const { x, y, width, height } = this.bounds;
    const output = canvas(width * multiplier, height * multiplier),
      ctx = output.getContext('2d')!;
    ctx.fillStyle = '#f6ffbd';
    ctx.fillRect(0, 0, output.width, output.height);
    ctx.scale(multiplier, multiplier);
    ctx.translate(-x, -y);
    this.render(ctx, overlays);
    return output;
  }

  telemetry(): Telemetry {
    return {
      active: this.active,
      energy: this.energy,
      impact: this.impactEnergy,
      deformation: Math.max(
        0,
        ...this.entities.map((e) =>
          Math.min(
            1,
            e.compression * 2 + e.warp / Math.max(20, e.element.width * 0.25),
          ),
        ),
      ),
      elements: this.entities.map(
        ({
          element,
          body,
          origin,
          path,
          warp,
          compression,
          damage,
          scaleX,
          scaleY,
          areaWeight,
          distance,
        }): ElementTelemetry => ({
          id: element.id,
          label: element.label,
          x: body.position.x,
          y: body.position.y,
          originX: origin.x,
          originY: origin.y,
          dx: body.position.x - origin.x,
          dy: body.position.y - origin.y,
          rotation: (body.angle * 180) / Math.PI,
          speed: body.speed,
          warp,
          compression,
          damage,
          scaleX,
          scaleY,
          areaWeight,
          distance,
          path: path.map((p) => ({ ...p })),
        }),
      ),
    };
  }

  private sourcePoint(entity: Entity, x: number, y: number): Point {
    const map = entity.sourceMap;
    if (!map)
      return {
        x: entity.origin.x + x - entity.anchor.x,
        y: entity.origin.y + y - entity.anchor.y,
      };
    const sourceY = (map.clipY + y) / map.scaleY;
    const sourceX =
      (map.clipX + x) / map.scaleX -
      map.pad -
      clayOffset(sourceY, map.height, map.warp, map.sharpness);
    return {
      x: map.origin.x + sourceX - map.anchor.x,
      y: map.origin.y + sourceY - map.anchor.y,
    };
  }

  deformationPoints(id: string) {
    const entity = this.entities.find((e) => e.element.id === id);
    if (!entity) return [];
    return [0, 0.25, 0.5, 0.75, 1].map((t, i) => {
      const localY = entity.element.height * t - entity.anchor.y;
      const originalX = entity.element.width / 2 - entity.anchor.x;
      const localX =
        originalX +
        clayOffset(
          entity.element.height * t,
          entity.element.height,
          entity.warp,
          entity.sharpness,
        );
      const angle = entity.body.angle;
      return {
        id: `P${i}`,
        before: this.sourcePoint(
          entity,
          entity.element.width / 2,
          entity.element.height * t,
        ),
        after: {
          x:
            entity.body.position.x +
            localX * entity.scaleX * Math.cos(angle) -
            localY * entity.scaleY * Math.sin(angle),
          y:
            entity.body.position.y +
            localX * entity.scaleX * Math.sin(angle) +
            localY * entity.scaleY * Math.cos(angle),
        },
      };
    });
  }

  mapData() {
    return {
      version: 2,
      material:
        'damp clay — gravity, plastic deformation and collision fracture',
      materialMix: MATERIAL_MIX,
      bounds: { ...this.bounds },
      fixtures: this.fixtures.map(({ id, body, width, height }) => ({
        id,
        x: body.position.x,
        y: body.position.y,
        rotation: body.angle,
        width,
        height,
        breakable: false,
      })),
      input: this.lastInput,
      completedTrails: this.completedTrails.map((trail) => ({
        id: trail.id,
        path: trail.path.map((point) => ({ ...point })),
        end: { ...trail.end },
      })),
      units: 'poster pixels',
      trackingUnits: {
        coordinates: 'poster pixels; origin at original poster top-left',
        distance: 'poster pixels; center travel accumulated every physics step',
        rotation: 'degrees',
        warp: 'poster pixels; horizontal bend amplitude',
      },
      width: this.asset.width,
      height: this.asset.height,
      extraction: this.asset.method,
      settings: this.settings,
      elements: this.telemetry().elements.map((data) => {
        const entity = this.entities.find((e) => e.element.id === data.id)!;
        const vertices: Point[] = [];
        const sourceVertices: Point[] = [];
        for (let i = 0; i <= 8; i++)
          for (const edge of [0, entity.element.width]) {
            const y = (i * entity.element.height) / 8;
            const lx =
                edge -
                entity.anchor.x +
                clayOffset(
                  y,
                  entity.element.height,
                  entity.warp,
                  entity.sharpness,
                ),
              ly = y - entity.anchor.y;
            vertices.push({
              x:
                data.x +
                lx * entity.scaleX * Math.cos(entity.body.angle) -
                ly * entity.scaleY * Math.sin(entity.body.angle),
              y:
                data.y +
                lx * entity.scaleX * Math.sin(entity.body.angle) +
                ly * entity.scaleY * Math.cos(entity.body.angle),
            });
            sourceVertices.push(this.sourcePoint(entity, edge, y));
          }
        return {
          ...data,
          kind: entity.element.kind,
          parentId: entity.parentId || null,
          collisionVertices: entity.body.vertices.map((v) => ({
            x: v.x,
            y: v.y,
          })),
          deformationVertices: vertices,
          sourceVertices,
          deformationPath: this.deformationPoints(data.id),
        };
      }),
    };
  }

  dispose() {
    Matter.Events.off(this.engine, 'collisionStart');
    Matter.Composite.clear(this.engine.world, false);
    Matter.Engine.clear(this.engine);
  }
}
