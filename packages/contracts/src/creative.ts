import { z } from 'zod';

const number = (min: number, max: number) =>
  z.number().finite().min(min).max(max);
const id = z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/);
const asset = z.string().uuid().or(z.literal(''));
const hash = z
  .string()
  .regex(/^sha256-[a-f0-9]{64}$/)
  .or(z.literal(''));
export const creativeEvents = [
  'start',
  'score',
  'hit',
  'win',
  'lose',
  'click',
] as const;
export const creativeProperties = [
  'x',
  'y',
  'rotation',
  'opacity',
  'width',
  'height',
  'frame',
] as const;
export const creativeSchema = z
  .object({
    version: z.literal(1),
    nodes: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1).max(80),
            kind: z.enum(['group', 'sprite', 'rect', 'text']),
            parentId: id.or(z.literal('')),
            x: number(-1920, 2880),
            y: number(-1200, 1800),
            width: number(1, 1920),
            height: number(1, 1200),
            rotation: number(-360, 360),
            opacity: number(0, 1),
            visible: z.boolean(),
            phase: z.enum(['all', 'ready', 'playing', 'paused', 'won', 'lost']),
            color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
            text: z.string().max(500),
            assetId: asset,
            contentHash: hash,
            columns: z.number().int().min(1).max(16).default(1),
            rows: z.number().int().min(1).max(16).default(1),
          })
          .strict(),
      )
      .max(100),
    clips: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1).max(80),
            duration: number(0.1, 60),
            loop: z.boolean(),
            trigger: z.enum(creativeEvents),
            tracks: z
              .array(
                z
                  .object({
                    nodeId: id,
                    property: z.enum(creativeProperties),
                    keys: z
                      .array(
                        z
                          .object({
                            time: number(0, 60),
                            value: number(-2880, 2880),
                          })
                          .strict(),
                      )
                      .min(1)
                      .max(120),
                  })
                  .strict(),
              )
              .min(1)
              .max(50),
          })
          .strict(),
      )
      .max(20),
    sounds: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1).max(80),
            trigger: z.enum(creativeEvents),
            source: z.enum(['tone', 'asset']),
            assetId: asset,
            contentHash: hash,
            volume: number(0, 1),
            loop: z.boolean(),
            frequency: number(80, 2000),
            duration: number(0.03, 3),
          })
          .strict(),
      )
      .max(20),
    masterVolume: number(0, 1),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const invalid = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
    for (const list of [doc.nodes, doc.clips, doc.sounds])
      if (new Set(list.map((n) => n.id)).size !== list.length)
        invalid('Duplicate id');
    for (const n of doc.nodes) {
      if (Boolean(n.assetId) !== Boolean(n.contentHash))
        invalid('Asset hash required');
      if (n.kind === 'sprite' && !n.assetId) invalid('Sprite asset required');
      const seen = new Set([n.id]);
      let parent = n.parentId;
      while (parent) {
        const p = nodes.get(parent);
        if (p?.kind !== 'group' || seen.has(parent)) {
          invalid('Invalid parent graph');
          break;
        }
        seen.add(parent);
        parent = p.parentId;
      }
    }
    for (const clip of doc.clips) {
      const tracks = new Set<string>();
      for (const track of clip.tracks) {
        const n = nodes.get(track.nodeId),
          key = `${track.nodeId}:${track.property}`;
        if (!n || tracks.has(key)) invalid('Invalid track target');
        tracks.add(key);
        let previous = -1;
        for (const k of track.keys) {
          if (k.time <= previous || k.time > clip.duration)
            invalid('Invalid key time');
          previous = k.time;
          const ranges: Record<string, [number, number]> = {
            x: [-1920, 2880],
            y: [-1200, 1800],
            rotation: [-360, 360],
            opacity: [0, 1],
            width: [1, 1920],
            height: [1, 1200],
            frame: [0, (n?.columns ?? 1) * (n?.rows ?? 1) - 1],
          };
          const range = ranges[track.property];
          if (
            !range ||
            k.value < range[0] ||
            k.value > range[1] ||
            (track.property === 'frame' && !Number.isInteger(k.value))
          )
            invalid('Invalid key value');
        }
      }
    }
    for (const sound of doc.sounds) {
      if (sound.source === 'asset' && (!sound.assetId || !sound.contentHash))
        invalid('Audio asset required');
      if (sound.loop && sound.trigger !== 'start')
        invalid('Only start audio may loop');
    }
  });
