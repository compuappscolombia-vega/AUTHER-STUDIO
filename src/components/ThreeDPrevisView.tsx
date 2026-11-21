import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Box, Camera, ChevronDown, ChevronUp, Sun } from 'lucide-react';
import type { ProductionSequence } from '../types/studio';
import { parseAspectRatio } from '../utils/studioLogic';

interface ThreeDPrevisViewProps {
  sequence: ProductionSequence;
}

type CameraPresetId = 'ews' | 'ms' | 'cu' | 'crane';
type KelvinPresetId = '3200K' | '4500K' | '5600K';

interface CameraPreset {
  id: CameraPresetId;
  label: string;
  lensMm: number;
  fov: number;
  position: [number, number, number];
  target: [number, number, number];
}

const CAMERA_PRESETS: CameraPreset[] = [
  {
    id: 'ews',
    label: 'Gran Plano (18mm)',
    lensMm: 18,
    fov: 58,
    position: [7.6, 3.2, 8.8],
    target: [0, 1.35, -0.5],
  },
  {
    id: 'ms',
    label: 'Plano Medio (35mm)',
    lensMm: 35,
    fov: 38,
    position: [4.1, 1.85, 5.1],
    target: [0, 1.35, -0.4],
  },
  {
    id: 'cu',
    label: 'Primer Plano (85mm)',
    lensMm: 85,
    fov: 22,
    position: [1.65, 1.55, 3.25],
    target: [0, 1.48, -0.4],
  },
  {
    id: 'crane',
    label: 'Grúa Cenital (24mm)',
    lensMm: 24,
    fov: 48,
    position: [-5.6, 5.4, 6.2],
    target: [0, 1.1, -0.4],
  },
];

const KELVIN_LIGHT_COLOR: Record<KelvinPresetId, { hex: number; label: string }> = {
  '3200K': { hex: 0xffb86b, label: '3200K Tungsteno' },
  '4500K': { hex: 0xffe2b5, label: '4500K Ámbar Cine' },
  '5600K': { hex: 0xddeaff, label: '5600K Luz Día' },
};

function createAsphaltRoughnessTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#181a20';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2400; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const v = 22 + Math.floor(Math.random() * 26);
      ctx.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.strokeStyle = 'rgba(229, 169, 60, 0.08)';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 256; g += 32) {
      ctx.beginPath();
      ctx.moveTo(g, 0);
      ctx.lineTo(g, 256);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, g);
      ctx.lineTo(256, g);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
    grad.addColorStop(0, 'rgba(0,0,0,0.68)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.28)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function parsePaletteHex(rawHex: string | undefined, fallback: number): number {
  if (!rawHex || !/^#[0-9a-fA-F]{6}$/.test(rawHex.trim())) return fallback;
  return Number.parseInt(rawHex.trim().slice(1), 16);
}

// Multi-part hero cinema camera + dolly track assembly (bottom-center origin y=0)
function buildCinemaDollyRig(): { group: THREE.Group; tallyMat: THREE.MeshStandardMaterial } {
  const group = new THREE.Group();
  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x3b3f4a,
    metalness: 0.78,
    roughness: 0.34,
  });
  const matteBodyMat = new THREE.MeshStandardMaterial({
    color: 0x16181e,
    metalness: 0.35,
    roughness: 0.62,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xe5a93c,
    metalness: 0.7,
    roughness: 0.32,
  });
  const tallyMat = new THREE.MeshStandardMaterial({
    color: 0xe5a93c,
    emissive: 0xe5a93c,
    emissiveIntensity: 1.4,
    roughness: 0.25,
  });

  // 2 parallel dolly rails
  for (const offsetX of [-0.42, 0.42]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 5.2, 12), steelMat);
    rail.rotation.x = Math.PI / 2;
    rail.position.set(offsetX, 0.05, 0);
    rail.castShadow = true;
    rail.receiveShadow = true;
    group.add(rail);
  }
  // 5 cross sleepers
  for (let i = -2; i <= 2; i++) {
    const sleeper = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.035, 0.1), matteBodyMat);
    sleeper.position.set(0, 0.018, i * 1.15);
    sleeper.receiveShadow = true;
    group.add(sleeper);
  }
  // Dolly chassis sled
  const sled = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 1.25), matteBodyMat);
  sled.position.set(0, 0.16, 0);
  sled.castShadow = true;
  group.add(sled);

  // Hydraulic pedestal column + collar
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 1.05, 16), steelMat);
  column.position.set(0, 0.72, 0);
  column.castShadow = true;
  group.add(column);

  const fluidHead = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.34), brassMat);
  fluidHead.position.set(0, 1.28, 0);
  fluidHead.castShadow = true;
  group.add(fluidHead);

  // Camera body + top handle + matte box + prime lens barrel
  const camBody = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.26, 0.48), matteBodyMat);
  camBody.position.set(0, 1.48, 0.02);
  camBody.castShadow = true;
  group.add(camBody);

  const lensBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.28, 16), steelMat);
  lensBarrel.rotation.x = Math.PI / 2;
  lensBarrel.position.set(0, 1.48, -0.34);
  lensBarrel.castShadow = true;
  group.add(lensBarrel);

  const matteBox = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.09), matteBodyMat);
  matteBox.position.set(0, 1.48, -0.5);
  group.add(matteBox);

  const tallyBezel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.03), tallyMat);
  tallyBezel.position.set(0, 1.63, -0.18);
  group.add(tallyBezel);

  return { group, tallyMat };
}

