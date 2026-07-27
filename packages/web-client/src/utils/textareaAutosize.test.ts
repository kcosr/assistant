import { describe, expect, it } from 'vitest';
import { autosizeTextarea } from './textareaAutosize';

describe('autosizeTextarea', () => {
  it('sizes a textarea to its wrapped content height', () => {
    const textarea = {
      scrollHeight: 84,
      style: { height: '40px' },
    };

    autosizeTextarea(textarea);

    expect(textarea.style.height).toBe('84px');
  });

  it('includes the border height for border-box textareas', () => {
    const textarea = {
      scrollHeight: 84,
      clientHeight: 80,
      offsetHeight: 82,
      style: { height: '40px' },
    };

    autosizeTextarea(textarea);

    expect(textarea.style.height).toBe('86px');
  });
});
