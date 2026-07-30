type FontFaceSetLike = {
  load: (font: string, text?: string) => Promise<unknown>;
};

export async function ensureTerminalFontLoaded(
  fontFamily: string,
  fontFaceSet: FontFaceSetLike | undefined = globalThis.document?.fonts,
): Promise<void> {
  const trimmed = fontFamily.trim();
  if (!trimmed || !fontFaceSet || typeof fontFaceSet.load !== 'function') {
    return;
  }

  try {
    await fontFaceSet.load(`400 13px ${trimmed}`, 'Assistant');
  } catch {
    // The terminal can continue with the fallback family when a font cannot load.
  }
}

export function resolveTerminalFontFamilyChange(
  currentFontFamily: string,
  nextFontFamily: string,
): string | null {
  const normalized = nextFontFamily.trim();
  return normalized && normalized !== currentFontFamily ? normalized : null;
}
