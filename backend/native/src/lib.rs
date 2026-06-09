mod chunk_gen;
mod flood_fill;

use chunk_gen::generate_chunk_inner;
use flood_fill::{flood_fill, ChunkSlot, FloodFillOutput};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use rayon::prelude::*;

#[napi(object)]
pub struct FloodFillChunkInput {
    pub chunk_x: i32,
    pub chunk_y: i32,
    pub mines: Buffer,
    pub revealed: Buffer,
    pub flagged: Buffer,
}

#[napi(object)]
pub struct FloodFillOptions {
    pub chunk_size: u32,
    pub max_reveals: u32,
    pub reveal_value: u8,
    pub hidden_revealed: u8,
    pub hidden_flagged: u8,
    pub seeds: Vec<Vec<i32>>,
    pub chunks: Vec<FloodFillChunkInput>,
}

#[napi(object)]
pub struct ChunkRevealOutput {
    pub chunk_x: i32,
    pub chunk_y: i32,
    pub indices: Vec<u32>,
}

#[napi(object)]
pub struct PendingFillOutput {
    pub chunk_x: i32,
    pub chunk_y: i32,
    pub local_x: i32,
    pub local_y: i32,
}

#[napi(object)]
pub struct FloodFillResult {
    pub revealed_count: u32,
    pub capped: bool,
    pub reveals: Vec<ChunkRevealOutput>,
    pub pending_fills: Vec<PendingFillOutput>,
    pub continuation: Vec<Vec<i32>>,
}

pub fn to_napi_result(out: FloodFillOutput) -> FloodFillResult {
    FloodFillResult {
        revealed_count: out.revealed_count,
        capped: out.capped,
        reveals: out
            .reveals
            .into_iter()
            .map(|r| ChunkRevealOutput {
                chunk_x: r.chunk_x,
                chunk_y: r.chunk_y,
                indices: r.indices,
            })
            .collect(),
        pending_fills: out
            .pending_fills
            .into_iter()
            .map(|p| PendingFillOutput {
                chunk_x: p.chunk_x,
                chunk_y: p.chunk_y,
                local_x: p.local_x,
                local_y: p.local_y,
            })
            .collect(),
        continuation: out
            .continuation
            .into_iter()
            .map(|(x, y)| vec![x, y])
            .collect(),
    }
}

pub fn parse_coord_pairs(pairs: &[Vec<i32>]) -> Vec<(i32, i32)> {
    pairs
        .iter()
        .filter_map(|pair| {
            if pair.len() >= 2 {
                Some((pair[0], pair[1]))
            } else {
                None
            }
        })
        .collect()
}

pub fn compute_flood_fill(opts: &FloodFillOptions) -> Result<FloodFillOutput> {
    let cs = opts.chunk_size as i32;
    if cs <= 0 {
        return Err(Error::from_reason("chunk_size must be positive"));
    }

    let seeds = parse_coord_pairs(&opts.seeds);

    let mut slots: Vec<ChunkSlot<'_>> = Vec::with_capacity(opts.chunks.len());
    for chunk in &opts.chunks {
        slots.push(ChunkSlot {
            chunk_x: chunk.chunk_x,
            chunk_y: chunk.chunk_y,
            mines: chunk.mines.as_ref(),
            revealed: chunk.revealed.as_ref(),
            flagged: chunk.flagged.as_ref(),
            new_indices: Vec::new(),
        });
    }

    Ok(flood_fill(
        cs,
        opts.max_reveals,
        opts.reveal_value,
        opts.hidden_revealed,
        opts.hidden_flagged,
        &seeds,
        &mut slots,
    ))
}

/// Multi-seed minesweeper flood fill on flat chunk buffers (read-only).
/// Returns local cell indices to reveal; does not mutate input buffers.
#[napi]
pub fn flood_fill_native(opts: FloodFillOptions) -> Result<FloodFillResult> {
    Ok(to_napi_result(compute_flood_fill(&opts)?))
}

pub struct FloodFillTask {
    opts: FloodFillOptions,
}

impl Task for FloodFillTask {
    type Output = FloodFillResult;
    type JsValue = FloodFillResult;

