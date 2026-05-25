import { CHUNK_SIZE } from '../../types/chunkTypes';
import { serializeChunkWireFromBuffers } from '../../application/chunkWire';

describe('serializeChunkWireFromBuffers', () => {
  it('includes adjacent mine counts when mines buffer is provided', () => {
    const size = CHUNK_SIZE;
    const mines = new Uint8Array(size * size);
    mines[0] = 0xff;
    mines[1] = 1;
    mines[size] = 2;

    const revealedBuf = Buffer.alloc(size * size, 0xff);
    revealedBuf[1] = 0;
    revealedBuf[size] = 0;

    const wire = serializeChunkWireFromBuffers('default', 0, 0, revealedBuf, undefined, mines);

    expect(wire.revealed).toEqual([1, size]);
    expect(wire.adjMines).toEqual([1, 2]);
  });

  it('defaults adjMines to 0 when mines buffer is missing', () => {
    const size = CHUNK_SIZE;
    const revealedBuf = Buffer.alloc(size * size, 0xff);
    revealedBuf[5] = 0;

    const wire = serializeChunkWireFromBuffers('default', 0, 0, revealedBuf);

    expect(wire.revealed).toEqual([5]);
    expect(wire.adjMines).toEqual([0]);
  });
});
