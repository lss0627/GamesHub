import type { CreativeSound } from '@gamerhub/game-spec';

/** Decode browser-supported formats, mix/resample with Web Audio, then upload canonical PCM. */
export async function audioFileToWav(file: File): Promise<Uint8Array> {
  if (file.size > 10 * 1024 * 1024)
    throw new Error('请选择不超过 10 MiB 的音频文件。');
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (
      !Number.isFinite(decoded.duration) ||
      decoded.duration <= 0 ||
      decoded.duration > 60
    )
      throw new Error('音频长度需要在 0 到 60 秒之间。');
    const rate = 22050,
      channels = Math.min(2, decoded.numberOfChannels),
      frames = Math.ceil(decoded.duration * rate);
    if (44 + frames * channels * 2 > 5 * 1024 * 1024)
      throw new Error('立体声音频请裁剪到 59 秒以内。');
    const offline = new OfflineAudioContext(channels, frames, rate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const buffer = new ArrayBuffer(44 + frames * channels * 2),
      view = new DataView(buffer);
    const text = (at: number, value: string) => {
      for (let i = 0; i < value.length; i++)
        view.setUint8(at + i, value.charCodeAt(i));
    };
    text(0, 'RIFF');
    view.setUint32(4, buffer.byteLength - 8, true);
    text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, frames * channels * 2, true);
    const data = Array.from({ length: channels }, (_, channel) =>
      rendered.getChannelData(channel),
    );
    for (let frame = 0; frame < frames; frame++)
      for (let channel = 0; channel < channels; channel++) {
        const sample = Math.max(-1, Math.min(1, data[channel]?.[frame] ?? 0));
        view.setInt16(
          44 + (frame * channels + channel) * 2,
          Math.round(sample * (sample < 0 ? 32768 : 32767)),
          true,
        );
      }
    return new Uint8Array(buffer);
  } finally {
    await context.close();
  }
}
export function bytesBase64(bytes: Uint8Array): string {
  let value = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(value);
}
export class CreativeAudioPreview {
  private context: AudioContext | undefined;
  private source: AudioBufferSourceNode | undefined;
  private controller?: AbortController;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  stop() {
    this.generation++;
    this.controller?.abort();
    this.source?.stop();
    this.source?.disconnect();
    this.source = undefined;
    clearTimeout(this.timer);
  }
  async play(sound: CreativeSound, master: number, projectId: string) {
    this.stop();
    const generation = this.generation;
    this.context ??= new AudioContext();
    const context = this.context;
    await context.resume();
    let buffer: AudioBuffer;
    if (sound.source === 'asset') {
      this.controller = new AbortController();
      const response = await fetch(
        `/v1/projects/${projectId}/assets/${sound.assetId}/content`,
        { signal: this.controller.signal },
      );
      if (!response.ok) throw new Error('无法读取音频素材。');
      buffer = await context.decodeAudioData(await response.arrayBuffer());
    } else {
      const rate = 22050,
        frames = Math.round(rate * sound.duration);
      buffer = context.createBuffer(1, frames, rate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++)
        data[i] =
          0.25 *
          Math.min(1, i / (rate * 0.01), (frames - 1 - i) / (rate * 0.025)) *
          Math.sin((2 * Math.PI * sound.frequency * i) / rate);
    }
    if (generation !== this.generation) return;
    const source = context.createBufferSource(),
      gain = context.createGain();
    source.buffer = buffer;
    source.loop = sound.loop;
    gain.gain.value = sound.volume * master;
    source.connect(gain);
    gain.connect(context.destination);
    source.onended = () => gain.disconnect();
    this.source = source;
    source.start();
    this.timer = setTimeout(() => this.stop(), 10000);
  }
  close() {
    this.stop();
    void this.context?.close();
    this.context = undefined;
  }
}