    fn compute(&mut self) -> Result<Self::Output> {
        Ok(to_napi_result(compute_flood_fill(&self.opts)?))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Same as flood_fill_native but runs BFS on a libuv thread pool worker (non-blocking).
#[napi]
pub fn flood_fill_native_async(opts: FloodFillOptions) -> AsyncTask<FloodFillTask> {
    AsyncTask::new(FloodFillTask { opts })
}

/// Generate one chunk (kept for single-chunk use in ChunkManager fallback path).
#[napi]
pub fn generate_chunk(chunk_x: i32, chunk_y: i32, chunk_size: u32, seed: String) -> Vec<u8> {
    generate_chunk_inner(chunk_x, chunk_y, chunk_size as usize, &seed)
}

/// Generate many chunks in parallel using all available CPU cores (Rayon).
/// `coords` is a flat array of [chunkX, chunkY] pairs.
/// Returns a flat array of byte arrays, one per chunk, in the same order.
/// Each element: 0xFF = mine, 0–8 = adjacentMines for non-mine cells.
#[napi]
pub fn generate_chunks_batch(
    coords: Vec<Vec<i32>>,
    chunk_size: u32,
    seed: String,
) -> Vec<Vec<u8>> {
    let size = chunk_size as usize;
    coords
        .par_iter()
        .filter(|pair| pair.len() >= 2)
        .map(|pair| generate_chunk_inner(pair[0], pair[1], size, &seed))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use flood_fill::{ChunkReveals, FloodFillOutput, PendingFill};

    fn sample_fill_options(chunk_size: u32) -> FloodFillOptions {
        let cs = chunk_size as usize;
        let cells = cs * cs;
        FloodFillOptions {
            chunk_size,
            max_reveals: 100,
            reveal_value: 0,
            hidden_revealed: 0xff,
            hidden_flagged: 0xff,
            seeds: vec![vec![0, 0]],
            chunks: vec![FloodFillChunkInput {
                chunk_x: 0,
                chunk_y: 0,
                mines: Buffer::from(vec![0u8; cells]),
                revealed: Buffer::from(vec![0xff; cells]),
                flagged: Buffer::from(vec![0xff; cells]),
            }],
        }
    }

    #[test]
    fn parse_coord_pairs_filters_invalid_entries() {
        let pairs = vec![
            vec![1, 2],
            vec![3],
            vec![4, 5, 6],
            vec![],
        ];
        assert_eq!(parse_coord_pairs(&pairs), vec![(1, 2), (4, 5)]);
    }

    #[test]
    fn to_napi_result_maps_all_fields() {
        let out = FloodFillOutput {
            revealed_count: 2,
            capped: true,
            reveals: vec![ChunkReveals {
                chunk_x: 1,
                chunk_y: -1,
                indices: vec![0, 3],
            }],
            pending_fills: vec![PendingFill {
                chunk_x: 2,
                chunk_y: 0,
                local_x: 1,
                local_y: 1,
            }],
            continuation: vec![(5, 6), (7, 8)],
        };

        let mapped = to_napi_result(out);
        assert_eq!(mapped.revealed_count, 2);
        assert!(mapped.capped);
        assert_eq!(mapped.reveals[0].chunk_x, 1);
        assert_eq!(mapped.reveals[0].indices, vec![0, 3]);
        assert_eq!(mapped.pending_fills[0].local_x, 1);
        assert_eq!(mapped.continuation, vec![vec![5, 6], vec![7, 8]]);
    }

    #[test]
    fn compute_flood_fill_rejects_zero_chunk_size() {
        let mut opts = sample_fill_options(4);
        opts.chunk_size = 0;
        let err = compute_flood_fill(&opts).unwrap_err();
        assert!(err.to_string().contains("chunk_size"));
    }

    #[test]
    fn compute_flood_fill_runs_end_to_end() {
        let opts = sample_fill_options(4);
        let out = compute_flood_fill(&opts).unwrap();
        assert_eq!(out.revealed_count, 16);
    }

    #[test]
    fn compute_flood_fill_ignores_malformed_seeds() {
        let mut opts = sample_fill_options(4);
        opts.seeds = vec![vec![99], vec![1, 1]];
        let out = compute_flood_fill(&opts).unwrap();
        assert_eq!(out.revealed_count, 16);
    }

    #[test]
    fn generate_chunk_matches_inner_helper() {
        let inner = generate_chunk_inner(2, -1, 8, "parity");
        let exported = generate_chunk(2, -1, 8, "parity".to_string());
        assert_eq!(inner, exported);
    }

    #[test]
    fn generate_chunks_batch_preserves_order_and_matches_single() {
        let coords = vec![vec![0, 0], vec![1, 0], vec![0, 1]];
        let batch = generate_chunks_batch(coords.clone(), 16, "batch-seed".to_string());
        assert_eq!(batch.len(), 3);
        for (pair, chunk) in coords.iter().zip(batch.iter()) {
            let single = generate_chunk(pair[0], pair[1], 16, "batch-seed".to_string());
            assert_eq!(*chunk, single);
        }
    }

    #[test]
    fn generate_chunks_batch_empty_input() {
        let batch = generate_chunks_batch(vec![], 32, "empty".to_string());
        assert!(batch.is_empty());
    }

    #[test]
    fn generate_chunks_batch_skips_malformed_coords() {
        // A pair with fewer than 2 elements must be silently skipped.
        let coords = vec![vec![0, 0], vec![99], vec![1, 0]];
        let batch = generate_chunks_batch(coords.clone(), 8, "guard".to_string());
        assert_eq!(batch.len(), 2, "malformed pair should be excluded");
        let c00 = generate_chunk(0, 0, 8, "guard".to_string());
        let c10 = generate_chunk(1, 0, 8, "guard".to_string());
        assert_eq!(batch[0], c00);
        assert_eq!(batch[1], c10);
    }
}
