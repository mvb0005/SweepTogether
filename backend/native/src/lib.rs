#![deny(clippy::all)]

use napi_derive::napi;
use noise::{NoiseFn, OpenSimplex};
use rayon::prelude::*;

/// Sampling scale applied to world coordinates before evaluation.
/// Values of 1.0 land on integer lattice points where OpenSimplex is near-zero.
/// 0.08 gives roughly one noise feature per ~12 cells — good variation for gameplay.
const COORDINATE_SCALE: f64 = 0.08;
/// Mine if scaled noise < threshold. With OpenSimplex the practical output
/// range is narrower than ±1; ~0.25 threshold gives roughly 15% mine density.
const MINE_THRESHOLD: f64 = 0.25;

/// FNV-1a hash of the seed string to produce a u32 noise seed.
fn seed_u32(s: &str) -> u32 {
    let mut h: u32 = 2_166_136_261;
    for b in s.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(16_777_619);
    }
    h
}

fn generate_chunk_inner(chunk_x: i32, chunk_y: i32, size: usize, noise: &OpenSimplex) -> Vec<u8> {
    let mut mines = vec![false; size * size];
    for ly in 0..size {
        for lx in 0..size {
            let wx = (chunk_x as f64 * size as f64 + lx as f64) * COORDINATE_SCALE;
            let wy = (chunk_y as f64 * size as f64 + ly as f64) * COORDINATE_SCALE;
            mines[ly * size + lx] = (noise.get([wx, wy]) + 1.0) / 2.0 < MINE_THRESHOLD;
        }
    }

    let mut out = vec![0u8; size * size];
    for ly in 0..size {
        for lx in 0..size {
            let idx = ly * size + lx;
            if mines[idx] {
                out[idx] = 0xFF;
            } else {
                let mut adj = 0u8;
                for dy in -1i32..=1 {
                    for dx in -1i32..=1 {
                        if dx == 0 && dy == 0 {
                            continue;
                        }
                        let nx = lx as i32 + dx;
                        let ny = ly as i32 + dy;
                        let is_mine =
                            if nx >= 0 && nx < size as i32 && ny >= 0 && ny < size as i32 {
                                mines[ny as usize * size + nx as usize]
                            } else {
                                let wx =
                                    (chunk_x as f64 * size as f64 + nx as f64) * COORDINATE_SCALE;
                                let wy =
                                    (chunk_y as f64 * size as f64 + ny as f64) * COORDINATE_SCALE;
                                (noise.get([wx, wy]) + 1.0) / 2.0 < MINE_THRESHOLD
                            };
                        if is_mine {
                            adj += 1;
                        }
                    }
                }
                out[idx] = adj;
            }
        }
    }
    out
}

/// Generate one chunk (kept for single-chunk use in ChunkManager fallback path).
#[napi]
pub fn generate_chunk(chunk_x: i32, chunk_y: i32, chunk_size: u32, seed: String) -> Vec<u8> {
    let noise = OpenSimplex::new(seed_u32(&seed));
    generate_chunk_inner(chunk_x, chunk_y, chunk_size as usize, &noise)
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
    let seed_val = seed_u32(&seed);
    coords
        .par_iter()
        .map(|pair| {
            // OpenSimplex is not Send, so construct one per Rayon thread.
            let noise = OpenSimplex::new(seed_val);
            generate_chunk_inner(pair[0], pair[1], size, &noise)
        })
        .collect()
}
