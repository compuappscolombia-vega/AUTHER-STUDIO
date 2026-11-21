export type SourceMaterialType = 'book' | 'audiobook' | 'story';

export type WorkspaceTab = 'vision' | 'shots' | 'screenplay' | 'storyboard' | 'previs3d' | 'trailer';

export type ScreenplayNoteRole = 'director' | 'producer';

export interface ScreenplayNote {
  id: string;
  beatKey: string;
  sceneNumber: string;
  beatIndex: number;
  beatType: 'action' | 'dialogue' | 'camera' | 'sound';
  lineExcerpt: string;
  authorRole: ScreenplayNoteRole;
  authorName: string;
  note: string;
  createdAt: string;
  resolved?: boolean;
}

export type ThinkingDepth = 'standard' | 'deep';

export type SequenceVersionStatus = 'draft' | 'final';

export type ResolutionTier = '720p' | '1080p' | '2K' | '4K';

export type VoicePreset = 'Charon' | 'Kore' | 'Fenrir' | 'Puck' | 'Zephyr';

export type LearningCategory =
  | 'camera'
  | 'lighting'
  | 'sound'
  | 'screenplay'
  | 'pacing'
  | 'continuity';

export interface StudioSettings {
  defaultResolution: ResolutionTier;
  defaultDirectorStyle: string;
  defaultAspectRatio: string;
  defaultVoicePreset: VoicePreset;
  defaultThinkingDepth: ThinkingDepth;
}

export interface BookChapterItem {
  index: number;
  title: string;
  summary: string;
  keyCharacters: string[];
  estimatedStartHint: string;
  sourceExcerpt: string;
  status: 'pending' | 'producing' | 'completed';
  sequenceId?: string;
}

export interface ChapterPlan {
  sourceAssetId?: string;
  sourceFilename: string;
  sourceType: SourceMaterialType;
  createdAt: string;
  chapters: BookChapterItem[];
}

export interface VoiceOverTrack {
  id: string;
  characterOrNarrator: string;
  voicePersona: string;
  voicePreset: VoicePreset;
  deliveryDirection: string;
  timecodeHint: string;
  text: string;
  audioUrl?: string;
}

export interface LearningLesson {
  id: string;
  category: LearningCategory;
  insight: string;
  rating: number;
  sourceProjectTitle: string;
  createdAt: string;
}

export interface ProjectAsset {
  id: string;
  filename: string;
  kind: 'audio' | 'document' | 'image' | 'video';
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: string;
}

export interface AudioAnalysisReport {
  transcription: string;
  narrationStyle: string;
  emotionalArc: string;
  rhythmAndPacing: string;
  detectedSoundEffects: string[];
  directingRecommendations: string;
}

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
  id?: string;
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
  videoUrl?: string;
  visualPrompt: string;
  veoMotionPrompt: string;
}

