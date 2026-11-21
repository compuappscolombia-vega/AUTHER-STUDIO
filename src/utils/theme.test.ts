import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStudioTheme,
  getNextStudioTheme,
  getThemeLabel,
  normalizeStudioTheme,
} from './theme.ts';

describe('theme utilities', () => {
  it('defaults unknown values to Cinema Dark (dark)', () => {
    assert.equal(normalizeStudioTheme(undefined), 'dark');
    assert.equal(normalizeStudioTheme(null), 'dark');
    assert.equal(normalizeStudioTheme('sepia'), 'dark');
    assert.equal(normalizeStudioTheme('light'), 'light');
    assert.equal(normalizeStudioTheme('dark'), 'dark');
  });

  it('toggles cleanly between Cinema Dark and Light Studio', () => {
    assert.equal(getNextStudioTheme('dark'), 'light');
    assert.equal(getNextStudioTheme('light'), 'dark');
    assert.equal(getThemeLabel('dark'), 'Cinema Dark');
    assert.equal(getThemeLabel('light'), 'Light Studio');
  });

  it('updates documentElement dark class, dataset, and colorScheme', () => {
    const classes = new Set<string>(['dark']);
    const fakeDoc = {
      documentElement: {
        classList: {
          toggle(token: string, force?: boolean) {
            if (force) {
              classes.add(token);
              return true;
            }
            classes.delete(token);
            return false;
          },
        },
        dataset: {} as DOMStringMap,
        style: {} as CSSStyleDeclaration,
      },
    } as unknown as Pick<Document, 'documentElement'>;

    applyStudioTheme('light', fakeDoc);
    assert.equal(classes.has('dark'), false);
    assert.equal(fakeDoc.documentElement.dataset.theme, 'light');
    assert.equal(fakeDoc.documentElement.style.colorScheme, 'light');

    applyStudioTheme('dark', fakeDoc);
    assert.equal(classes.has('dark'), true);
    assert.equal(fakeDoc.documentElement.dataset.theme, 'dark');
    assert.equal(fakeDoc.documentElement.style.colorScheme, 'dark');
  });
});
