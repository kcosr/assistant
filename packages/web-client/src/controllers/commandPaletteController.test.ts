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
    window.localStorage.clear();
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
    const sortButton = document.createElement('button');

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
      sortButton,
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

  it('consumes Escape so it does not reach other handlers', () => {
    const { controller, input } = buildController();
    controller.open();

    const spy = vi.fn();
    document.addEventListener('keydown', spy);

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input.dispatchEvent(event);

    expect(spy).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);

    document.removeEventListener('keydown', spy);
  });

  it('sorts list items first when configured', async () => {
    window.localStorage.setItem('aiAssistantCommandPaletteSortMode', 'items');
    const { controller, input, fetchResults } = buildController();
    const results: SearchApiResult[] = [
      {
        pluginId: 'notes',
        instanceId: 'default',
        id: 'note-1',
        title: 'Project note',
        launch: {
          panelType: 'notes',
          payload: { type: 'notes_show', title: 'Project note' },
        },
      },
      {
        pluginId: 'lists',
        instanceId: 'default',
        id: 'list:tasks',
        title: 'Tasks',
        launch: {
          panelType: 'lists',
          payload: { type: 'lists_show', listId: 'tasks' },
        },
      },
      {
        pluginId: 'lists',
        instanceId: 'default',
        id: 'item-1',
        title: 'Buy milk',
        launch: {
          panelType: 'lists',
          payload: { type: 'lists_show', listId: 'tasks', itemId: 'item-1' },
        },
      },
    ];

    fetchResults.mockResolvedValueOnce({ results });

    controller.open();
    input.value = 'milk';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.runAllTimersAsync();

    const titles = Array.from(
      document.querySelectorAll<HTMLElement>('.command-palette-item-title'),
    ).map((el) => el.textContent);
    expect(titles).toEqual(['Buy milk', 'Tasks', 'Project note']);
  });

  it('routes /favorites to the favorites query', async () => {
    const { controller, input, fetchResults } = buildController();
    fetchResults.mockResolvedValueOnce({ results: [] });

    controller.open();
    input.value = '/favorites';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.runAllTimersAsync();

    expect(fetchResults).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'favorite:true' }),
    );
  });

  it('renders group headers by result type', async () => {
    window.localStorage.setItem('aiAssistantCommandPaletteGroupMode', 'type');
    const { controller, input, fetchResults } = buildController();
    const results: SearchApiResult[] = [
      {
        pluginId: 'notes',
        instanceId: 'default',
        id: 'note-1',
        title: 'Project note',
        launch: {
          panelType: 'notes',
          payload: { type: 'notes_show', title: 'Project note' },
        },
      },
      {
        pluginId: 'lists',
        instanceId: 'default',
        id: 'list:tasks',
        title: 'Tasks',
        launch: {
          panelType: 'lists',
          payload: { type: 'lists_show', listId: 'tasks' },
        },
      },
      {
        pluginId: 'lists',
        instanceId: 'default',
        id: 'item-1',
        title: 'Buy milk',
        launch: {
          panelType: 'lists',
          payload: { type: 'lists_show', listId: 'tasks', itemId: 'item-1' },
        },
      },
    ];

    fetchResults.mockResolvedValueOnce({ results });

    controller.open();
    input.value = 'milk';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.runAllTimersAsync();

    const headers = Array.from(
      document.querySelectorAll<HTMLElement>('.command-palette-group'),
    ).map((el) => el.textContent);
    expect(headers).toEqual(['List items', 'Lists', 'Notes']);
  });
});
