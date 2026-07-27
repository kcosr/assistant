export interface TextareaAutosizeTarget {
  scrollHeight: number;
  clientHeight?: number;
  offsetHeight?: number;
  style: {
    height: string;
  };
}

export function autosizeTextarea(textarea: TextareaAutosizeTarget): void {
  textarea.style.height = 'auto';
  const borderHeight =
    typeof textarea.offsetHeight === 'number' && typeof textarea.clientHeight === 'number'
      ? Math.max(0, textarea.offsetHeight - textarea.clientHeight)
      : 0;
  textarea.style.height = `${textarea.scrollHeight + borderHeight}px`;
}
