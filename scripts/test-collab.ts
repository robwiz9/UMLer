/**
 * Collaboration patch and room-server checks.
 *
 * The server tests run a real WebSocket room on an ephemeral port. They exercise
 * the user-visible rule: overlapping field confirmations resolve to the action
 * the room accepts last, while edits to different fields both survive.
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { ER_COMMERCE, UML_CLASS_PAYMENTS } from "../src/fixtures/index.ts";
import type { SceneDocument } from "../src/model/scene.ts";
import type { ImageAsset } from "../src/model/nodes.ts";
import { asAssetId } from "../src/model/ids.ts";
import type {
  CollabProject,
  ServerMessage,
  ServerUser,
} from "../src/collab/protocol.ts";
import { withSelfPresence } from "../src/collab/protocol.ts";
import { applyPatches, diffProject, ProjectReplica } from "../src/collab/patch.ts";
import { deriveRoomKey } from "../src/collab/room-key.ts";
import { cameraForWorldCenter, worldCenterForCamera } from "../src/canvas/camera.ts";
import { createCollabServer, roomAdministratorKey } from "../server/collab/server.ts";
import type { RoomSnapshot, SnapshotStore } from "../server/collab/redis.ts";
import type { BlobRef, BlobStore } from "../server/collab/blob.ts";

let checks = 0;
const check = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  checks += 1;
};

const clone = <T>(value: T): T => structuredClone(value) as T;

const project = (): CollabProject => ({
  scenes: [clone(ER_COMMERCE), clone(UML_CLASS_PAYMENTS)],
  assets: {},
});

const sceneWith = (
  source: SceneDocument,
  mutate: (scene: SceneDocument) => void,
): SceneDocument => {
  const next = clone(source);
  mutate(next);
  return next;
};

// --- patch round trips -----------------------------------------------------
{
  const before = project();
  check(diffProject(before, clone(before)).length === 0, "identical projects produce no patches");

  const after = project();
  const customers = after.scenes[0] as SceneDocument;
  const node = customers.nodes.customers;
  check(node !== undefined, "fixture customer node exists");
  const changed = sceneWith(customers, (scene) => {
    const target = scene.nodes.customers;
    if (target === undefined) throw new Error("missing customer");
    (target as { name: string }).name = "CustomersRenamed";
    (target as { frame: { x: number } }).frame = { ...target.frame, x: target.frame.x + 9 };
  });
  const withChanged = clone(before);
  (withChanged.scenes as SceneDocument[])[0] = changed;
  const patches = diffProject(before, withChanged);
  check(patches.length > 0, "field changes produce patches");
  const applied = applyPatches(before, patches);
  check(
    JSON.stringify(applied) === JSON.stringify(withChanged),
    "patches reproduce the changed project",
  );
}

// Same field: the second patch (server order) wins.
{
  const before = project();
  const alice = clone(before);
  const bob = clone(before);
  (alice.scenes as SceneDocument[])[0] = sceneWith(alice.scenes[0] as SceneDocument, (scene) => {
    (scene.meta as { title: string }).title = "Alice";
  });
  (bob.scenes as SceneDocument[])[0] = sceneWith(bob.scenes[0] as SceneDocument, (scene) => {
    (scene.meta as { title: string }).title = "Bob";
  });
  const replica = new ProjectReplica(before);
  const alicePatches = diffProject(before, alice);
  const bobPatches = diffProject(before, bob);
  check(replica.apply(1, alicePatches), "first action applies");
  check(replica.apply(2, bobPatches), "second action applies");
  check(
    (replica.snapshot().project.scenes[0] as SceneDocument).meta.title === "Bob",
    "the last accepted same-field action wins",
  );
  check(!replica.apply(2, alicePatches), "an older sequence cannot overwrite a newer one");
}

// Different fields in the same scene both survive.
{
  const before = project();
  const alice = clone(before);
  const bob = clone(before);
  (alice.scenes as SceneDocument[])[0] = sceneWith(alice.scenes[0] as SceneDocument, (scene) => {
    const node = scene.nodes.customers;
    if (node === undefined) throw new Error("missing customer");
    (node as { name: string }).name = "AliceName";
  });
  (bob.scenes as SceneDocument[])[0] = sceneWith(bob.scenes[0] as SceneDocument, (scene) => {
    const node = scene.nodes.customers;
    if (node === undefined) throw new Error("missing customer");
    (node as { frame: { width: number } }).frame = {
      ...node.frame,
      width: node.frame.width + 9,
    };
  });
  const merged = applyPatches(applyPatches(before, diffProject(before, alice)), diffProject(before, bob));
  const node = (merged.scenes[0] as SceneDocument).nodes.customers;
  const originalNode = (before.scenes[0] as SceneDocument).nodes.customers;
  check(node?.name === "AliceName", "the local field edit survives");
  check(
    node !== undefined && originalNode !== undefined &&
      node.frame.width === originalNode.frame.width + 9,
    "the other field edit survives",
  );
}

// The sender updates its own presence locally; the server broadcasts presence
// to the other clients only, so a scene change must not leave a stale self row.
{
  const users: ServerUser[] = [
    {
      clientId: "self",
      user: { id: "alice", name: "Alice", color: "#f00" },
      sceneId: "scene_a",
      cursor: null,
      selection: null,
      editing: null,
      joinedAt: 1,
    },
    {
      clientId: "other",
      user: { id: "bob", name: "Bob", color: "#00f" },
      sceneId: "scene_a",
      cursor: null,
      selection: null,
      editing: null,
      joinedAt: 2,
    },
  ];
  const moved = withSelfPresence(users, "self", "scene_b", null, null);
  check(
    moved.find((entry) => entry.clientId === "self")?.sceneId === "scene_b",
    "the sender's own presence follows its new scene",
  );
  check(
    moved.find((entry) => entry.clientId === "other")?.sceneId === "scene_a",
    "updating the sender's presence leaves other users alone",
  );
  check(
    withSelfPresence(moved, "self", "scene_b", null, null) === moved,
    "unchanged local presence keeps the same list",
  );
}

// Following another user keeps the observer's zoom and centres their world
// viewport centre.
{
  const viewport = { width: 1000, height: 600 };
  const center = { x: 120, y: 80 };
  const camera = cameraForWorldCenter(center, viewport, 2);
  check(
    camera.x === viewport.width / 2 - center.x * 2 &&
      camera.y === viewport.height / 2 - center.y * 2,
    "view-as centres the followed world point at the local zoom",
  );
  const roundTrip = worldCenterForCamera(camera, viewport, 2);
  check(
    roundTrip.x === center.x && roundTrip.y === center.y,
    "camera and world-centre helpers round trip",
  );
}

// Row add/remove/reorder by id.
{
  const before = project();
  const after = clone(before);
  const scene = after.scenes[0] as SceneDocument;
  const table = scene.nodes.customers;
  if (table === undefined || table.kind !== "table") throw new Error("missing table");
  const section = table.sections[0];
  if (section === undefined) throw new Error("missing section");
  (scene.nodes.customers as unknown as { sections: unknown[] }).sections = [
    {
      ...section,
      rows: [section.rows[1], section.rows[0], ...section.rows.slice(2)].filter(
        (row): row is NonNullable<typeof row> => row !== undefined,
      ),
    },
    ...table.sections.slice(1),
  ];
  const patches = diffProject(before, after);
  const applied = applyPatches(before, patches);
  check(
    JSON.stringify(applied) === JSON.stringify(after),
    "row reorder patches reproduce the table",
  );
}

// --- room server -----------------------------------------------------------
class TestClient {
  readonly ws: WebSocket;
  private readonly queue: ServerMessage[] = [];
  private readonly waiters: {
    readonly predicate: (message: ServerMessage) => boolean;
    readonly resolve: (message: ServerMessage) => void;
    readonly reject: (error: Error) => void;
    readonly timer: NodeJS.Timeout;
  }[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on("message", (data) => {
      let parsed: ServerMessage;
      try {
        parsed = JSON.parse(data.toString()) as ServerMessage;
      } catch {
        return;
      }
      this.queue.push(parsed);
      this.flush();
    });
  }

  open(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  next(
    predicate: (message: ServerMessage) => boolean,
    timeoutMs = 3000,
  ): Promise<ServerMessage> {
    const index = this.queue.findIndex(predicate);
    if (index >= 0) {
      const [message] = this.queue.splice(index, 1);
      return Promise.resolve(message as ServerMessage);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiterIndex = this.waiters.findIndex((entry) => entry.resolve === resolve);
        if (waiterIndex >= 0) this.waiters.splice(waiterIndex, 1);
        reject(new Error("Timed out waiting for a collaboration message."));
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  close(): void {
    this.ws.close();
  }

  private flush(): void {
    for (let index = 0; index < this.waiters.length; index += 1) {
      const waiter = this.waiters[index];
      if (waiter === undefined) continue;
      const messageIndex = this.queue.findIndex(waiter.predicate);
      if (messageIndex < 0) continue;
      const [message] = this.queue.splice(messageIndex, 1);
      clearTimeout(waiter.timer);
      this.waiters.splice(index, 1);
      index -= 1;
      waiter.resolve(message as ServerMessage);
    }
  }
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

class MemorySnapshots implements SnapshotStore {
  readonly kind = "memory-redis";
  readonly snapshots = new Map<string, RoomSnapshot>();

  async load(roomId: string): Promise<RoomSnapshot | null> {
    const snapshot = this.snapshots.get(roomId);
    return snapshot === undefined ? null : clone(snapshot);
  }

  async save(roomId: string, snapshot: RoomSnapshot): Promise<void> {
    this.snapshots.set(roomId, clone(snapshot));
  }

  async delete(roomId: string): Promise<void> {
    this.snapshots.delete(roomId);
  }
}

class MemoryBlobs implements BlobStore {
  readonly kind = "memory-blob";
  readonly objects = new Map<string, Uint8Array>();
  puts = 0;

  async put(key: string, bytes: Uint8Array): Promise<BlobRef> {
    this.puts += 1;
    this.objects.set(key, new Uint8Array(bytes));
    return { key, url: `memory://${key}` };
  }

  async get(ref: BlobRef): Promise<Uint8Array | null> {
    const bytes = this.objects.get(ref.key);
    return bytes === undefined ? null : new Uint8Array(bytes);
  }

  async delete(keys: readonly string[]): Promise<void> {
    for (const key of keys) this.objects.delete(key);
  }

  async sweep(): Promise<void> {
    // The test store does not age objects.
  }
}


const cacheDir = await mkdtemp(join(tmpdir(), "umler-collab-"));
const room = "test-room";
const baseProject = project();

const server = await createCollabServer({
  port: 0,
  host: "127.0.0.1",
  cacheDir,
  ttlMs: 60_000,
  adminCode: "",
});
const url = `ws://127.0.0.1:${server.port}/room/${encodeURIComponent(room)}`;

const alice = new TestClient(url);
const bob = new TestClient(url);
try {
  await alice.open();
  alice.send({
    type: "join",
    user: { id: "alice", name: "Alice", login: "alice", color: "#f00" },
    sceneId: (baseProject.scenes[0] as SceneDocument).id,
    seed: baseProject,
  });
  const aliceWelcome = await alice.next((message) => message.type === "welcome");
  check(aliceWelcome.type === "welcome", "first client receives a welcome");
  if (aliceWelcome.type !== "welcome") throw new Error("unreachable");
  check(aliceWelcome.seq === 0, "seeded room starts at sequence zero");

  await bob.open();
  bob.send({
    type: "join",
    user: { id: "bob", name: "Bob", login: "bob", color: "#00f" },
    sceneId: (baseProject.scenes[0] as SceneDocument).id,
  });
  const bobWelcome = await bob.next((message) => message.type === "welcome");
  check(bobWelcome.type === "welcome", "second client receives a welcome");
  if (bobWelcome.type !== "welcome") throw new Error("unreachable");
  check(bobWelcome.users.length === 2, "both collaborators are listed");
  check(aliceWelcome.leaderId === aliceWelcome.selfId, "the first client leads");

  const aliceTitle = sceneWith(baseProject.scenes[0] as SceneDocument, (scene) => {
    (scene.meta as { title: string }).title = "Alice title";
  });
  const bobTitle = sceneWith(baseProject.scenes[0] as SceneDocument, (scene) => {
    (scene.meta as { title: string }).title = "Bob title";
  });
  const alicePatches = diffProject(baseProject, {
    ...baseProject,
    scenes: [aliceTitle, ...baseProject.scenes.slice(1)],
  });
  const bobPatches = diffProject(baseProject, {
    ...baseProject,
    scenes: [bobTitle, ...baseProject.scenes.slice(1)],
  });
  alice.send({ type: "action", actionId: "alice-title", baseSeq: 0, patches: alicePatches });
  const aliceEcho = await alice.next(
    (message) => message.type === "action" && message.actionId === "alice-title",
  );
  check(aliceEcho.type === "action" && aliceEcho.seq === 1, "first action gets sequence one");
  bob.send({ type: "action", actionId: "bob-title", baseSeq: 1, patches: bobPatches });
  const bobEcho = await bob.next(
    (message) => message.type === "action" && message.actionId === "bob-title",
  );
  check(bobEcho.type === "action" && bobEcho.seq === 2, "later action gets sequence two");

  bob.send({ type: "presence", presence: { sceneId: (baseProject.scenes[0] as SceneDocument).id, cursor: { x: 1, y: 2 } } });
  const presence = await alice.next((message) => message.type === "presence");
  check(
    presence.type === "presence" && presence.user.user.name === "Bob" &&
      presence.user.cursor?.x === 1,
    "presence reaches the other collaborator",
  );

  bob.send({
    type: "presence",
    presence: {
      sceneId: (baseProject.scenes[0] as SceneDocument).id,
      cursor: { x: 1, y: 2 },
      viewCenter: { x: 10, y: 20 },
    },
  });
  const viewPresence = await alice.next(
    (message) => message.type === "presence" && message.user.viewCenter?.x === 10,
  );
  check(
    viewPresence.type === "presence" && viewPresence.user.viewCenter?.y === 20,
    "presence relays the followed world-space view centre",
  );

  bob.send({
    type: "presence",
    presence: {
      sceneId: (baseProject.scenes[0] as SceneDocument).id,
      cursor: { x: 1, y: 2 },
      marquee: { x: 10, y: 20, width: 30, height: 40 },
    },
  });
  const marqueePresence = await alice.next(
    (message) => message.type === "presence" && message.user.marquee?.width === 30,
  );
  check(
    marqueePresence.type === "presence" &&
      marqueePresence.user.marquee?.height === 40,
    "presence relays a live drag-to-select rectangle",
  );

  alice.send({ type: "resync" });
  const finalWelcome = await alice.next((message) => message.type === "welcome");
  check(finalWelcome.type === "welcome", "resync returns a snapshot");
  if (finalWelcome.type === "welcome") {
    check(
      (finalWelcome.project.scenes[0] as SceneDocument).meta.title === "Bob title",
      "the last same-field action is the authoritative value",
    );
  }

  const bobClientId = bobWelcome.selfId;
  alice.close();
  const leader = await bob.next((message) => message.type === "leader" && message.leaderId === bobClientId);
  check(leader.type === "leader", "leadership transfers when the first client leaves");
} finally {
  alice.close();
  bob.close();
  await server.close();
}

// The room cache survives a server restart without an explicit seed.
const restarted = await createCollabServer({
  port: 0,
  host: "127.0.0.1",
  cacheDir,
  ttlMs: 60_000,
  adminCode: "",
});
const cachedClient = new TestClient(
  `ws://127.0.0.1:${restarted.port}/room/${encodeURIComponent(room)}`,
);
try {
  await cachedClient.open();
  cachedClient.send({
    type: "join",
    user: { id: "cached", name: "Cached", color: "#0f0" },
    sceneId: (baseProject.scenes[0] as SceneDocument).id,
  });
  const cachedWelcome = await cachedClient.next((message) => message.type === "welcome");
  check(cachedWelcome.type === "welcome", "cached room can be joined without a seed");
  if (cachedWelcome.type === "welcome") {
    check(
      (cachedWelcome.project.scenes[0] as SceneDocument).meta.title === "Bob title",
      "the temporary cache restores the last confirmed project",
    );
    check(cachedWelcome.seq === 2, "the cache restores the sequence");
  }
} finally {
  cachedClient.close();
  await restarted.close();
  await rm(cacheDir, { recursive: true, force: true });
}

// The room verifies the same HMAC token minted by api/collab/token.
{
  const authCache = await mkdtemp(join(tmpdir(), "umler-collab-auth-"));
  const authRoom = "auth-room";
  const secret = "test-collab-secret";
  const b64 = (value: string): string =>
    Buffer.from(value).toString("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const signToken = (
    payload: Record<string, unknown>,
  ): string => {
    const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = b64(JSON.stringify(payload));
    const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `${header}.${body}.${signature}`;
  };
  const authServer = await createCollabServer({
    port: 0,
    host: "127.0.0.1",
    cacheDir: authCache,
    ttlMs: 60_000,
    secret,
    adminCode: "",
  });
  const authUrl = `ws://127.0.0.1:${authServer.port}/room/${encodeURIComponent(authRoom)}`;
  const unauthorized = new TestClient(authUrl);
  let unauthorizedRejected = false;
  try {
    await unauthorized.open();
    await unauthorized.next((message) => message.type === "welcome", 500);
  } catch {
    unauthorizedRejected = true;
  } finally {
    unauthorized.close();
  }
  check(unauthorizedRejected, "a room with a secret rejects a tokenless connection");

  const wrongRoomToken = signToken({
    sub: "alice",
    name: "Alice",
    room: "some-other-room",
    canEdit: true,
    exp: Math.floor(Date.now() / 1000) + 60,
  });
  const wrongRoom = new TestClient(`${authUrl}?token=${encodeURIComponent(wrongRoomToken)}`);
  let wrongRoomRejected = false;
  try {
    await wrongRoom.open();
    await wrongRoom.next((message) => message.type === "welcome", 500);
  } catch {
    wrongRoomRejected = true;
  } finally {
    wrongRoom.close();
  }
  check(wrongRoomRejected, "a token scoped to another room is rejected");

  const validToken = signToken({
    sub: "alice",
    name: "Alice Token",
    avatarUrl: "",
    room: authRoom,
    canEdit: true,
    exp: Math.floor(Date.now() / 1000) + 60,
  });
  const authorized = new TestClient(`${authUrl}?token=${encodeURIComponent(validToken)}`);
  try {
    await authorized.open();
    authorized.send({
      type: "join",
      user: { id: "spoofed", name: "Spoofed", color: "#000" },
      sceneId: (baseProject.scenes[0] as SceneDocument).id,
      seed: baseProject,
    });
    const welcome = await authorized.next((message) => message.type === "welcome");
    check(welcome.type === "welcome", "a valid collaboration token can join");
    if (welcome.type === "welcome") {
      check(
        welcome.users[0]?.user.name === "Alice Token",
        "the token identity overrides the client-supplied user",
      );
      check(
        welcome.users[0]?.user.login === "alice",
        "the token login is preserved for presence",
      );
    }
  } finally {
    authorized.close();
    await authServer.close();
    await rm(authCache, { recursive: true, force: true });
  }
}

// --- administrator gate ----------------------------------------------------
{
  const gateCache = await mkdtemp(join(tmpdir(), "umler-collab-gate-"));
  const gateRoom = "gate-room";
  const adminCode = "correct horse battery staple";
  const expectedKey = roomAdministratorKey(adminCode, gateRoom);
  check(
    (await deriveRoomKey(adminCode, gateRoom)) === expectedKey,
    "browser and server derive the same per-room administrator key",
  );

  const gateServer = await createCollabServer({
    port: 0,
    host: "127.0.0.1",
    cacheDir: gateCache,
    ttlMs: 60_000,
    adminCode,
    snapshotStore: null,
    blobStore: null,
  });
  const gateUrl = `ws://127.0.0.1:${gateServer.port}/room/${encodeURIComponent(gateRoom)}`;
  const rejected = async (url: string): Promise<boolean> => {
    const client = new TestClient(url);
    try {
      await client.open();
      await client.next((message) => message.type === "welcome", 500);
      return false;
    } catch {
      return true;
    } finally {
      client.close();
    }
  };
  check(await rejected(gateUrl), "a locked room rejects a keyless connection");
  check(
    await rejected(`${gateUrl}?key=${encodeURIComponent("wrong-key")}`),
    "a locked room rejects a wrong administrator key",
  );

  const gateHttp = `http://127.0.0.1:${gateServer.port}`;
  const accepted = await fetch(
    `${gateHttp}/unlock?room=${encodeURIComponent(gateRoom)}&key=${encodeURIComponent(expectedKey)}`,
  );
  check(accepted.ok, "the unlock endpoint accepts the derived key");
  const denied = await fetch(
    `${gateHttp}/unlock?room=${encodeURIComponent(gateRoom)}&key=wrong-key`,
  );
  check(denied.status === 403, "the unlock endpoint rejects a wrong key");

  const gateClient = new TestClient(`${gateUrl}?key=${encodeURIComponent(expectedKey)}`);
  try {
    await gateClient.open();
    gateClient.send({
      type: "join",
      user: { id: "gate", name: "Gate", color: "#0f0" },
      sceneId: (baseProject.scenes[0] as SceneDocument).id,
      seed: baseProject,
    });
    const welcome = await gateClient.next((message) => message.type === "welcome");
    check(welcome.type === "welcome", "a correct administrator key opens the room");
  } finally {
    gateClient.close();
    await gateServer.close();
    await rm(gateCache, { recursive: true, force: true });
  }

  const openCache = await mkdtemp(join(tmpdir(), "umler-collab-open-"));
  const openServer = await createCollabServer({
    port: 0,
    host: "127.0.0.1",
    cacheDir: openCache,
    ttlMs: 60_000,
    adminCode: "",
    snapshotStore: null,
    blobStore: null,
  });
  try {
    const response = await fetch(
      `http://127.0.0.1:${openServer.port}/unlock?room=anything&key=anything`,
    );
    const payload = await response.json() as { required?: unknown };
    check(
      response.ok && payload.required === false,
      "without an administrator code the unlock endpoint reports no gate",
    );
  } finally {
    await openServer.close();
    await rm(openCache, { recursive: true, force: true });
  }
}

// --- Redis snapshot recovery ------------------------------------------------
{
  const store = new MemorySnapshots();
  const redisRoom = "redis-room";
  const cacheA = await mkdtemp(join(tmpdir(), "umler-collab-redis-a-"));
  const serverA = await createCollabServer({
    port: 0,
    host: "127.0.0.1",
    cacheDir: cacheA,
    ttlMs: 60_000,
    adminCode: "",
    snapshotStore: store,
    blobStore: null,
    redisSnapshotMs: 1000,
  });
  const changed = sceneWith(baseProject.scenes[0] as SceneDocument, (scene) => {
    (scene.meta as { title: string }).title = "Redis title";
  });
  const changedProject: CollabProject = {
    ...baseProject,
    scenes: [changed, ...baseProject.scenes.slice(1)],
  };
  const patches = diffProject(baseProject, changedProject);
  const clientA = new TestClient(
    `ws://127.0.0.1:${serverA.port}/room/${encodeURIComponent(redisRoom)}`,
  );
  try {
    await clientA.open();
    clientA.send({
      type: "join",
      user: { id: "redis-a", name: "Redis A", color: "#0f0" },
      sceneId: (baseProject.scenes[0] as SceneDocument).id,
      seed: baseProject,
    });
    await clientA.next((message) => message.type === "welcome");
    clientA.send({ type: "action", actionId: "redis-title", baseSeq: 0, patches });
    await clientA.next(
      (message) => message.type === "action" && message.actionId === "redis-title",
    );
  } finally {
    clientA.close();
  }
  await serverA.close();
  const stored = store.snapshots.get(redisRoom);
  check(stored !== undefined, "a confirmed action is snapshotted to Redis");
  if (stored !== undefined) {
    check(
      (stored.project as CollabProject).scenes[0]?.meta.title === "Redis title",
      "the Redis snapshot holds the latest confirmed fields",
    );
  }

  const cacheB = await mkdtemp(join(tmpdir(), "umler-collab-redis-b-"));
  const serverB = await createCollabServer({
    port: 0,
    host: "127.0.0.1",
    cacheDir: cacheB,
    ttlMs: 60_000,
    adminCode: "",
    snapshotStore: store,
    blobStore: null,
  });
  const clientB = new TestClient(
    `ws://127.0.0.1:${serverB.port}/room/${encodeURIComponent(redisRoom)}`,
  );
  try {
    await clientB.open();
    clientB.send({
      type: "join",
      user: { id: "redis-b", name: "Redis B", color: "#0f0" },
      sceneId: (baseProject.scenes[0] as SceneDocument).id,
    });
    const welcome = await clientB.next((message) => message.type === "welcome");
    check(welcome.type === "welcome", "a cold process can join from Redis without a seed");
    if (welcome.type === "welcome") {
      check(
        welcome.project.scenes[0]?.meta.title === "Redis title",
        "the Redis snapshot restores the last confirmed project",
      );
      check(welcome.seq === 1, "the Redis snapshot restores the sequence");
    }
  } finally {
    clientB.close();
    await serverB.close();
    await rm(cacheA, { recursive: true, force: true });
    await rm(cacheB, { recursive: true, force: true });
  }
}

// --- Blob-backed image snapshots -------------------------------------------
{
  const store = new MemorySnapshots();
  const blobs = new MemoryBlobs();
  const blobRoom = "blob-room";
  const imageId = asAssetId("img_test_dot");
  const dataUrl =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const image: ImageAsset = {
    id: imageId,
    kind: "raster",
    fileName: "dot.png",
    mimeType: "image/png",
    byteLength: 96,
    intrinsicWidth: 1,
    intrinsicHeight: 1,
    checksum: "sha256:test-dot",
    storage: "data-url",
    dataUrl,
  };
  const blobProject: CollabProject = {
    ...baseProject,
    assets: { [imageId]: image },
  };
  const cacheA = await mkdtemp(join(tmpdir(), "umler-collab-blob-a-"));
  const serverA = await createCollabServer({
    port: 0,
    host: "127.0.0.1",
    cacheDir: cacheA,
    ttlMs: 60_000,
    adminCode: "",
    snapshotStore: store,
    blobStore: blobs,
    blobMinBytes: 1,
    redisSnapshotMs: 1000,
  });
  const clientA = new TestClient(
    `ws://127.0.0.1:${serverA.port}/room/${encodeURIComponent(blobRoom)}`,
  );
  try {
    await clientA.open();
    clientA.send({
      type: "join",
      user: { id: "blob-a", name: "Blob A", color: "#0f0" },
      sceneId: (blobProject.scenes[0] as SceneDocument).id,
      seed: blobProject,
    });
    await clientA.next((message) => message.type === "welcome");
  } finally {
    clientA.close();
  }
  await serverA.close();
  const stored = store.snapshots.get(blobRoom);
  check(stored !== undefined, "an image room is snapshotted to Redis");
  check(blobs.puts === 1, "a large image is uploaded to Blob once");
  if (stored !== undefined) {
    const compact = (stored.project as CollabProject).assets?.[imageId];
    check(compact?.dataUrl === undefined, "the Redis snapshot omits image bytes");
    check((stored.blobs ?? []).length === 1, "the snapshot records the Blob reference");
  }

  const cacheB = await mkdtemp(join(tmpdir(), "umler-collab-blob-b-"));
  const serverB = await createCollabServer({
    port: 0,
    host: "127.0.0.1",
    cacheDir: cacheB,
    ttlMs: 60_000,
    adminCode: "",
    snapshotStore: store,
    blobStore: blobs,
    blobMinBytes: 1,
  });
  const clientB = new TestClient(
    `ws://127.0.0.1:${serverB.port}/room/${encodeURIComponent(blobRoom)}`,
  );
  try {
    await clientB.open();
    clientB.send({
      type: "join",
      user: { id: "blob-b", name: "Blob B", color: "#0f0" },
      sceneId: (blobProject.scenes[0] as SceneDocument).id,
    });
    const welcome = await clientB.next((message) => message.type === "welcome");
    check(welcome.type === "welcome", "the image room restores from Redis");
    if (welcome.type === "welcome") {
      const restored = welcome.project.assets?.[imageId];
      check(restored?.dataUrl === dataUrl, "the restored project hydrates image bytes from Blob");
    }
    check(blobs.puts === 1, "restoring a room does not upload the image again");
  } finally {
    clientB.close();
    await serverB.close();
    await rm(cacheA, { recursive: true, force: true });
    await rm(cacheB, { recursive: true, force: true });
  }
}

await wait(10);
console.log(`Collaboration checks passed (${checks} assertions).`);
