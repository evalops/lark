import { describe, it, expect } from 'vitest';
import { parseKeypressSequence } from './computerActions';

describe('parseKeypressSequence', () => {
  it('parses inline chord tokens', () => {
    const sequence = parseKeypressSequence(['cmd+shift+p']);
    expect(sequence).toEqual([{ key: 'p', modifiers: ['cmd', 'shift'], chord: true }]);
  });

  it('groups sequential modifiers with following key', () => {
    const sequence = parseKeypressSequence(['cmd', 'shift', 'p']);
    expect(sequence).toEqual([{ key: 'p', modifiers: ['cmd', 'shift'], chord: true }]);
  });

  it('keeps simple keys separate', () => {
    const sequence = parseKeypressSequence(['a', 'b']);
    expect(sequence).toEqual([
      { key: 'a', modifiers: [], chord: false },
      { key: 'b', modifiers: [], chord: false },
    ]);
  });
});
