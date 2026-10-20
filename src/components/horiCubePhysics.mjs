// Decorative circle envelopes for CSS 3D cubes. Coordinates are pixels and
// velocities are pixels/second; the renderer and animation clock live elsewhere.
const MAX_BODIES = 40;
const RESTITUTION = 0.95;
const EPSILON = 1e-9;

function dimension(value) {
  return Math.max(1, Number.isFinite(value) ? value : 1);
}

function confine(body, width, height) {
  const rx = Math.min(body.r, width / 2);
  const ry = Math.min(body.r, height / 2);
  if (body.x < rx) {
    body.x = rx;
    if (body.vx < 0) body.vx = -body.vx;
  } else if (body.x > width - rx) {
    body.x = width - rx;
    if (body.vx > 0) body.vx = -body.vx;
  }
  if (body.y < ry) {
    body.y = ry;
    if (body.vy < 0) body.vy = -body.vy;
  } else if (body.y > height - ry) {
    body.y = height - ry;
    if (body.vy > 0) body.vy = -body.vy;
  }
}

export function seedBodies(count, width, height, random = Math.random) {
  width = dimension(width);
  height = dimension(height);
  count = Math.min(MAX_BODIES, Math.max(0, Math.floor(Number.isFinite(count) ? count : 0)));
  const randomSource = typeof random === 'function' ? random : Math.random;
  const rnd = () => {
    const value = Number(randomSource());
    return Number.isFinite(value) ? Math.max(0, Math.min(1 - Number.EPSILON, value)) : 0.5;
  };
  const bodies = [];
  for (let i = 0; i < count; i++) {
    const size = 6 + rnd() * 6;
    const r = Math.max(0.25, Math.min(size * 0.76, width / 2, height / 2));
    let x = width / 2;
    let y = height / 2;
    // Placement attempts are bounded even when a tiny host cannot fit all cubes.
    for (let attempt = 0; attempt < 64; attempt++) {
      x = r + rnd() * Math.max(0, width - 2 * r);
      y = r + rnd() * Math.max(0, height - 2 * r);
      if (bodies.every(other => Math.hypot(other.x - x, other.y - y) >= other.r + r + 1)) break;
    }
    const heading = rnd() * Math.PI * 2;
    const speed = 6 + rnd() * 9;
    bodies.push({ x, y, vx: Math.cos(heading) * speed, vy: Math.sin(heading) * speed,
      r, size, angle: rnd() * Math.PI * 2 });
  }
  return bodies;
}

// Mutates the array and bodies, returning the number of approaching contacts.
// The hard cap also bounds accidental callers to 1,560 pair checks per step.
export function stepBodies(bodies, width, height, dt) {
  if (!Array.isArray(bodies) || !Number.isFinite(dt) || dt <= 0) return 0;
  width = dimension(width);
  height = dimension(height);
  if (bodies.length > MAX_BODIES) bodies.length = MAX_BODIES;
  // The controller normally supplies a fixed timestep. A resumed tab must not
  // inject a large catch-up step if the controller passes elapsed time instead.
  dt = Math.min(dt, 1 / 30);
  for (const body of bodies) {
    body.r = Math.max(0.25, Math.min(12, width / 2, height / 2,
      Number.isFinite(body.r) ? body.r : 4));
    if (!Number.isFinite(body.x)) body.x = width / 2;
    if (!Number.isFinite(body.y)) body.y = height / 2;
    // Normal collision velocities stay well below this defensive bound.
    body.vx = Number.isFinite(body.vx) ? Math.max(-60, Math.min(60, body.vx)) : 0;
    body.vy = Number.isFinite(body.vy) ? Math.max(-60, Math.min(60, body.vy)) : 0;
    body.x += body.vx * dt;
    body.y += body.vy * dt;
    confine(body, width, height);
  }
  let collisions = 0;
  // At most forty bodies make direct pairs cheaper and simpler than allocating
  // hash grids every frame. Two gentle position passes reduce persistent overlap.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const limit = a.r + b.r;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared >= limit * limit) continue;
        const distance = Math.sqrt(distanceSquared);
        let nx;
        let ny;
        if (distance > EPSILON) {
          nx = dx / distance;
          ny = dy / distance;
        } else {
          const rvx = a.vx - b.vx;
          const rvy = a.vy - b.vy;
          const relativeSpeed = Math.hypot(rvx, rvy);
          if (relativeSpeed > EPSILON) {
            nx = rvx / relativeSpeed;
            ny = rvy / relativeSpeed;
          } else {
            const angle = ((i * 73856093 + j * 19349663) % 6283) / 1000;
            nx = Math.cos(angle);
            ny = Math.sin(angle);
          }
        }
        const invA = 1 / (a.r * a.r);
        const invB = 1 / (b.r * b.r);
        const inverseMass = invA + invB;
        const correction = Math.max(0, limit - distance - 0.01) * 0.7 / inverseMass;
        a.x -= nx * correction * invA;
        a.y -= ny * correction * invA;
        b.x += nx * correction * invB;
        b.y += ny * correction * invB;
        const relativeNormal = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        // Already separating neighbours only receive position correction.
        if (relativeNormal < -EPSILON) {
          const impulse = -(1 + RESTITUTION) * relativeNormal / inverseMass;
          a.vx -= impulse * nx * invA;
          a.vy -= impulse * ny * invA;
          b.vx += impulse * nx * invB;
          b.vy += impulse * ny * invB;
          collisions++;
        }
      }
    }
    for (const body of bodies) confine(body, width, height);
  }
  return collisions;
}
