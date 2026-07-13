import * as THREE from 'three';
import { AudioFrame, VisualParams } from '../../types';

export interface SceneFrameInput {
  /** real seconds since last frame (clamped) */
  dt: number;
  /** scene time, already scaled by Motion Speed */
  time: number;
  audio: AudioFrame;
  params: VisualParams;
  /** camera drift offset, already scaled by Camera Motion */
  cam: THREE.Vector2;
}

export interface PFScene {
  readonly id: string;
  setImage(tex: THREE.Texture, imageAspect: number): void;
  setSize(width: number, height: number): void;
  update(input: SceneFrameInput): void;
  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void;
  dispose(): void;
}
