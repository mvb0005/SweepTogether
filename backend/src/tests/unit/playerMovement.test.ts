import {
  canMoveNow,
  playerColorFromId,
  validateMoveInput,
} from '../../domain/playerMovement';

describe('playerMovement', () => {
  it('assigns deterministic colors from player id', () => {
    expect(playerColorFromId('socket-abc')).toBe(playerColorFromId('socket-abc'));
    expect(playerColorFromId('a')).not.toBe(playerColorFromId('b'));
  });

  it('accepts orthogonal moves only', () => {
    expect(validateMoveInput(1, 0)).toBe(true);
    expect(validateMoveInput(0, -1)).toBe(true);
    expect(validateMoveInput(1, 1)).toBe(false);
    expect(validateMoveInput(0, 0)).toBe(false);
    expect(validateMoveInput(2, 0)).toBe(false);
  });

  it('rate limits moves', () => {
    const now = 10_000;
    expect(canMoveNow(undefined, now)).toBe(true);
    expect(canMoveNow(now, now)).toBe(false);
    expect(canMoveNow(now - 50, now)).toBe(true);
  });
});
