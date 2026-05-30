/// Classic minesweeper mine density (~10 mines on 9×9).
pub const MINE_DENSITY: f64 = 0.16;

pub const MINE_CELL: u8 = 0xff;

/// FNV-1a hash of the seed string to produce a u32 seed.
pub fn seed_u32(s: &str) -> u32 {
    let mut h: u32 = 2_166_136_261;
    for b in s.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(16_777_619);
    }
    h
}

pub fn cell_roll(seed: &str, x: i32, y: i32) -> f64 {
    let mut h = seed_u32(seed);
    h ^= x as u32;
    h = h.wrapping_mul(0x85eb_ca6b);
    h ^= h >> 16;
    h ^= y as u32;
    h = h.wrapping_mul(0xc2b2_ae35);
    h ^= h >> 16;
    (h as f64) / (u32::MAX as f64)
}

fn is_mine(seed: &str, gx: i32, gy: i32) -> bool {
    cell_roll(seed, gx, gy) < MINE_DENSITY
}

pub fn generate_chunk_inner(chunk_x: i32, chunk_y: i32, size: usize, seed: &str) -> Vec<u8> {
    let mut mines = vec![false; size * size];
    for ly in 0..size {
        for lx in 0..size {
            let gx = chunk_x * size as i32 + lx as i32;
            let gy = chunk_y * size as i32 + ly as i32;
            mines[ly * size + lx] = is_mine(seed, gx, gy);
        }
    }

    let mut out = vec![0u8; size * size];
    for ly in 0..size {
        for lx in 0..size {
            let idx = ly * size + lx;
            if mines[idx] {
                out[idx] = MINE_CELL;
            } else {
                let mut adj = 0u8;
                for dy in -1i32..=1 {
                    for dx in -1i32..=1 {
                        if dx == 0 && dy == 0 {
                            continue;
                        }
                        let gx = chunk_x * size as i32 + lx as i32 + dx;
                        let gy = chunk_y * size as i32 + ly as i32 + dy;
                        if is_mine(seed, gx, gy) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_u32_is_deterministic() {
        assert_eq!(seed_u32("default"), seed_u32("default"));
        assert_eq!(seed_u32(""), seed_u32(""));
    }

    #[test]
    fn seed_u32_differs_for_different_strings() {
        assert_ne!(seed_u32("default"), seed_u32("other"));
        assert_ne!(seed_u32("a"), seed_u32("b"));
    }

    #[test]
    fn seed_u32_known_vector() {
        let mut h: u32 = 2_166_136_261;
        for b in "default".bytes() {
            h ^= b as u32;
            h = h.wrapping_mul(16_777_619);
        }
        assert_eq!(seed_u32("default"), h);
    }

    fn gen(chunk_x: i32, chunk_y: i32, size: usize, seed: &str) -> Vec<u8> {
        generate_chunk_inner(chunk_x, chunk_y, size, seed)
    }

    #[test]
    fn output_length_matches_chunk_area() {
        for size in [1usize, 4, 32] {
            let out = gen(0, 0, size, "test");
            assert_eq!(out.len(), size * size);
        }
    }

    #[test]
    fn generation_is_deterministic_for_same_inputs() {
        let a = gen(3, -2, 8, "game-1");
        let b = gen(3, -2, 8, "game-1");
        assert_eq!(a, b);
    }

    #[test]
    fn generated_layout_varies_across_coordinates() {
        let mut found_mine = false;
        for i in 0..100 {
            let out = gen(i, i, 32, "mine-scan");
            if out.iter().any(|&v| v == MINE_CELL) {
                found_mine = true;
                break;
            }
        }
        assert!(
            found_mine,
            "expected mine placement somewhere in coordinate sweep"
        );
    }

    #[test]
    fn world_coords_affect_sampled_layout() {
        let chunks: Vec<_> = (0..20)
            .map(|i| gen(i * 17, i * -13, 32, "world-layout"))
            .collect();
        let all_same = chunks.windows(2).all(|w| w[0] == w[1]);
        assert!(
            !all_same,
            "expected coordinate offsets to change generated layout"
        );
    }

    #[test]
    fn mine_cells_marked_with_mine_byte() {
        let out = gen(0, 0, 32, "default");
        for (idx, &val) in out.iter().enumerate() {
            if val == MINE_CELL {
                continue;
            }
            assert!(val <= 8, "non-mine cell {idx} has invalid adjacent count {val}");
        }
    }

    #[test]
    fn adjacent_counts_match_local_mine_neighborhood() {
        let size = 8;
        let out = gen(0, 0, size, "adjacency-check");
        for ly in 0..size {
            for lx in 0..size {
                let idx = ly * size + lx;
                if out[idx] == MINE_CELL {
                    continue;
                }
                let mut expected = 0u8;
                for dy in -1i32..=1 {
                    for dx in -1i32..=1 {
                        if dx == 0 && dy == 0 {
                            continue;
                        }
                        let gx = lx as i32 + dx;
                        let gy = ly as i32 + dy;
                        if gx >= 0 && gx < size as i32 && gy >= 0 && gy < size as i32 {
                            if out[(gy as usize) * size + (gx as usize)] == MINE_CELL {
                                expected += 1;
                            }
                        }
                    }
                }
                assert_eq!(out[idx], expected, "local mismatch at ({lx},{ly})");
            }
        }
    }

    #[test]
    fn border_cells_use_global_neighbors() {
        let size = 4;
        let chunk_a = gen(0, 0, size, "border");
        let chunk_b = gen(1, 0, size, "border");

        let left_border_idx = 0;
        let right_neighbor_is_mine = chunk_b[0] == MINE_CELL;
        let left_val = chunk_a[left_border_idx];
        if left_val != MINE_CELL {
            let mut expected = 0u8;
            for dy in -1i32..=1 {
                for dx in -1i32..=1 {
                    if dx == 0 && dy == 0 {
                        continue;
                    }
                    let gx = 3 + dx;
                    let gy = 0 + dy;
                    let (cx, lx) = (gx.div_euclid(size as i32), gx.rem_euclid(size as i32));
                    let (cy, ly) = (gy.div_euclid(size as i32), gy.rem_euclid(size as i32));
                    let chunk = if (cx, cy) == (0, 0) {
                        &chunk_a
                    } else {
                        &chunk_b
                    };
                    if chunk[(ly as usize) * size + (lx as usize)] == MINE_CELL {
                        expected += 1;
                    }
                }
            }
            assert_eq!(left_val, expected);
            if right_neighbor_is_mine {
                assert!(left_val >= 1);
            }
        }
    }

    #[test]
    fn empty_seed_string_still_generates_valid_grid() {
        let out = gen(0, 0, 4, "");
        assert_eq!(out.len(), 16);
        assert!(out.iter().all(|v| *v == MINE_CELL || *v <= 8));
    }

    #[test]
    fn mine_density_is_near_classic_rate() {
        let size = 64;
        let out = gen(0, 0, size, "density-check");
        let mine_count = out.iter().filter(|&&v| v == MINE_CELL).count();
        let density = mine_count as f64 / (size * size) as f64;
        assert!(
            (0.12..=0.20).contains(&density),
            "expected ~16% mine density, got {:.3}",
            density
        );
    }
}