// Multi-part studio Fresnel practical light stand (bottom-center origin y=0)
function buildFresnelStand(kelvinHex: number): {
  group: THREE.Group;
  bulbMat: THREE.MeshStandardMaterial;
} {
  const group = new THREE.Group();
  const standMat = new THREE.MeshStandardMaterial({
    color: 0x24262e,
    metalness: 0.65,
    roughness: 0.42,
  });
  const housingMat = new THREE.MeshStandardMaterial({
    color: 0x15161c,
    metalness: 0.4,
    roughness: 0.55,
  });
  const bulbMat = new THREE.MeshStandardMaterial({
    color: kelvinHex,
    emissive: kelvinHex,
    emissiveIntensity: 2.2,
    roughness: 0.15,
  });

  // 3 tripod legs angled cleanly to floor y=0
  for (let i = 0; i < 3; i++) {
    const angle = (i * Math.PI * 2) / 3;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.05, 8), standMat);
    leg.position.set(Math.cos(angle) * 0.34, 0.44, Math.sin(angle) * 0.34);
    leg.rotation.z = Math.cos(angle) * 0.55;
    leg.rotation.x = -Math.sin(angle) * 0.55;
    leg.castShadow = true;
    group.add(leg);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 2.2, 10), standMat);
  mast.position.set(0, 1.65, 0);
  mast.castShadow = true;
  group.add(mast);

  const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.32, 16), housingMat);
  housing.rotation.x = Math.PI / 2;
  housing.position.set(0, 2.75, 0);
  housing.castShadow = true;
  group.add(housing);

  const lensFace = new THREE.Mesh(new THREE.CircleGeometry(0.155, 16), bulbMat);
  lensFace.position.set(0, 2.75, 0.165);
  group.add(lensFace);

  // Barn doors
  for (const side of [-1, 1]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.28, 0.18), housingMat);
    door.position.set(side * 0.2, 2.75, 0.22);
    door.rotation.y = side * -0.4;
    group.add(door);
  }

  return { group, bulbMat };
}

