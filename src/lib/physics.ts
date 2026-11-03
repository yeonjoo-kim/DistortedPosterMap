import Matter from 'matter-js';
import { PART_COLORS } from './body';
import { randomTrailColor } from './trailColor';
import { canvas } from './demo';
import {
  clamp,
  clipPolygon,
  polygonCenter,
  shakeImpulse,
  clayOffset,
  materialResponse,
  MATERIAL_MIX,
} from './math';
import { FRACTURE_SPEED_THRESHOLD } from './motion';
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
  trailColor: string;
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
    parent: Entity;
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
  private draggingFixtures = new Set<string>();
  private fractureWindow = 0;
  private fractureCooldown = 0;

  completedTrails: {
    id: string;
    path: Point[];
    end: Point;
    trailColor: string;
  }[] = [];
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
    this.engine.gravity.y = 0;
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
        { friction: 0.1, frictionAir: 0.004, restitution: 0.75 },
      );
      Matter.Body.setStatic(body, true);
      this.entities.push({
        element,
        body,
        anchor: { x: element.width / 2, y: element.height / 2 },
        origin: { x: element.x, y: element.y },
        path: [{ x: element.x, y: element.y }],
        distance: 0,
        trailColor: randomTrailColor(),
        previousPosition: { x: element.x, y: element.y },
        warp: 0,
        sharpness: 0,
        compression: 0,
        damage: 0,
        scaleX: 1,
        scaleY: 1,
        strain: 0,
        areaWeight: element.pixelArea ?? element.width * element.height,
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
        frictionAir: 0.012,
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

  beginFixtureDrag(id: string) {
    const fixture = this.fixtures.find((item) => item.id === id);
    if (!fixture) return null;
    this.draggingFixtures.add(id);
    Matter.Body.setStatic(fixture.body, true);
    return { ...fixture.body.position };
  }
  resizeFixture(id: string, box: { x: number; y: number; width: number; height: number }) {
    const fixture = this.fixtures.find((item) => item.id === id);
    if (!fixture) return;
    const offset = Matter.Vector.sub(fixture.body.position, fixture.origin);
    const angle = fixture.body.angle;
    Matter.Body.setAngle(fixture.body, 0);
    Matter.Body.scale(fixture.body, box.width / fixture.width, box.height / fixture.height);
    Matter.Body.setAngle(fixture.body, angle);
    fixture.width = box.width;
    fixture.height = box.height;
    fixture.origin = { x: box.x, y: box.y };
    Matter.Body.setPosition(fixture.body, { x: box.x + offset.x, y: box.y + offset.y });
  }
  moveFixture(id: string, position: Point) {
    const fixture = this.fixtures.find((item) => item.id === id);
    if (!fixture) return;
    const halfW = (fixture.body.bounds.max.x - fixture.body.bounds.min.x) / 2;
    const halfH = (fixture.body.bounds.max.y - fixture.body.bounds.min.y) / 2;
    Matter.Body.setPosition(fixture.body, {
      x: clamp(
        position.x,
        this.bounds.x + halfW + 4,
        this.bounds.x + this.bounds.width - halfW - 4,
      ),
      y: clamp(
        position.y,
        this.bounds.y + halfH + 4,
        this.bounds.y + this.bounds.height - halfH - 4,
      ),
    });
  }
  endFixtureDrag(id: string) {
    this.draggingFixtures.delete(id);
    const fixture = this.fixtures.find((item) => item.id === id);
    if (fixture) Matter.Body.setStatic(fixture.body, !this.active);
  }

  applyMotion(sample: MotionSample) {
    if (this.settings.paused || this.settings.original || sample.confidence <= 0) {
      this.fractureWindow = 0;
      this.toBreak.clear();
      return;
    }
    if (sample.source !== this.lastInput?.source) {
      this.peak = 0;
      this.peakAge = 0;
    }
    // Local facial/finger speed can saturate from tiny movements. Broad body
    // movement independently controls fracture; all nodes still drive movement.
    this.shake(sample.strength, sample.direction, sample.fractureStrength ?? (sample.source === 'body' ? 0 : sample.strength));
    this.lastInput = { ...sample, direction: { ...sample.direction } };
  }

  shake(amplitude = 0.55, direction: Point = { x: 0.85, y: -0.95 }, fractureStrength = amplitude) {
    if (this.settings.paused || this.settings.original) return;
    const strength = shakeImpulse(amplitude);
    const fast = shakeImpulse(fractureStrength) > FRACTURE_SPEED_THRESHOLD;
    this.fractureWindow = fast ? 0.22 : 0;
    if (!fast) {
      this.toBreak.clear();
    }
    if (strength < 0.08) return;
    this.active = true;
    this.energy = Math.max(this.energy, strength);
    if (strength > this.peak || this.peakAge > 1.8) {
      this.peak = strength;
      this.peakAge = 0;
    }
    const profile = materialResponse(strength);
    for (const { id, body } of this.fixtures) {
      if (this.draggingFixtures.has(id)) continue;
      Matter.Body.setStatic(body, false);
      Matter.Sleeping.set(body, false);
      Matter.Body.setVelocity(body, {
        x: clamp(body.velocity.x + direction.x * strength * 11, -24, 24),
        y: clamp(body.velocity.y + direction.y * strength * 9, -24, 24),
      });
      Matter.Body.setAngularVelocity(
        body,
        clamp(
          body.angularVelocity + (id.startsWith('tape-') ? (Math.random() - 0.5) * strength * 0.1 : direction.x * strength * 0.008),
          -0.035,
          0.035,
        ),
      );
    }
    for (const entity of this.entities) {
      entity.strain += strength * 0.52;
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
    if (this.settings.paused || this.settings.original) {
      this.fractureWindow = 0;
      this.toBreak.clear();
      return;
    }
    const elapsed = clamp(delta, 0, 1000) / 1000;
    const dt = clamp(delta, 0, 1000 / 60) / 1000;
    this.energy *= Math.exp(-dt * 2.5);
    this.impactEnergy *= Math.exp(-dt * 4);
    this.peakAge += dt;
    this.fractureWindow = Math.max(0, this.fractureWindow - elapsed);
    this.fractureCooldown = Math.max(0, this.fractureCooldown - elapsed);
    if (!this.active) return;
    this.engine.gravity.y = 0;
    // A weak circulating current keeps released pieces suspended without a downwards bias.
    for (const [i, entity] of this.entities.entries()) {
      if (entity.body.isStatic) continue;
      const phase = this.frame * 0.006 + i * 2.399;
      Matter.Body.applyForce(entity.body, entity.body.position, {
        x: Math.cos(phase) * entity.body.mass * 0.000006,
        y: Math.sin(phase) * entity.body.mass * 0.000006,
      });
    }
    Matter.Engine.update(this.engine, Math.max(0.1, dt * 1000));
    // Dense fragments can briefly overwhelm the collision solver. Keep controls
    // fully reachable even during those frames.
    for (const fixture of this.fixtures) this.moveFixture(fixture.id, fixture.body.position);
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
    for (const entity of this.entities) {
      const vigor = Math.max(entity.body.speed / 18, Math.abs(entity.body.angularVelocity) / 0.14);
      if (this.fractureWindow > 0 && vigor > 0.8 && !entity.body.isStatic) {
        entity.damage = Math.min(1, entity.damage + Math.min(2, vigor - 0.8) * elapsed);
        if (entity.damage >= 0.38) this.toBreak.add(entity);
      } else entity.damage *= Math.exp(-elapsed * 1.4);
    }
    this.frame++;
    if (this.entities.length < 650 && this.fractureWindow > 0 && this.fractureCooldown === 0)
      for (const entity of [...this.toBreak].filter((entity) => this.canSplit(entity)).slice(0, 1)) {
        if (this.entities.length + 1 > 650) break;
        this.fracture(entity);
        this.fractureCooldown = 1.25;
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
        const part = this.lastInput?.body?.dominant;
        entity.path.push({ ...entity.body.position, color: part ? PART_COLORS[part] : this.lastInput?.source === 'body' ? entity.path.at(-1)?.color ?? entity.trailColor : entity.trailColor });
        // Thin old samples, preserving the start and the detailed recent trail.
        if (entity.path.length > 360)
          entity.path = [
            ...entity.path.slice(0, -180).filter((_, index) => index % 2 === 0),
            ...entity.path.slice(-180),
          ];
      }
    }
  }

  private canSplit(entity: Entity) {
    return this.entities.includes(entity) && entity.element.width >= 10 &&
      entity.element.height >= 10 && entity.areaWeight >= 90;
  }

  private fracture(entity: Entity) {
    if (!this.canSplit(entity)) return;
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
      const sourceY = Math.max(0, y - 0.75), sourceH = Math.min(el.height, y + h + 0.75) - sourceY;
      textureCtx.drawImage(
        el.sprite, 0, sourceY, el.width, sourceH,
        pad + clayOffset(y, el.height, entity.warp, entity.sharpness), sourceY, el.width, sourceH,
      );
    }
    const parentAnchor = {
      x: (entity.anchor.x + pad) * entity.scaleX,
      y: entity.anchor.y * entity.scaleY,
    };
    const corners = [
      { x: 0, y: 0 },
      { x: texture.width, y: 0 },
      { x: texture.width, y: texture.height },
      { x: 0, y: texture.height },
    ];
    const fragments: Entity[] = [];
    // Find an occupied edge, including on irregular/previously chipped sprites.
    // Prefer a small chip (~6% of visible pixels), keeping the main body intact.
    const pixels = textureCtx.getImageData(0, 0, texture.width, texture.height).data;
    let total = 0;
    const step = Math.max(1, Math.floor(Math.max(texture.width, texture.height) / 140));
    for (let y = 0; y < texture.height; y += step) for (let x = 0; x < texture.width; x += step)
      total += pixels[(y * texture.width + x) * 4 + 3];
    let best: { normal: Point; offset: number; score: number } | null = null;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const cut of [0.28, 0.45, 0.65, 0.9, 1.2]) {
      const normal = { x: sx / texture.width, y: sy / texture.height };
      const offset = cut - (sx < 0 ? 1 : 0) - (sy < 0 ? 1 : 0);
      let chip = 0;
      for (let y = 0; y < texture.height; y += step) for (let x = 0; x < texture.width; x += step)
        if (x * normal.x + y * normal.y <= offset) chip += pixels[(y * texture.width + x) * 4 + 3];
      const ratio = chip / total;
      if (ratio >= 0.015 && ratio <= 0.18 && (!best || Math.abs(ratio - 0.06) < best.score))
        best = { normal, offset, score: Math.abs(ratio - 0.06) };
    }
    if (!best) { entity.damage = 0; return; }
    const triangles = [clipPolygon(corners, best.normal, best.offset), clipPolygon(corners, best.normal, best.offset, false)];
    for (let i = 0; i < triangles.length; i++) {
      const points = triangles[i];
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
      const alpha = ctx.getImageData(0, 0, sprite.width, sprite.height).data;
      let visibleArea = 0;
      for (let p = 3; p < alpha.length; p += 4) visibleArea += alpha[p] / 255;
      if (visibleArea < 1) continue;
      const centroid = polygonCenter(points);
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
          frictionAir: 0.004,
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
        trailColor: randomTrailColor(),
        previousPosition: { ...world },
        warp: 0,
        sharpness: entity.sharpness,
        compression: 0,
        damage: 0,
        scaleX: 1,
        scaleY: 1,
        strain: 1,
        releaseThreshold: 0,
        areaWeight: visibleArea,
        parentId: el.id,
        sourceMap: {
          parent: entity,
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
    if (fragments.length < 2) { entity.damage = 0; return; }
    const totalArea = fragments.reduce((sum, fragment) => sum + fragment.areaWeight, 0);
    fragments.forEach((fragment) => { fragment.areaWeight *= entity.areaWeight / totalArea; });
    this.completedTrails.push({
      id: el.id,
      trailColor: entity.trailColor,
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
    if (this.settings.original) {
      ctx.drawImage(this.asset.source, 0, 0);
      return;
    }
    if (overlays && this.active) this.drawTracking(ctx);
    if (!this.active && !this.selected) ctx.drawImage(this.asset.source, 0, 0);
    else {
      ctx.drawImage(this.asset.background, 0, 0);
      for (const entity of this.entities) {
        this.drawEntity(ctx, entity);
      }
    }

  }

  private drawEntity(ctx: CanvasRenderingContext2D, entity: Entity) {
        const { element: el, body, anchor, warp } = entity;
        ctx.save();
        ctx.translate(body.position.x, body.position.y);
        ctx.rotate(body.angle);
        ctx.scale(entity.scaleX, entity.scaleY);
        if (warp > 0.1) {
          const strip = Math.max(1, Math.ceil(el.height / 70));
          for (let y = 0; y < el.height; y += strip) {
            const h = Math.min(strip, el.height - y);
            // Overlap sampling strips to prevent antialiased seams when rotated/scaled.
            const sourceY = Math.max(0, y - 0.75), sourceH = Math.min(el.height, y + h + 0.75) - sourceY;
            ctx.drawImage(
              el.sprite, 0, sourceY, el.width, sourceH,
              -anchor.x + clayOffset(y, el.height, warp, entity.sharpness),
              sourceY - anchor.y, el.width, sourceH,
            );
          }
        } else ctx.drawImage(el.sprite, -anchor.x, -anchor.y);
        ctx.restore();
  }

  pieceSnapshots() {
    return this.entities.flatMap((entity) => {
      const { element: el, anchor, body, warp } = entity;
      const corners = [
        { x: -anchor.x - warp, y: -anchor.y }, { x: el.width - anchor.x + warp, y: -anchor.y },
        { x: el.width - anchor.x + warp, y: el.height - anchor.y }, { x: -anchor.x - warp, y: el.height - anchor.y },
      ].map((p) => ({ x: p.x * entity.scaleX * Math.cos(body.angle) - p.y * entity.scaleY * Math.sin(body.angle),
        y: p.x * entity.scaleX * Math.sin(body.angle) + p.y * entity.scaleY * Math.cos(body.angle) }));
      const minX = Math.floor(Math.min(...corners.map((p) => p.x))) - 2, minY = Math.floor(Math.min(...corners.map((p) => p.y))) - 2;
      const output = canvas(Math.ceil(Math.max(...corners.map((p) => p.x))) - minX + 2, Math.ceil(Math.max(...corners.map((p) => p.y))) - minY + 2);
      const ctx = output.getContext('2d')!;
      ctx.translate(-body.position.x - minX, -body.position.y - minY);
      this.drawEntity(ctx, entity);
      const image = ctx.getImageData(0, 0, output.width, output.height);
      let x0 = output.width, y0 = output.height, x1 = -1, y1 = -1;
      for (let y = 0; y < output.height; y++) for (let x = 0; x < output.width; x++) if (image.data[(y * output.width + x) * 4 + 3]) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      if (x1 < x0) return [];
      const cropped = canvas(x1 - x0 + 1, y1 - y0 + 1);
      cropped.getContext('2d')!.drawImage(output, x0, y0, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
      return [{ id: entity.element.id, canvas: cropped }];
    });
  }

  private drawTracking(ctx: CanvasRenderingContext2D) {
    const scale = this.annotationScale;
    const colorFor = (color: string) => this.settings.blackPaths ? '#000000' : color;
    const trace = (
      path: Point[],
      end: Point,
      color: string,
      archived = false,
    ) => {
      if (!path.length) return;
      color = colorFor(color);
      ctx.globalAlpha = archived ? 0.45 : 0.95;
      ctx.lineWidth = (archived ? 0.8 : 1.1) * scale;
      ctx.setLineDash([]);
      let previous = path[0];
      for (const point of [...path.slice(1), end]) {
        ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.lineTo(point.x, point.y);
        ctx.strokeStyle = colorFor(point.color ?? previous.color ?? color); ctx.stroke();
        previous = point;
      }
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
        trace(trail.path, trail.end, trail.trailColor, true);
      for (const entity of this.entities) {
        const { origin, body, path } = entity;
        // The dotted displacement is distinct from the actual travelled route.
        ctx.strokeStyle = colorFor(entity.path.at(-1)?.color ?? entity.trailColor);
        ctx.globalAlpha = 0.28;
        ctx.lineWidth = 0.65 * scale;
        ctx.setLineDash([3 * scale, 4 * scale]);
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(body.position.x, body.position.y);
        ctx.stroke();
        trace(path, body.position, entity.trailColor);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff9e9';
        ctx.strokeStyle = colorFor(entity.path.at(-1)?.color ?? entity.trailColor);
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
        ctx.fillStyle = colorFor(entity.path.at(-1)?.color ?? entity.trailColor);
        ctx.beginPath();
        ctx.moveTo(4 * scale, 0);
        ctx.lineTo(-3 * scale, -2.6 * scale);
        ctx.lineTo(-3 * scale, 2.6 * scale);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        if (entity.warp > 0.2 || entity.compression > 0.02) {
          const points = this.deformationPoints(entity.element.id);
          ctx.strokeStyle = colorFor(entity.path.at(-1)?.color ?? entity.trailColor);
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
    ctx.font = `${11 * scale}px ${this.active ? 'MetaAccanthisAlternate' : 'MetaAccanthis'}, sans-serif`;
    ctx.textBaseline = 'top';
    for (const entity of candidates) {
      const { body, origin } = entity;
      const lines = [
        `${entity.element.id.toUpperCase()}  X ${body.position.x.toFixed(1)}  Y ${body.position.y.toFixed(1)}`,
        `dX ${signed(body.position.x - origin.x)}  dY ${signed(body.position.y - origin.y)}`,
        `L ${entity.distance.toFixed(1)}  R ${signed((body.angle * 180) / Math.PI)}deg  W ${entity.warp.toFixed(1)}`,
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
      ctx.strokeStyle = colorFor(entity.path.at(-1)?.color ?? entity.trailColor);
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
      fragments: this.entities.filter(
        (entity) => entity.element.kind === 'fragment',
      ).length,
      fractures: this.completedTrails.length,
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
          trailColor,
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
          trailColor,
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
    return this.sourcePoint(map.parent, sourceX, sourceY);
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
        'floating material — accumulated motion and repeated fracture',
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
        trailColor: trail.trailColor,
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