export interface ProductionSequence {
  id: string;
  title: string;
  versionStatus: SequenceVersionStatus;
  sourceType: SourceMaterialType;
  sourceFilename?: string;
  directorStyle: string;
  aspectRatio: string;
  targetResolution?: ResolutionTier;
  hyperRealisticPrompt?: string;
  chapterIndex?: number;
  chapterTotal?: number;
  cameraSystem: string;
  lensPackage: string;
  filmStockOrLut: string;
  logline: string;
  directorVision: string;
  colorPalette: ColorSwatch[];
  lighting: LightingSetup;
  shotList: ShotSpec[];
  soundDesign: SoundDesignSpec;
  voiceOverTracks?: VoiceOverTrack[];
  audioAnalysis?: AudioAnalysisReport;
  vfx: VfxBreakdown;
  screenplay: ScreenplayScene[];
  screenplayNotes?: ScreenplayNote[];
  storyboardFrames: StoryboardCard[];
  continuitySummary: string;
  sequenceRating?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface TrailerBeat {
  id: string;
  beatNumber: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  sourceSequenceId: string;
  sourceSequenceTitle: string;
  visualDescription: string;
  hyperRealisticPrompt: string;
  motionPrompt: string;
  voiceOverLine: string;
  onScreenTitleCard: string;
  sfxCue: string;
  editingTransition: string;
  imageUrl?: string;
  videoUrl?: string;
}

export interface ProjectTrailer {
  id: string;
  title: string;
  tagline: string;
  tone: string;
  targetResolution: ResolutionTier;
  totalDurationSec: number;
  voicePreset: VoicePreset;
  voiceDirection: string;
  voiceOverScript: string;
  voiceOverAudioUrl?: string;
  musicPrompt: string;
  tempoBpm: number;
  soundMixNotes: string;
  musicAudioUrl?: string;
  approvedSequenceIds: string[];
  beats: TrailerBeat[];
  createdAt: string;
}

export interface ProductionProject {
  id: string;
  title: string;
  genreStyle: string;
  defaultSourceType: SourceMaterialType;
  continuityBible: string;
  assets?: ProjectAsset[];
  chapterPlan?: ChapterPlan;
  trailer?: ProjectTrailer;
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

export interface PatternMetric {
  label: string;
  detail: string;
  occurrences: number;
  avgRating: number;
  sourceProjects: string[];
}

export interface DirectorialEnhancement {
  id: string;
  category: 'camera' | 'lighting' | 'sound';
  title: string;
  recommendation: string;
  rationale: string;
  sourceProjectTitle: string;
  confidenceScore: number;
  continuitySnippet: string;
}

export interface StudioIntelligenceReport {
  totalTrackedOutcomes: number;
  finalizedSequencesCount: number;
  topCameraPatterns: PatternMetric[];
  topLightingSetups: PatternMetric[];
  topSoundscapes: PatternMetric[];
  enhancements: DirectorialEnhancement[];
}

export interface TimelineMilestone {
  sequenceId: string;
  milestoneNumber: number;
  title: string;
  chapterIndex?: number;
  shotCount: number;
  durationSec: number;
  cameraSystem: string;
  aspectRatio: string;
  targetResolution: ResolutionTier;
  continuityHighlight: string;
  approvedAt: string;
}

export type UserRole = 'director' | 'admin';

export interface AdminAgentProfile {
  strictContinuityMode: boolean;
  preferredVisualGrammar: string;
  customDirectives: string;
  targetAudienceTone: string;
  updatedAt: string;
}

export interface SequenceLocalMetrics {
  shotCount: number;
  screenplaySceneCount: number;
  screenplayBeatCount: number;
  dialogueBeatCount: number;
  storyboardCount: number;
  voiceOverCount: number;
  hasContinuityBible: boolean;
  hasHyperRealisticPrompt: boolean;
  readinessScore: number;
}

export interface AgentDiagnosticReport {
  coherenceScore: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  continuityRisks: string[];
  recommendedLessons: Array<{
    category: LearningCategory;
    insight: string;
    rating: number;
  }>;
  localMetrics: SequenceLocalMetrics;
  auditedAt: string;
}

export type ApiCapability = 'image' | 'video' | 'core';

export type ApiBillingTier = 'free' | 'paid' | 'auto';

export type ApiProviderKind =
  | 'gemini'
  | 'openai'
  | 'huggingface'
  | 'fal'
  | 'replicate'
  | 'pollinations'
  | 'custom_rest';

export interface ApiProviderInput {
  capability: ApiCapability;
  providerHint?: ApiProviderKind | 'auto';
  tierHint?: ApiBillingTier;
  endpointUrl?: string;
  apiKey?: string;
  model?: string;
  authHeader?: string;
  authPrefix?: string;
  label?: string;
}

export interface ApiProviderPublicSummary {
  capability: ApiCapability;
  configured: boolean;
  source: 'user_vault' | 'server_env' | 'none';
  providerKind: ApiProviderKind | null;
  label: string;
  tier: 'free' | 'paid' | 'unknown';
  model: string;
  endpointUrl: string;
  hasKey: boolean;
  keyPreview: string;
  authHeader: string;
  authPrefix: string;
  supportsImageToVideo?: boolean;
  lastTestedAt?: string;
  lastStatus: 'ready' | 'unconfigured' | 'error';
  lastMessage: string;
}

export interface ExternalGuideStepItem {
  stepCode: string;
  title: string;
  subtitle?: string;
  specs: Array<{ label: string; value: string }>;
  instructions: string;
  copyPromptLabel?: string;
  copyPromptText?: string;
  notes?: string;
}

export interface ExternalGuideSection {
  stepNumber: number;
  id: string;
  title: string;
  platformHint: string;
  summary: string;
  items: ExternalGuideStepItem[];
}

export interface ExternalProductionGuide {
  agentName: string;
  generatedAt: string;
  scope: 'sequence' | 'project';
  projectTitle: string;
  genreStyle: string;
  sequenceTitle: string;
  aspectRatio: string;
  targetResolution: ResolutionTier;
  sections: ExternalGuideSection[];
  markdown: string;
  plainText: string;
}

