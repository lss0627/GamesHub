import { creativeSchema, parseGameSpec } from '@gamerhub/contracts';
import type { GameSpec } from './types';

export { creativeEvents, creativeProperties } from '@gamerhub/contracts';
export type CreativeDocument = ReturnType<typeof creativeSchema.parse>;
export type CreativeNode = CreativeDocument['nodes'][number];
export type CreativeClip = CreativeDocument['clips'][number];
export type CreativeTrack = CreativeClip['tracks'][number];
export type CreativeSound = CreativeDocument['sounds'][number];
export function emptyCreative(): CreativeDocument {
  return { version: 1, nodes: [], clips: [], sounds: [], masterVolume: 0.7 };
}
export function parseCreative(input: unknown): CreativeDocument {
  if (JSON.stringify(input)?.length > 180000)
    throw Object.assign(new Error('CREATIVE_INVALID'), {
      code: 'CREATIVE_INVALID',
      statusCode: 400,
    });
  const result = creativeSchema.safeParse(input);
  if (!result.success)
    throw Object.assign(new Error('CREATIVE_INVALID'), {
      code: 'CREATIVE_INVALID',
      statusCode: 400,
    });
  return result.data;
}
export function specCreative(spec?: GameSpec): CreativeDocument {
  return spec?.extensions?.gamerhub_creative === undefined
    ? emptyCreative()
    : parseCreative(spec.extensions.gamerhub_creative);
}
export function withCreative(
  spec: GameSpec,
  document: CreativeDocument,
): GameSpec {
  return parseGameSpec({
    ...spec,
    extensions: {
      ...spec.extensions,
      gamerhub_creative: parseCreative(document),
    },
  });
}
export function sampleTrack(track: CreativeTrack, time: number): number {
  const keys = track.keys;
  const first = keys[0];
  if (!first) throw new Error('CREATIVE_TRACK_EMPTY');
  if (time <= first.time) return first.value;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1],
      b = keys[i];
    if (!a || !b || time > b.time) continue;
    if (track.property === 'frame') return time === b.time ? b.value : a.value;
    return (
      a.value + ((b.value - a.value) * (time - a.time)) / (b.time - a.time)
    );
  }
  return keys.at(-1)?.value ?? first.value;
}

export function creativeWorldPose(
  document: CreativeDocument,
  id: string,
): { x: number; y: number; rotation: number } {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  let node = nodes.get(id);
  if (!node) throw new Error('CREATIVE_NODE_MISSING');
  let { x, y, rotation } = node;
  const seen = new Set([id]);
  while (node.parentId) {
    if (seen.has(node.parentId)) throw new Error('CREATIVE_PARENT_CYCLE');
    seen.add(node.parentId);
    node = nodes.get(node.parentId);
    if (!node) throw new Error('CREATIVE_PARENT_MISSING');
    const angle = (node.rotation * Math.PI) / 180,
      cos = Math.cos(angle),
      sin = Math.sin(angle);
    [x, y] = [node.x + x * cos - y * sin, node.y + x * sin + y * cos];
    rotation += node.rotation;
  }
  return { x, y, rotation };
}

/** Reparenting keeps the base pose fixed in the canvas; tracks remain local to their group. */
export function reparentCreativeNode(
  document: CreativeDocument,
  id: string,
  parentId: string,
): CreativeDocument {
  const next = structuredClone(document),
    world = creativeWorldPose(document, id);
  const parent = parentId
    ? creativeWorldPose(document, parentId)
    : { x: 0, y: 0, rotation: 0 };
  const node = next.nodes.find((node) => node.id === id);
  if (!node) throw new Error('CREATIVE_NODE_MISSING');
  const angle = (-parent.rotation * Math.PI) / 180,
    dx = world.x - parent.x,
    dy = world.y - parent.y;
  node.parentId = parentId;
  node.x = dx * Math.cos(angle) - dy * Math.sin(angle);
  node.y = dx * Math.sin(angle) + dy * Math.cos(angle);
  node.rotation = ((world.rotation - parent.rotation + 540) % 360) - 180;
  return parseCreative(next);
}
