// Shared renderer resources; the host owns the device and per-node cache.
import type { GpuCapability } from 'cascade/contracts';
import { BufferUsage, TextureUsage } from 'cascade/gpu';
import { CRYSTAL_WGSL } from './crystalShader';
import type { Raster } from './pixels';

export const UNIFORM_BYTES = 144;

export interface CrystalGpu {
  device: GPUDevice;
  pipeline: GPURenderPipeline;
  uniforms: GPUBuffer;
  sampler: GPUSampler;
  target: GPUTexture;
  size: [number, number];
  columnTexture: GPUTexture | null;
  bindGroup: GPUBindGroup | null;
}

function target(device: GPUDevice, width: number, height: number) {
  return device.createTexture({ size: [width, height], format: 'rgba8unorm',
    usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.COPY_SRC });
}

export async function acquireCrystalGpu(gpu: GpuCapability, width: number, height: number): Promise<CrystalGpu> {
  const holder = gpu.cache<{ state?: CrystalGpu; disposed: boolean }>('crystal', () => ({ disposed: false }), (value) => {
    value.disposed = true;
    value.state?.uniforms.destroy();
    value.state?.target.destroy();
    value.state?.columnTexture?.destroy();
    value.state = undefined;
  });
  if (!holder.state) {
    const device = gpu.device;
    const shader = device.createShaderModule({ code: CRYSTAL_WGSL });
    const pipeline = await device.createRenderPipelineAsync({
      layout: 'auto', vertex: { module: shader, entryPoint: 'vs' },
      fragment: { module: shader, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
    if (holder.disposed) throw new Error('GPU renderer disposed during shader compilation');
    holder.state = {
      device, pipeline,
      uniforms: device.createBuffer({ size: UNIFORM_BYTES, usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST }),
      sampler: device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' }),
      target: target(device, width, height), size: [width, height],
      columnTexture: null, bindGroup: null,
    };
  }
  const state = holder.state;
  if (state.size[0] !== width || state.size[1] !== height) {
    const next = target(state.device, width, height);
    state.target.destroy();
    state.target = next;
    state.size = [width, height];
  }
  return state;
}

/** Always upload wired bytes: a reused path does not prove unchanged content. */
export function uploadColumn(state: CrystalGpu, source: Raster) {
  if (!state.columnTexture || state.columnTexture.width !== source.width || state.columnTexture.height !== source.height) {
    state.columnTexture?.destroy();
    state.columnTexture = state.device.createTexture({ size: [source.width, source.height], format: 'rgba8unorm',
      usage: TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_DST });
    state.bindGroup = state.device.createBindGroup({ layout: state.pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: state.uniforms } },
      { binding: 1, resource: state.columnTexture.createView() },
      { binding: 2, resource: state.sampler },
    ] });
  }
  state.device.queue.writeTexture({ texture: state.columnTexture }, source.data,
    { bytesPerRow: source.width * 4 }, [source.width, source.height]);
}
