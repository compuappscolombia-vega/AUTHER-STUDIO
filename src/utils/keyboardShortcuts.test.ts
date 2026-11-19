import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SHORTCUT_GROUPS,
  STUDIO_TAB_ORDER,
  getNextStudioTab,
  resolveStudioShortcutAction,
} from './keyboardShortcuts.ts';

test('STUDIO_TAB_ORDER maps numeric keys 1-6 to all six studio tabs', () => {
  assert.equal(STUDIO_TAB_ORDER.length, 6);
  const resolved = ['1', '2', '3', '4', '5', '6'].map((k) =>
    resolveStudioShortcutAction({ key: k })
  );
  assert.deepEqual(
    resolved,
    STUDIO_TAB_ORDER.map((tab) => ({ type: 'switch-tab', tab }))
  );
});

test('getNextStudioTab wraps cleanly forward and backward across tabs', () => {
  assert.equal(getNextStudioTab('vision', -1), 'trailer');
  assert.equal(getNextStudioTab('trailer', 1), 'vision');
  assert.equal(getNextStudioTab('screenplay', 1), 'storyboard');
});

test('resolveStudioShortcutAction toggles reading mode with L and ignores editable fields or modifiers', () => {
  assert.deepEqual(resolveStudioShortcutAction({ key: 'l' }), {
    type: 'toggle-reading-mode',
  });
  assert.deepEqual(resolveStudioShortcutAction({ key: 'L' }), {
    type: 'toggle-reading-mode',
  });
  assert.deepEqual(resolveStudioShortcutAction({ key: '?' }), {
    type: 'toggle-shortcuts-modal',
  });

  // Editable target or OS modifiers must be ignored
  assert.equal(resolveStudioShortcutAction({ key: 'l', isEditable: true }), null);
  assert.equal(resolveStudioShortcutAction({ key: '1', metaKey: true }), null);
  assert.equal(resolveStudioShortcutAction({ key: 'n', ctrlKey: true }), null);
  assert.equal(resolveStudioShortcutAction({ key: '3', hasBlockingModalOpen: true }), null);
});

test('SHORTCUT_GROUPS covers tab navigation and reading mode documentation', () => {
  const flatIds = SHORTCUT_GROUPS.flatMap((g) => g.items.map((i) => i.id));
  assert.ok(flatIds.includes('tab-1'));
  assert.ok(flatIds.includes('tab-6'));
  assert.ok(flatIds.includes('reading-mode'));
  assert.ok(flatIds.includes('toggle-shortcuts'));
});
