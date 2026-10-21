import test from 'node:test';
import assert from 'node:assert/strict';
import { seedBodies, stepBodies } from '../src/components/horiCubePhysics.mjs';

function seededRandom(seed = 42) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function body(x, y, vx, vy, r = 5) {
  return { x, y, vx, vy, r, size: 8, angle: 0 };
}

function energy(bodies) {
  return bodies.reduce((sum, item) => sum + item.r ** 2 * (item.vx ** 2 + item.vy ** 2), 0);
}

function assertConfined(bodies, width, height) {
  for (const item of bodies) {
    for (const key of ['x', 'y', 'vx', 'vy', 'r']) assert.ok(Number.isFinite(item[key]), key);
    assert.ok(item.x >= Math.min(item.r, width / 2) - 1e-9);
    assert.ok(item.x <= width - Math.min(item.r, width / 2) + 1e-9);
    assert.ok(item.y >= Math.min(item.r, height / 2) - 1e-9);
    assert.ok(item.y <= height - Math.min(item.r, height / 2) + 1e-9);
  }
}

test('seeding caps body count and produces small cubes with calm finite velocities', () => {
  const bodies = seedBodies(10_000, 840, 480, seededRandom());
  assert.equal(bodies.length, 10);
  assertConfined(bodies, 840, 480);
  for (const item of bodies) {
    assert.ok(item.size >= 6 && item.size <= 12);
    const speed = Math.hypot(item.vx, item.vy);
    assert.ok(speed >= 6 - 1e-9 && speed <= 10 + 1e-9);
    assert.ok(item.r >= item.size * 0.85, 'the envelope must cover the rotating cube projection');
  }
  assert.deepEqual(seedBodies(-1, 100, 100), []);
  const oversized = Array.from({ length: 100 }, (_, i) => body(10 + i * 12, 20, 0, 0));
  stepBodies(oversized, 2000, 100, 1 / 60);
  assert.equal(oversized.length, 10);
});

test('approaching cubes rebound, separate and do not gain kinetic energy', () => {
  const bodies = [body(40, 50, 10, 0), body(49.8, 50, -10, 0)];
  const before = energy(bodies);
  assert.ok(stepBodies(bodies, 200, 100, 1 / 60) > 0);
  assert.ok(bodies[0].vx < 0 && bodies[1].vx > 0);
  const afterContact = bodies[1].x - bodies[0].x;
  for (let frame = 0; frame < 20; frame++) stepBodies(bodies, 200, 100, 1 / 60);
  assert.ok(bodies[1].x - bodies[0].x > Math.max(afterContact, 10));
  assert.ok(energy(bodies) <= before + 1e-8);
});

test('an overlap that is already separating is corrected without a second bounce', () => {
  const bodies = [body(40, 50, -6, 0), body(48, 50, 6, 0)];
  assert.equal(stepBodies(bodies, 200, 100, 1 / 60), 0);
  assert.equal(bodies[0].vx, -6);
  assert.equal(bodies[1].vx, 6);
  assert.ok(bodies[1].x - bodies[0].x > 8);
});

test('identical centres recover finite positions, and walls reflect outward motion', () => {
  const overlapping = [body(50, 50, 0, 0), body(50, 50, 0, 0)];
  stepBodies(overlapping, 100, 100, 1 / 60);
  assert.ok(Math.hypot(overlapping[1].x - overlapping[0].x,
    overlapping[1].y - overlapping[0].y) > 0);
  assertConfined(overlapping, 100, 100);
  const atWall = [body(5, 5, -10, -8)];
  stepBodies(atWall, 100, 100, 1 / 60);
  assert.ok(atWall[0].vx > 0 && atWall[0].vy > 0);
  assertConfined(atWall, 100, 100);
});

test('compact phone and desktop bands stay bounded for 10,000 steps without energy growth', () => {
  for (const [count, width, height] of [[6, 320, 48], [10, 1280, 56]]) {
    const bodies = seedBodies(count, width, height, seededRandom());
    const before = energy(bodies);
    let contacts = 0;
    for (let frame = 0; frame < 10_000; frame++) {
      contacts += stepBodies(bodies, width, height, 1 / 60);
      assertConfined(bodies, width, height);
    }
    assert.ok(contacts > 0);
    assert.ok(energy(bodies) <= before + 1e-7);
  }
});

test('a host too small for all cubes remains finite and confines every centre', () => {
  const bodies = seedBodies(10, 1, 2, seededRandom());
  for (let frame = 0; frame < 500; frame++) {
    stepBodies(bodies, 1, 2, 1 / 60);
    assertConfined(bodies, 1, 2);
  }
  stepBodies(bodies, 0, Number.NaN, 1000);
  assertConfined(bodies, 1, 1);
});

test('invalid or nonpositive timesteps leave the entire input untouched', () => {
  const bodies = seedBodies(20, 400, 200, seededRandom());
  const before = structuredClone(bodies);
  for (const dt of [0, -1, Number.NaN, Infinity, undefined]) {
    assert.equal(stepBodies(bodies, 400, 200, dt), 0);
    assert.deepEqual(bodies, before);
  }
});
