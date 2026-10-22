import Matter from 'matter-js';
import { canvas } from './demo';
import { clamp, shakeImpulse, clayOffset, materialResponse } from './math';
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
  warp: number;
  sharpness: number;
  compression: number;
  damage: number;
  scaleX: number;
  scaleY: number;
  strain: number;
  releaseThreshold: number;
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
  energy = 0;
  impactEnergy = 0;
  active = false;
  lastInput: MotionSample | null = null;
  onImpact?: (strength: number) => void;
  private toBreak = new Set<Entity>();
  private frame = 0;
  private peak = 0;
  private peakAge = 0;

  constructor(asset: PosterAsset, settings: Settings) {
    this.asset = asset;
    this.settings = { ...settings };
    const { width: w, height: h } = asset;
    Matter.Composite.add(this.engine.world, [
      Matter.Bodies.rectangle(w / 2, h + 40, w + 160, 80, { isStatic: true }),
      Matter.Bodies.rectangle(-40, h / 2, 80, h + 160, { isStatic: true }),
      Matter.Bodies.rectangle(w + 40, h / 2, 80, h + 160, { isStatic: true }),
      Matter.Bodies.rectangle(w / 2, -40, w + 160, 80, { isStatic: true }),
    ]);
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
        warp: 0,
        sharpness: 0,
        compression: 0,
        damage: 0,
        scaleX: 1,
        scaleY: 1,
        strain: 0,
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
            entity.element.width * 0.27,
            entity.warp + impact * Math.min(18, entity.element.width * 0.12),
          );
          entity.damage = Math.min(
            1,
            entity.damage + impact * impact * (0.1 + this.peak * 0.35),
          );
          if (
            !entity.parentId &&
            this.peak >= 0.65 &&
            this.peakAge < 1.8 &&
            speed > 3.7 &&
            entity.element.width > 20 &&
            entity.element.height > 14
          )
            this.toBreak.add(entity);
        }
      }
    });
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
        entity.element.width * 0.27,
        entity.warp + strength * Math.min(14, entity.element.width * 0.09),
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
    this.frame++;
    if (this.entities.length < 220)
      for (const entity of [...this.toBreak].slice(0, 3)) {
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
        Math.abs(entity.body.position.x) > this.asset.width * 3 ||
        Math.abs(entity.body.position.y) > this.asset.height * 3
      ) {
        Matter.Body.setPosition(entity.body, {
          x: clamp(entity.body.position.x, 5, this.asset.width - 5),
          y: clamp(entity.body.position.y, 5, this.asset.height - 5),
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
        if (entity.path.length > 120) entity.path.splice(1, 1);
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
        path: [origin, world],
        warp: 0,
        sharpness: entity.sharpness,
        compression: 0,
        damage: entity.damage * 0.5,
        scaleX: 1,
        scaleY: 1,
        strain: 1,
        releaseThreshold: 0,
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
    if (!this.active && !this.selected && !this.settings.showLabels)
      ctx.drawImage(this.asset.source, 0, 0);
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
    const scale = Math.max(1, width / 600);
    for (const entity of this.entities) {
      const selected = entity.element.id === this.selected;
      if (this.settings.showPaths && entity.path.length > 1) {
        ctx.save();
        ctx.strokeStyle = selected ? '#f4512c' : 'rgba(244,81,44,.34)';
        ctx.lineWidth = (selected ? 1.6 : 0.8) * scale;
        ctx.setLineDash(selected ? [] : [3 * scale, 3 * scale]);
        ctx.beginPath();
        entity.path.forEach((p, i) =>
          i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
        );
        ctx.stroke();
        ctx.fillStyle = '#f4512c';
        ctx.beginPath();
        ctx.arc(entity.origin.x, entity.origin.y, 2 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      if (selected) {
        ctx.save();
        ctx.strokeStyle = '#f4512c';
        ctx.lineWidth = 1.4 * scale;
        ctx.setLineDash([5 * scale, 3 * scale]);
        ctx.beginPath();
        entity.body.vertices.forEach((v, i) =>
          i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y),
        );
        ctx.closePath();
        ctx.stroke();
        if (entity.warp) {
          const points = this.deformationPoints(entity.element.id);
          ctx.setLineDash([]);
          ctx.lineWidth = 0.8 * scale;
          ctx.beginPath();
          points.forEach((p, i) =>
            i
              ? ctx.lineTo(p.after.x, p.after.y)
              : ctx.moveTo(p.after.x, p.after.y),
          );
          ctx.stroke();
          for (const p of points) {
            ctx.fillStyle = '#f4512c';
            ctx.fillRect(
              p.after.x - 2 * scale,
              p.after.y - 2 * scale,
              4 * scale,
              4 * scale,
            );
          }
        }
        ctx.restore();
      }
      if (this.settings.showLabels || selected) {
        ctx.save();
        ctx.font = `${9 * scale}px monospace`;
        ctx.textBaseline = 'top';
        const label = `${entity.element.id.toUpperCase()}  ${entity.body.position.x.toFixed(0)}, ${entity.body.position.y.toFixed(0)}`;
        const labelWidth = ctx.measureText(label).width + 10 * scale;
        const x = clamp(
            entity.body.position.x - labelWidth / 2,
            2,
            width - labelWidth - 2,
          ),
          y = clamp(
            entity.body.position.y - 12 * scale,
            2,
            height - 16 * scale,
          );
        ctx.fillStyle = selected ? '#f4512c' : '#252621';
        ctx.fillRect(x, y, labelWidth, 15 * scale);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, x + 5 * scale, y + 3 * scale);
        ctx.restore();
      }
    }
  }

  snapshot(overlays: boolean, multiplier = 2) {
    const output = canvas(
        this.asset.width * multiplier,
        this.asset.height * multiplier,
      ),
      ctx = output.getContext('2d')!;
    ctx.scale(multiplier, multiplier);
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
      input: this.lastInput,
      units: 'poster pixels',
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