// Multi-part hero architectural focal subject synced to sequence palette (bottom-center origin y=0)
function buildHeroSetpiece(primaryHex: number, accentHex: number): THREE.Group {
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({
    color: primaryHex,
    metalness: 0.18,
    roughness: 0.72,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x20232b,
    metalness: 0.6,
    roughness: 0.38,
  });
  const beaconMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    emissive: accentHex,
    emissiveIntensity: 1.5,
    roughness: 0.2,
  });

  // Stepped architectural plinth
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.28, 1.8), trimMat);
  plinth.position.set(0, 0.14, 0);
  plinth.receiveShadow = true;
  plinth.castShadow = true;
  group.add(plinth);

  const columnBase = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.65, 0.95), stoneMat);
  columnBase.position.set(0, 1.1, 0);
  columnBase.castShadow = true;
  columnBase.receiveShadow = true;
  group.add(columnBase);

  const upperCrown = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.52, 0.72), trimMat);
  upperCrown.position.set(0, 2.18, 0);
  upperCrown.castShadow = true;
  group.add(upperCrown);

  const signalCore = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.42, 16), beaconMat);
  signalCore.position.set(0, 2.65, 0);
  group.add(signalCore);

  // Foreground character blocking silhouette (abstract articulated mannequin proxy, 4 parts)
  const actorMat = new THREE.MeshStandardMaterial({
    color: 0xc9b99b,
    metalness: 0.1,
    roughness: 0.75,
  });
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.72, 12), actorMat);
  torso.position.set(-0.95, 1.12, 0.72);
  torso.castShadow = true;
  group.add(torso);

  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.76, 12), trimMat);
  legs.position.set(-0.95, 0.38, 0.72);
  legs.castShadow = true;
  group.add(legs);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 12), actorMat);
  head.position.set(-0.95, 1.62, 0.72);
  head.castShadow = true;
  group.add(head);

  return group;
}

