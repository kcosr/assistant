// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelFactory, PanelHost } from '../../../../web-client/src/controllers/panelRegistry';
import { DialogManager } from '../../../../web-client/src/controllers/dialogManager';

const STORAGE_KEY = 'aiAssistantFocusDefaultListId';

describe('virtual list add editor', () => {
  let factory: PanelFactory;
  let unmount: (() => void) | undefined;
  let dialogManager: DialogManager;
  const lists = [
    { id: 'work', name: 'Work', defaultTags: ['work'], customFields: [] },
    { id: 'home', name: 'Home', defaultTags: ['home'], customFields: [] },
  ];
  let availableLists = lists;
  let failAdd = false;
  let operations: Array<{ operation: string; body: Record<string, unknown> }>;
  const setStatus = vi.fn();

  beforeEach(async () => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    availableLists = lists;
    failAdd = false;
    operations = [];
    setStatus.mockClear();
    dialogManager = new DialogManager();
    vi.stubGlobal('ASSISTANT_PANEL_REGISTRY', {
      registerPanel: (_type: string, registered: PanelFactory) => {
        factory = registered;
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const operation = input.toString().split('/').pop() ?? '';
        const body = init?.body ? JSON.parse(init.body as string) : {};
        operations.push({ operation, body });
        let result: unknown = [];
        switch (operation) {
          case 'instance_list':
            result = [{ id: 'default', label: 'Default' }];
            break;
          case 'list':
            result = availableLists;
            break;
          case 'get':
            result = lists.find((list) => list.id === body.id);
            break;
          case 'focus-get':
            result = { id: '__focus__', name: 'Focus' };
            break;
          case 'pinned-get':
            result = { id: '__pinned__', name: 'Pinned' };
            break;
          case 'item-add':
            if (failAdd) {
              return new Response(JSON.stringify({ ok: false, error: 'Add failed' }), {
                status: 500,
              });
            }
            result = { id: 'new-item', title: body.title };
            break;
        }
        return new Response(JSON.stringify({ ok: true, result }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    window.fetch = fetch;
    vi.resetModules();
    await import('./index');
  });

  afterEach(() => {
    dialogManager.closeOpenDialog();
    unmount?.();
    unmount = undefined;
    vi.unstubAllGlobals();
    window.localStorage.clear();
    document.body.innerHTML = '';
  });

  const mount = async (listId = '__focus__') => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const context = new Map<string, unknown>([
      [
        'core.services',
        {
          dialogManager,
          contextMenuManager: { close: () => undefined, setActiveMenu: () => undefined },
          focusInput: () => undefined,
          setStatus,
          isMobileViewport: () => true,
          notifyContextAvailabilityChange: () => undefined,
        },
      ],
    ]);
    const host = {
      panelId: () => 'lists-focus-add',
      getContext: (key: string) => context.get(key) ?? null,
      subscribeContext: () => () => undefined,
      setContext: (key: string, value: unknown) => context.set(key, value),
      persistPanelState: () => undefined,
      loadPanelState: () => ({
        selectedListId: listId,
        selectedListInstanceId: 'default',
        mode: 'list',
        instanceIds: ['default'],
      }),
      setPanelMetadata: () => undefined,
      openPanel: () => null,
      closePanel: () => undefined,
    } as unknown as PanelHost;
    const handle = factory().mount(container, host, {});
    unmount = () => handle.unmount();
    handle.onVisibilityChange?.(true);
    await vi.waitFor(() => {
      expect(container.querySelector('.lists-fab-add.is-visible')).not.toBeNull();
    });
    return container.querySelector<HTMLButtonElement>('.lists-fab-add')!;
  };

  const open = async (button: HTMLButtonElement) => {
    button.click();
    await vi.waitFor(() => expect(document.querySelector('.list-item-dialog')).not.toBeNull());
    expect(document.querySelector('.list-selection-dialog')).toBeNull();
    return document.querySelector<HTMLButtonElement>('.list-item-target-trigger')!;
  };

  const chooseList = (trigger: HTMLButtonElement, id: string): void => {
    trigger.click();
    const search = document.querySelector<HTMLInputElement>('.list-item-target-menu input')!;
    search.value = id;
    search.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>(`.list-item-target-menu [data-list-id="${id}"]`)!.click();
  };

  const submit = () => {
    document.querySelector<HTMLInputElement>('.list-item-form input.list-item-form-input')!.value =
      'New task';
    document
      .querySelector<HTMLFormElement>('.list-item-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  };

  it.each([
    [null, 'work'],
    ['home', 'home'],
    ['deleted-list', 'work'],
  ])('opens directly with remembered list %s selected as %s', async (stored, expected) => {
    if (stored) window.localStorage.setItem(STORAGE_KEY, stored);
    const select = await open(await mount());
    expect(select.dataset['listId']).toBe(expected);
    select.click();
    expect(Array.from(document.querySelectorAll<HTMLElement>('.list-item-target-menu .list-selection-item'),
      (option) => option.dataset['listId'])).toEqual(['work', 'home']);
    document.querySelector<HTMLInputElement>('.list-item-target-menu input')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(stored);
    expect(
      document.querySelector<HTMLInputElement>('input[id^="list-item-focused-"]')?.checked,
    ).toBe(true);
  });

  it('remembers the changed target after saving and creates Focus membership', async () => {
    const button = await mount();
    const select = await open(button);
    chooseList(select, 'home');
    submit();
    await vi.waitFor(() => expect(document.querySelector('.list-item-dialog')).toBeNull());
    expect(operations).toContainEqual({
      operation: 'item-add',
      body: expect.objectContaining({ listId: 'home', title: 'New task', instance_id: 'default' }),
    });
    expect(operations).toContainEqual({
      operation: 'focus-add',
      body: { itemId: 'new-item', instance_id: 'default' },
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('home');
    expect((await open(button)).dataset['listId']).toBe('home');
  });

  it('keeps the remembered list after cancellation and allows reopening', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'home');
    const button = await mount();
    const select = await open(button);
    chooseList(select, 'work');
    document.querySelector<HTMLButtonElement>('.list-item-dialog .cancel')!.click();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('home');
    expect((await open(button)).dataset['listId']).toBe('home');
  });

  it('keeps the remembered list and editor open when creation fails', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'work');
    failAdd = true;
    const select = await open(await mount());
    chooseList(select, 'home');
    submit();
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledWith('Failed to add list item'));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('work');
    expect(document.querySelector('.list-item-dialog')).not.toBeNull();
    expect(operations.some(({ operation }) => operation === 'focus-add')).toBe(false);
  });

  it('uses a successful normal-list add as the next Focus default', async () => {
    const select = await open(await mount('work'));
    chooseList(select, 'home');
    submit();
    await vi.waitFor(() => expect(document.querySelector('.list-item-dialog')).toBeNull());
    unmount?.();
    expect((await open(await mount())).dataset['listId']).toBe('home');
  });

  it('keeps the Pinned add flow in one editor with source-list selection', async () => {
    const select = await open(await mount('__pinned__'));
    chooseList(select, 'home');
    submit();
    await vi.waitFor(() => expect(document.querySelector('.list-item-dialog')).toBeNull());
    expect(operations).toContainEqual({
      operation: 'item-tags-add',
      body: { listId: 'home', id: 'new-item', tags: ['pinned'], instance_id: 'default' },
    });
  });

  it('reports that a source list is needed when the instance has no real lists', async () => {
    availableLists = [];
    const button = await mount();
    button.click();
    await vi.waitFor(() =>
      expect(setStatus).toHaveBeenCalledWith('Create a list before adding focus items'),
    );
    expect(document.querySelector('.list-item-dialog')).toBeNull();
    expect(operations.some(({ operation }) => operation === 'item-add')).toBe(false);
  });
});
