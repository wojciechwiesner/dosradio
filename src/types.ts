/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
export interface Prompt {
  readonly promptId: string;
  text: string;
  weight: number;
  targetWeight?: number;
  cc: number;
  color: string;
  knob1?: number;
  knob2?: number;
  knob3?: number;
  muted?: boolean;
  solo?: boolean;
  category?: 'instrument' | 'mood' | 'genre' | 'style' | 'aux';
  metadata?: Record<string, unknown>;
}

export interface ControlChange {
  channel: number;
  cc: number;
  value: number;
}

export type PlaybackState = 'stopped' | 'playing' | 'loading' | 'paused';

export enum Scale {
  SCALE_UNSPECIFIED = 'SCALE_UNSPECIFIED',
  C_MAJOR_A_MINOR = 'C_MAJOR_A_MINOR',
  D_FLAT_MAJOR_B_FLAT_MINOR = 'D_FLAT_MAJOR_B_FLAT_MINOR',
  D_MAJOR_B_MINOR = 'D_MAJOR_B_MINOR',
  E_FLAT_MAJOR_C_MINOR = 'E_FLAT_MAJOR_C_MINOR',
  E_MAJOR_D_FLAT_MINOR = 'E_MAJOR_D_FLAT_MINOR',
  F_MAJOR_D_MINOR = 'F_MAJOR_D_MINOR',
  G_FLAT_MAJOR_E_FLAT_MINOR = 'G_FLAT_MAJOR_E_FLAT_MINOR',
  G_MAJOR_E_MINOR = 'G_MAJOR_E_MINOR',
  A_FLAT_MAJOR_F_MINOR = 'A_FLAT_MAJOR_F_MINOR',
  A_MAJOR_G_FLAT_MINOR = 'A_MAJOR_G_FLAT_MINOR',
  B_FLAT_MAJOR_G_MINOR = 'B_FLAT_MAJOR_G_MINOR',
  B_MAJOR_A_FLAT_MINOR = 'B_MAJOR_A_FLAT_MINOR',
}

export enum MusicGenerationMode {
  QUALITY = 'QUALITY',
  DIVERSITY = 'DIVERSITY',
  VOCALIZATION = 'VOCALIZATION',
}

export interface MusicGenerationConfig {
  guidance?: number;
  bpm?: number;
  density?: number;
  brightness?: number;
  scale?: Scale;
  // Lyria API uses camelCase for these parameters
  muteBass?: boolean;
  muteDrums?: boolean;
  onlyBassAndDrums?: boolean;
  musicGenerationMode?: MusicGenerationMode;
  temperature?: number;
  topK?: number;
  seed?: number; // For reproducible generation
}
