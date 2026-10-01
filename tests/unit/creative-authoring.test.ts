import {
  creativeWorldPose,
  emptyCreative,
  parseCreative,
  reparentCreativeNode,
  runnerGameSpec,
  sampleTrack,
  specCreative,
  withCreative,
} from '@gamerhub/game-spec';
import { describe, expect, it } from 'vitest';
import { canonicalWav } from '../../packages/assets/src/audio';

const node = {
  id: 'banner',
  name: '招牌',
  kind: 'text',
  parentId: '',
  x: 100,
  y: 80,
  width: 200,
  height: 50,
  rotation: 0,
  opacity: 1,
  visible: true,
  phase: 'all',
  color: '#ffffff',
  text: '星光小铺',
  assetId: '',
  contentHash: '',
};
const track = {
  nodeId: 'banner',
  property: 'x',
  keys: [
    { time: 0, value: 100 },
    { time: 1, value: 200 },
  ],
};
describe('versioned creative document', () => {
  it('reparents rotated objects without changing their world position or orientation', () => {
    const doc = parseCreative({
      ...emptyCreative(),
      nodes: [
        { ...node, id: 'group', kind: 'group', x: 300, y: 200, rotation: 90 },
        node,
      ],
    });
    const before = creativeWorldPose(doc, 'banner');
    const after = reparentCreativeNode(doc, 'banner', 'group');
    expect(creativeWorldPose(after, 'banner').x).toBeCloseTo(before.x);
    expect(creativeWorldPose(after, 'banner').y).toBeCloseTo(before.y);
    expect(creativeWorldPose(after, 'banner').rotation).toBeCloseTo(
      before.rotation,
    );
    expect(after.nodes[1]?.parentId).toBe('group');
    expect(doc.nodes[1]?.parentId).toBe('');
  });
  it('round trips through an approved game spec and samples keyframes', () => {
    const doc = parseCreative({
      ...emptyCreative(),
      nodes: [node],
      clips: [
        {
          id: 'float',
          name: '漂浮',
          duration: 1,
          loop: true,
          trigger: 'start',
          tracks: [track],
        },
      ],
    });
    expect(specCreative(withCreative(runnerGameSpec, doc))).toEqual(doc);
    expect(sampleTrack(track, 0.5)).toBe(150);
    expect(sampleTrack(track, 4)).toBe(200);
  });
  it('rejects duplicate ids, cyclic parents, missing targets and unsupported fields', () => {
    expect(() =>
      parseCreative({ ...emptyCreative(), nodes: [node, node] }),
    ).toThrow();
    expect(() =>
      parseCreative({
        ...emptyCreative(),
        nodes: [{ ...node, parentId: 'banner' }],
      }),
    ).toThrow();
    expect(() =>
      parseCreative({
        ...emptyCreative(),
        nodes: [{ ...node, unknown: true }],
      }),
    ).toThrow();
    expect(() =>
      parseCreative({
        ...emptyCreative(),
        clips: [
          {
            id: 'float',
            name: '漂浮',
            duration: 1,
            loop: true,
            trigger: 'start',
            tracks: [track],
          },
        ],
      }),
    ).toThrow();
  });
  it('rejects unbounded timelines, duplicate keys, invalid asset ids and NaN', () => {
    for (const patch of [
      { x: Number.NaN },
      { assetId: '../../escape' },
      { width: 0 },
    ])
      expect(() =>
        parseCreative({ ...emptyCreative(), nodes: [{ ...node, ...patch }] }),
      ).toThrow();
    expect(() =>
      parseCreative({
        ...emptyCreative(),
        nodes: [node],
        clips: [
          {
            id: 'float',
            name: '漂浮',
            duration: 1,
            loop: true,
            trigger: 'start',
            tracks: [
              {
                ...track,
                keys: [
                  { time: 0, value: 1 },
                  { time: 0, value: 2 },
                ],
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });
});
describe('PCM audio ingestion', () => {
  const wav = () => {
    const b = Buffer.alloc(48);
    b.write('RIFF');
    b.writeUInt32LE(40, 4);
    b.write('WAVEfmt ', 8);
    b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20);
    b.writeUInt16LE(1, 22);
    b.writeUInt32LE(22050, 24);
    b.writeUInt32LE(44100, 28);
    b.writeUInt16LE(2, 32);
    b.writeUInt16LE(16, 34);
    b.write('data', 36);
    b.writeUInt32LE(4, 40);
    b.writeInt16LE(1000, 44);
    return b;
  };
  it('fully parses PCM and produces canonical WAV without metadata', () => {
    const result = canonicalWav(wav());
    expect(result.bytes).toEqual(wav());
    expect(result.duration).toBeCloseTo(2 / 22050);
  });
  it('rejects truncated data, unsupported encoding and inconsistent sample rates', () => {
    expect(() => canonicalWav(wav().subarray(0, 47))).toThrow();
    const b = wav();
    b.writeUInt16LE(3, 20);
    expect(() => canonicalWav(b)).toThrow();
    const c = wav();
    c.writeUInt32LE(1, 28);
    expect(() => canonicalWav(c)).toThrow();
  });
});