export function ThreeDPrevisView({ sequence }: ThreeDPrevisViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activePreset, setActivePreset] = useState<CameraPresetId>('ms');
  const [kelvin, setKelvin] = useState<KelvinPresetId>('4500K');
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [softwareMode, setSoftwareMode] = useState(false);

  const targetPresetRef = useRef<CameraPreset>(CAMERA_PRESETS[1]);
  const presetTransitionRef = useRef<boolean>(false);
  const kelvinRef = useRef<KelvinPresetId>('4500K');
  const requestRenderRef = useRef<() => void>(() => {});

  const ratioValue = parseAspectRatio(sequence.aspectRatio);
  const primaryPaletteHex = parsePaletteHex(sequence.colorPalette?.[0]?.hex, 0x2b3342);
  const accentPaletteHex = parsePaletteHex(sequence.colorPalette?.[1]?.hex, 0xe5a93c);

  useEffect(() => {
    const found = CAMERA_PRESETS.find((p) => p.id === activePreset) || CAMERA_PRESETS[1];
    targetPresetRef.current = found;
    presetTransitionRef.current = true;
    requestRenderRef.current();
  }, [activePreset]);

  useEffect(() => {
    kelvinRef.current = kelvin;
    requestRenderRef.current();
  }, [kelvin]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = Math.max(320, container.clientWidth);
    const height = Math.max(260, container.clientHeight);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });

    const gl = renderer.getContext();
    const debugExt = gl.getExtension('WEBGL_debug_renderer_info');
    const glVendor = debugExt
      ? String(gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL) || '')
      : '';
    const isSoftwareGl = /SwiftShader|llvmpipe|Software/i.test(glVendor);
    setSoftwareMode(isSoftwareGl);

    renderer.setPixelRatio(
      isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    );
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const bgHex = 0x0b0c10;
    scene.background = new THREE.Color(bgHex);
    scene.fog = new THREE.FogExp2(bgHex, 0.042);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    camera.position.set(4.1, 1.85, 5.1);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.35, -0.4);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.8;
    controls.maxDistance = 18;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.update();

    // Lighting rig: cool sky/ground fill + warm adjustable Kelvin key light
    const hemiLight = new THREE.HemisphereLight(0x8fa8d6, 0x26201a, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(KELVIN_LIGHT_COLOR['4500K'].hex, 2.8);
    keyLight.position.set(4.8, 6.2, 4.2);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 1;
      keyLight.shadow.camera.far = 22;
      keyLight.shadow.camera.left = -6;
      keyLight.shadow.camera.right = 6;
      keyLight.shadow.camera.top = 6;
      keyLight.shadow.camera.bottom = -6;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38b2ac, 1.15);
    rimLight.position.set(-4.5, 3.6, -4.5);
    scene.add(rimLight);

    // Stage Floor
    const floorTex = createAsphaltRoughnessTexture(
      renderer.capabilities.getMaxAnisotropy()
    );
    const floorGeo = new THREE.PlaneGeometry(36, 36);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x16181e,
      map: floorTex,
      roughness: 0.84,
      metalness: 0.12,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Contact shadow sprites under assemblies
    const shadowTex = createContactShadowTexture();
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
    });

    const addShadowPlane = (x: number, z: number, scale: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(scale, scale), shadowMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.008, z);
      scene.add(m);
    };

    // Hero assemblies
    const heroSetpiece = buildHeroSetpiece(primaryPaletteHex, accentPaletteHex);
    heroSetpiece.position.set(0, 0, -1.6);
    scene.add(heroSetpiece);
    addShadowPlane(0, -1.6, 3.8);
    addShadowPlane(-0.95, -0.88, 1.1);

    const { group: dollyGroup } = buildCinemaDollyRig();
    dollyGroup.position.set(0.4, 0, 2.2);
    scene.add(dollyGroup);
    addShadowPlane(0.4, 2.2, 2.4);

    const { group: fresnelGroup, bulbMat } = buildFresnelStand(
      KELVIN_LIGHT_COLOR['4500K'].hex
    );
    fresnelGroup.position.set(2.9, 0, 1.1);
    fresnelGroup.lookAt(0, 1.5, -1.4);
    scene.add(fresnelGroup);
    addShadowPlane(2.9, 1.1, 1.6);

    let disposed = false;
    let rafId = 0;
    let needsRender = true;
    let lastTime = performance.now();

    const requestRender = () => {
      needsRender = true;
      if (!rafId && !disposed) {
        rafId = window.requestAnimationFrame(tick);
      }
    };
    requestRenderRef.current = requestRender;

    const handleControlChange = () => {
      presetTransitionRef.current = false;
      requestRender();
    };
    controls.addEventListener('change', handleControlChange);

    const afterDraw = () => {
      if (isSoftwareGl) {
        needsRender = false;
        rafId = 0;
      }
    };

    function tick(now: number) {
      rafId = 0;
      if (disposed) return;

      const dt = Math.min(0.08, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      // Sync Kelvin light color
      const targetColorHex = KELVIN_LIGHT_COLOR[kelvinRef.current].hex;
      keyLight.color.setHex(targetColorHex);
      bulbMat.color.setHex(targetColorHex);
      bulbMat.emissive.setHex(targetColorHex);

      // Smooth damped camera preset transitions
      let animatingPreset = false;
      if (presetTransitionRef.current) {
        const p = targetPresetRef.current;
        camera.position.x = THREE.MathUtils.damp(camera.position.x, p.position[0], 5.5, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, p.position[1], 5.5, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, p.position[2], 5.5, dt);
        controls.target.x = THREE.MathUtils.damp(controls.target.x, p.target[0], 5.5, dt);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, p.target[1], 5.5, dt);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, p.target[2], 5.5, dt);
        camera.fov = THREE.MathUtils.damp(camera.fov, p.fov, 6.0, dt);
        camera.updateProjectionMatrix();

        const dist = camera.position.distanceTo(
          new THREE.Vector3(p.position[0], p.position[1], p.position[2])
        );
        if (dist < 0.025 && Math.abs(camera.fov - p.fov) < 0.15) {
          presetTransitionRef.current = false;
        } else {
          animatingPreset = true;
        }
      }

      controls.update();
      renderer.render(scene, camera);

      if (animatingPreset || (!isSoftwareGl && needsRender)) {
        needsRender = animatingPreset;
        if (animatingPreset) {
          rafId = window.requestAnimationFrame(tick);
        } else {
          afterDraw();
        }
      } else {
        afterDraw();
      }
    }

    requestRender();

    const resizeObserver = new ResizeObserver(() => {
      if (!container || disposed) return;
      const w = Math.max(320, container.clientWidth);
      const h = Math.max(260, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      controls.removeEventListener('change', handleControlChange);
      controls.dispose();
      envTex.dispose();
      pmremGenerator.dispose();
      floorTex.dispose();
      shadowTex.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material?.dispose();
          }
        }
      });
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [primaryPaletteHex, accentPaletteHex, sequence.id]);

  const currentPresetMeta =
    CAMERA_PRESETS.find((p) => p.id === activePreset) || CAMERA_PRESETS[1];

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Box className="w-4 h-4 text-amber-600 dark:text-[#E5A93C]" />
            <h2 className="font-display text-lg font-semibold text-[#18181B] dark:text-[#F2F0EB]">
              Previsualización 3D de Set y Bloqueo de Cámara
            </h2>
          </div>
          <p className="text-xs text-[#57534E] dark:text-[#8D8981] mt-0.5">
            Arrastra para orbitar, usa la rueda para zoom o cambia de lente y temperatura Kelvin antes de renderizar Nano/Omni Flash.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono-tech text-[#57534E] dark:text-[#9A968E] tabular-nums">
          <span>{sequence.cameraSystem}</span>
          <span aria-hidden="true">·</span>
          <span className="text-amber-700 dark:text-[#E5A93C]">
            {currentPresetMeta.lensMm}mm · {sequence.aspectRatio}
          </span>
          {softwareMode && (
            <>
              <span aria-hidden="true">·</span>
              <span>Modo WebGL Ligero</span>
            </>
          )}
        </div>
      </div>

      {/* 3D Cinema Stage */}
      <div className="relative rounded-xl border border-[#D4CEC2] dark:border-white/12 bg-[#0B0C10] overflow-hidden h-[500px] sm:h-[540px]">
        <div
          ref={containerRef}
          aria-label="Escenario 3D interactivo de previsualización"
          className="w-full h-full cursor-grab active:cursor-grabbing"
        />

        {/* Subtle Optical Aspect-Ratio Viewfinder Gate Overlay */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <div
            className="border border-[#E5A93C]/35 rounded-sm transition-all duration-300"
            style={{
              width: ratioValue >= 1.7 ? '84%' : '56%',
              aspectRatio: `${ratioValue}`,
              maxHeight: '80%',
            }}
          >
            <div className="px-2 py-1 text-[10px] font-mono-tech text-[#E5A93C]/85">
              {sequence.aspectRatio} · {currentPresetMeta.lensMm}MM · {kelvin}
            </div>
          </div>
        </div>

        {/* Compact Collapsible Control Dock (<= 15% height, solid opaque bg over canvas) */}
        <div className="absolute bottom-3 left-3 right-3 flex justify-center pointer-events-none">
          <div className="pointer-events-auto rounded-xl border border-white/15 bg-[#121218] px-3 py-2 shadow-xl max-w-full">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-[#E5A93C] whitespace-nowrap">
                <Camera className="w-3.5 h-3.5" />
                <span>Controles de Cámara y Luz</span>
              </div>
              <button
                type="button"
                onClick={() => setDockCollapsed((v) => !v)}
                aria-label={dockCollapsed ? 'Expandir controles 3D' : 'Colapsar controles 3D'}
                className="p-1 rounded hover:bg-white/10 text-[#C8C3BA]"
              >
                {dockCollapsed ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            {!dockCollapsed && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {CAMERA_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setActivePreset(preset.id)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${
                        activePreset === preset.id
                          ? 'bg-[#E5A93C] text-[#0B0B0E] font-semibold'
                          : 'bg-[#1A1A23] text-[#D4CFC7] hover:bg-[#232330]'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <span aria-hidden="true" className="hidden sm:inline text-white/15">
                  |
                </span>

                <div className="flex items-center gap-1.5">
                  <Sun className="w-3.5 h-3.5 text-[#E5A93C]" />
                  {(Object.keys(KELVIN_LIGHT_COLOR) as KelvinPresetId[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKelvin(k)}
                      className={`px-2 py-1 rounded-md text-[11px] font-mono-tech whitespace-nowrap transition-colors ${
                        kelvin === k
                          ? 'bg-[#38B2AC] text-[#0B0B0E] font-semibold'
                          : 'bg-[#1A1A23] text-[#C8C3BA] hover:bg-[#232330]'
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
