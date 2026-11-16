import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { ProductionSequence } from '../types/studio';

interface VisionViewProps {
  sequence: ProductionSequence;
}

export function VisionView({ sequence }: VisionViewProps) {
  const [copiedHex, setCopiedHex] = useState<string | null>(null);

  async function handleCopyHex(hex: string) {
    try {
      await navigator.clipboard.writeText(hex);
      setCopiedHex(hex);
      setTimeout(() => setCopiedHex(null), 1400);
    } catch {
      // Clipboard blocked in non-secure context; ignore silently
    }
  }

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Logline & Director Vision */}
      <section aria-labelledby="vision-heading" className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#9A968E] font-mono-tech">
          <span>{sequence.directorStyle}</span>
          <span aria-hidden="true">·</span>
          <span>Formato {sequence.aspectRatio}</span>
          {sequence.sourceFilename && (
            <>
              <span aria-hidden="true">·</span>
              <span>Fuente: {sequence.sourceFilename}</span>
            </>
          )}
        </div>

        <h2
          id="vision-heading"
          className="font-display text-2xl sm:text-3xl font-semibold text-[#F2F0EB] leading-tight text-balance max-w-3xl"
        >
          {sequence.logline}
        </h2>

        <p className="text-[15px] text-[#CFCAC0] leading-relaxed max-w-[70ch]">
          {sequence.directorVision}
        </p>
      </section>

      {/* Camera & Optical Package */}
      <section aria-labelledby="optics-heading" className="pt-6 border-t border-white/10">
        <h3 id="optics-heading" className="font-display text-sm font-semibold text-[#E5A93C] mb-4">
          01. Paquete Óptico y Cámara
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl border border-white/10 bg-[#131318]">
            <div className="text-xs text-[#8D8981] mb-1">Sistema de Cámara</div>
            <div className="text-sm font-semibold text-[#F2F0EB]">{sequence.cameraSystem}</div>
          </div>
          <div className="p-4 rounded-xl border border-white/10 bg-[#131318]">
            <div className="text-xs text-[#8D8981] mb-1">Juego de Lentes</div>
            <div className="text-sm font-semibold text-[#F2F0EB]">{sequence.lensPackage}</div>
          </div>
          <div className="p-4 rounded-xl border border-white/10 bg-[#131318]">
            <div className="text-xs text-[#8D8981] mb-1">Emulsión / LUT Maestro</div>
            <div className="text-sm font-semibold text-[#F2F0EB]">{sequence.filmStockOrLut}</div>
          </div>
        </div>
      </section>

      {/* Color Palette */}
      <section aria-labelledby="palette-heading" className="pt-6 border-t border-white/10">
        <h3 id="palette-heading" className="font-display text-sm font-semibold text-[#E5A93C] mb-4">
          02. Paleta de Color y Colorimetría
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {sequence.colorPalette.map((swatch) => (
            <button
              key={`${swatch.name}-${swatch.hex}`}
              type="button"
              onClick={() => handleCopyHex(swatch.hex)}
              className="group text-left rounded-xl border border-white/10 bg-[#131318] overflow-hidden hover:border-white/25 transition-colors focus-visible:outline-2 focus-visible:outline-[#E5A93C]"
            >
              <div
                className="h-16 w-full border-b border-white/10"
                style={{ backgroundColor: swatch.hex }}
              />
              <div className="p-3">
                <div className="text-xs font-semibold text-[#F2F0EB] truncate">{swatch.name}</div>
                <div className="mt-1 flex items-center justify-between text-[11px] font-mono-tech text-[#8D8981]">
                  <span>{swatch.hex}</span>
                  {copiedHex === swatch.hex ? (
                    <Check className="w-3 h-3 text-[#22C55E]" />
                  ) : (
                    <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </div>
                <div className="mt-1 text-[11px] text-[#7D7971] line-clamp-1">{swatch.role}</div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Lighting Plot */}
      <section aria-labelledby="lighting-heading" className="pt-6 border-t border-white/10">
        <h3 id="lighting-heading" className="font-display text-sm font-semibold text-[#E5A93C] mb-4">
          03. Esquema de Iluminación y Atmósfera
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl border border-white/10 bg-[#131318] space-y-3">
            <div>
              <div className="text-xs text-[#8D8981]">Luz Principal (Key Light)</div>
              <div className="text-sm text-[#EAE6DE] mt-0.5">{sequence.lighting.keyLight}</div>
            </div>
            <div className="pt-3 border-t border-white/5">
              <div className="text-xs text-[#8D8981]">Ratio de Contraste / Relleno</div>
              <div className="text-sm text-[#EAE6DE] mt-0.5">{sequence.lighting.fillRatio}</div>
            </div>
            <div className="pt-3 border-t border-white/5">
              <div className="text-xs text-[#8D8981]">Contraluz y Perfilado (Rim)</div>
              <div className="text-sm text-[#EAE6DE] mt-0.5">{sequence.lighting.rimAndBacklight}</div>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-white/10 bg-[#131318] space-y-3">
            <div>
              <div className="text-xs text-[#8D8981]">Temperaturas de Color (Kelvin)</div>
              <div className="text-sm font-mono-tech text-[#EAE6DE] mt-0.5">
                {sequence.lighting.colorTemperatureKelvin}
              </div>
            </div>
            <div className="pt-3 border-t border-white/5">
              <div className="text-xs text-[#8D8981]">Densidad Atmosférica y Niebla</div>
              <div className="text-sm text-[#EAE6DE] mt-0.5">{sequence.lighting.atmosphereAndHaze}</div>
            </div>
          </div>
        </div>
      </section>

      {/* VFX, Practical SFX & Production Design */}
      <section aria-labelledby="vfx-heading" className="pt-6 border-t border-white/10">
        <h3 id="vfx-heading" className="font-display text-sm font-semibold text-[#E5A93C] mb-4">
          04. Diseño de Producción, VFX y Efectos Prácticos
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl border border-white/10 bg-[#131318]">
            <div className="text-xs font-medium text-[#C8C3BA] mb-2">
              Efectos Visuales (CGI / Simulación)
            </div>
            <ul className="space-y-1.5 text-sm text-[#D4CFC7] list-disc pl-4">
              {sequence.vfx.cgiElements.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
            <div className="mt-4 pt-3 border-t border-white/5">
              <div className="text-xs font-medium text-[#C8C3BA] mb-2">
                Efectos Prácticos en Set (SFX)
              </div>
              <ul className="space-y-1.5 text-sm text-[#D4CFC7] list-disc pl-4">
                {sequence.vfx.practicalSfx.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-white/10 bg-[#131318] space-y-4">
            <div>
              <div className="text-xs font-medium text-[#C8C3BA] mb-1">
                Locaciones y Construcción de Set
              </div>
              <p className="text-sm text-[#D4CFC7] leading-relaxed">
                {sequence.vfx.locationsAndSets}
              </p>
            </div>
            <div className="pt-3 border-t border-white/5">
              <div className="text-xs font-medium text-[#C8C3BA] mb-1">
                Vestuario, Texturas y Caracterización
              </div>
              <p className="text-sm text-[#D4CFC7] leading-relaxed">
                {sequence.vfx.wardrobeAndMakeup}
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
