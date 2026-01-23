// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CommandPaletteController,
  type CommandPaletteControllerOptions,
  type SearchApiResult,
} from './commandPaletteController';

describe('CommandPaletteController', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const buildController = () => {
    const overlay = document.createElement('div');
    const palette = document.createElement('div');
    const input = document.createElement('input');
    const ghost = document.createElement('div');
    const results = document.createElement('div');
    const closeButton = document.createElement('button');
    const triggerButton = document.createElement('button');

    overlay.appendChild(palette);
    palette.appendChild(input);
    palette.appendChild(ghost);
    palette.appendChild(results);
    document.body.appendChild(overlay);

    const fetchScopes = vi.fn(async () => []);
    const fetchResults = vi.fn<CommandPaletteControllerOptions['fetchResults']>(async () => ({
      results: [],
    }));
    const resolveIcon = vi.fn(() => '<svg></svg>');

    const controller = new CommandPaletteController({
      overlay,
      palette,
      input,
      ghost,
      results,
      closeButton,
      triggerButton,
      fetchScopes,
      fetchResults,
      getSelectedPanelId: () => null,
      onLaunch: vi.fn(),
      resolveIcon,
    });

    controller.attach();

    return {
      controller,
      input,
      fetchResults,
      resolveIcon,
    };
  };

  it('passes search results to resolveIcon', async () => {
    const { controller, input, fetchResults, resolveIcon } = buildController();
    const result: SearchApiResult = {
      pluginId: 'lists',
      instanceId: 'default',
      id: 'item-1',
      title: 'First item',
      subtitle: 'Tasks',
      launch: {
        panelType: 'lists',
        payload: {
          type: 'lists_show',
          listId: 'tasks',
          itemId: 'item-1',
        },
      },
    };

    fetchResults.mockResolvedValueOnce({ results: [result] });

    controller.open();
    input.value = 'first';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.runAllTimersAsync();

    expect(fetchResults).toHaveBeenCalled();
    expect(resolveIcon).toHaveBeenCalledWith(result);
  });
});
