export type SourceMaterialType = 'book' | 'audiobook' | 'story';

export type WorkspaceTab = 'vision' | 'shots' | 'screenplay' | 'storyboard';

export type ThinkingDepth = 'standard' | 'deep';

export interface ColorSwatch {
  name: string;
  hex: string;
  role: string;
}

export interface ShotSpec {
  shotNumber: string;
  shotType: string;
  lensMm: string;
  movement: string;
  durationSec: number;
  framingNote: string;
  psychologicalIntent: string;
}

export interface LightingSetup {
  keyLight: string;
  fillRatio: string;
  rimAndBacklight: string;
  colorTemperatureKelvin: string;
  atmosphereAndHaze: string;
}

export interface SoundDesignSpec {
  atmosLayers: string[];
  subBassCue: string;
  foleyDetails: string[];
  silenceBeats: string;
  musicalScore: string;
  tempoBpm: number;
}

export interface VfxBreakdown {
  cgiElements: string[];
  practicalSfx: string[];
  locationsAndSets: string;
  wardrobeAndMakeup: string;
}

export interface ScreenplayBeat {
  type: 'action' | 'dialogue' | 'camera' | 'sound';
  character?: string;
  parenthetical?: string;
  text: string;
}

export interface ScreenplayScene {
  sceneNumber: string;
  slugline: string;
  timeOfDay: string;
  beats: ScreenplayBeat[];
}

export interface StoryboardCard {
  id: string;
  title: string;
  shotRef: string;
  aspectRatio: string;
  cameraSpec: string;
  imageUrl?: string;
  visualPrompt: string;
  veoMotionPrompt: string;
}

export interface ProductionSequence {
  id: string;
  title: string;
  sourceType: SourceMaterialType;
  sourceFilename?: string;
  directorStyle: string;
  aspectRatio: string;
  cameraSystem: string;
  lensPackage: string;
  filmStockOrLut: string;
  logline: string;
  directorVision: string;
  colorPalette: ColorSwatch[];
  lighting: LightingSetup;
  shotList: ShotSpec[];
  soundDesign: SoundDesignSpec;
  vfx: VfxBreakdown;
  screenplay: ScreenplayScene[];
  storyboardFrames: StoryboardCard[];
  continuitySummary: string;
  createdAt: string;
}

export interface ProductionProject {
  id: string;
  title: string;
  genreStyle: string;
  defaultSourceType: SourceMaterialType;
  continuityBible: string;
  createdAt: string;
  updatedAt: string;
  sequences: ProductionSequence[];
}

export interface DirectorStylePreset {
  id: string;
  label: string;
  references: string;
  defaultCamera: string;
  defaultLenses: string;
  defaultRatio: string;
  description: string;
}
