use std::collections::{HashMap, HashSet};

pub const HIDDEN_CELL: u8 = 0xff;
const MINE: u8 = 0xff;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingFill {
    pub chunk_x: i32,
    pub chunk_y: i32,
    pub local_x: i32,
    pub local_y: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChunkReveals {
    pub chunk_x: i32,
    pub chunk_y: i32,
    pub indices: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FloodFillOutput {
    pub revealed_count: u32,
    pub capped: bool,
    pub reveals: Vec<ChunkReveals>,
    pub pending_fills: Vec<PendingFill>,
    pub continuation: Vec<(i32, i32)>,
}

pub struct ChunkSlot<'a> {
    pub chunk_x: i32,
    pub chunk_y: i32,
    pub mines: &'a [u8],
    pub revealed: &'a [u8],
    pub flagged: &'a [u8],
    pub new_indices: Vec<u32>,
}

pub fn chunk_coords(gx: i32, cs: i32) -> (i32, i32) {
    (gx.div_euclid(cs), gx.rem_euclid(cs))
}

pub fn is_hidden(revealed: u8, hidden: u8) -> bool {
    revealed == hidden
}

pub fn is_flagged(flagged: u8, hidden: u8) -> bool {
    flagged != hidden
}

#[allow(clippy::too_many_arguments)]
fn try_enqueue(
    gx: i32,
    gy: i32,
    chunk_size: i32,
    cells: usize,
    hidden_revealed: u8,
    hidden_flagged: u8,
    index: &HashMap<(i32, i32), usize>,
    chunks: &[ChunkSlot<'_>],
    visited: &mut HashSet<(i32, i32)>,
    pending_fills: &mut Vec<PendingFill>,
    pending_set: &mut HashSet<(i32, i32, i32)>,
    queue: &mut Vec<(i32, i32)>,
) {
    if visited.contains(&(gx, gy)) {
        return;
    }
    visited.insert((gx, gy));

    let (cx, lx) = chunk_coords(gx, chunk_size);
    let (cy, ly) = chunk_coords(gy, chunk_size);

    let Some(&slot_idx) = index.get(&(cx, cy)) else {
        let key = (cx, cy, ly * chunk_size + lx);
        if pending_set.insert(key) {
            pending_fills.push(PendingFill {
                chunk_x: cx,
                chunk_y: cy,
                local_x: lx,
                local_y: ly,
            });
        }
        return;
    };

    let slot = &chunks[slot_idx];
    if slot.mines.len() != cells || slot.revealed.len() != cells || slot.flagged.len() != cells {
        return;
    }
    let idx = (ly * chunk_size + lx) as usize;
    if !is_hidden(slot.revealed[idx], hidden_revealed)
        || is_flagged(slot.flagged[idx], hidden_flagged)
        || slot.mines[idx] == MINE
    {
        return;
    }

    queue.push((gx, gy));
}

pub fn flood_fill(
    chunk_size: i32,
    max_reveals: u32,
    _reveal_value: u8,
    hidden_revealed: u8,
    hidden_flagged: u8,
    seeds: &[(i32, i32)],
    chunks: &mut [ChunkSlot<'_>],
) -> FloodFillOutput {
    let cells = (chunk_size * chunk_size) as usize;
    let mut index: HashMap<(i32, i32), usize> = HashMap::with_capacity(chunks.len());
    for (i, c) in chunks.iter().enumerate() {
        index.insert((c.chunk_x, c.chunk_y), i);
    }

    let mut visited: HashSet<(i32, i32)> = HashSet::new();
    let mut pending_fills: Vec<PendingFill> = Vec::new();
    let mut pending_set: HashSet<(i32, i32, i32)> = HashSet::new();
    let mut queue: Vec<(i32, i32)> = Vec::new();
    let mut head = 0usize;
    let mut revealed_count = 0u32;
    let mut capped = false;

    for &(x, y) in seeds {
        try_enqueue(
            x,
            y,
            chunk_size,
            cells,
            hidden_revealed,
            hidden_flagged,
            &index,
            chunks,
            &mut visited,
            &mut pending_fills,
            &mut pending_set,
            &mut queue,
        );
    }

    while head < queue.len() {
        if revealed_count >= max_reveals {
            capped = true;
            break;
        }

        let (gx, gy) = queue[head];
        head += 1;

        let (cx, lx) = chunk_coords(gx, chunk_size);
        let (cy, ly) = chunk_coords(gy, chunk_size);
        let Some(&slot_idx) = index.get(&(cx, cy)) else {
            continue;
        };

        let idx = (ly * chunk_size + lx) as usize;
        let slot = &chunks[slot_idx];
        if !is_hidden(slot.revealed[idx], hidden_revealed)
            || is_flagged(slot.flagged[idx], hidden_flagged)
            || slot.mines[idx] == MINE
        {
            continue;
        }

        chunks[slot_idx].new_indices.push(idx as u32);
        revealed_count += 1;

        let adjacent = chunks[slot_idx].mines[idx];
        if adjacent != 0 {
            continue;
        }

        for dy in -1..=1 {
            for dx in -1..=1 {
                if dx == 0 && dy == 0 {
                    continue;
                }
                try_enqueue(
                    gx + dx,
                    gy + dy,
                    chunk_size,
                    cells,
                    hidden_revealed,
                    hidden_flagged,
                    &index,
                    chunks,
                    &mut visited,
                    &mut pending_fills,
                    &mut pending_set,
                    &mut queue,
                );
            }
        }
    }

    let continuation = if capped && head < queue.len() {
        queue[head..].to_vec()
    } else {
        Vec::new()
    };

    let reveals = chunks
        .iter()
        .filter(|c| !c.new_indices.is_empty())
        .map(|c| ChunkReveals {
            chunk_x: c.chunk_x,
            chunk_y: c.chunk_y,
            indices: c.new_indices.clone(),
        })
        .collect();

    FloodFillOutput {
        revealed_count,
        capped,
        reveals,
        pending_fills,
        continuation,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestChunk {
        mines: Vec<u8>,
        revealed: Vec<u8>,
        flagged: Vec<u8>,
    }

    impl TestChunk {
        fn open(cells: usize) -> Self {
            Self {
                mines: vec![0u8; cells],
                revealed: vec![HIDDEN_CELL; cells],
                flagged: vec![HIDDEN_CELL; cells],
            }
        }

        fn with_mine(cells: usize, mine_idx: usize) -> Self {
            let mut mines = vec![0u8; cells];
            mines[mine_idx] = MINE;
            Self {
                mines,
                revealed: vec![HIDDEN_CELL; cells],
                flagged: vec![HIDDEN_CELL; cells],
            }
        }
    }

    fn run_fill(
        cs: i32,
        max_reveals: u32,
        seeds: &[(i32, i32)],
        chunks: &mut [TestChunk],
        coords: &[(i32, i32)],
    ) -> FloodFillOutput {
        let mut slots: Vec<ChunkSlot<'_>> = chunks
            .iter()
            .zip(coords.iter())
            .map(|(c, (cx, cy))| ChunkSlot {
                chunk_x: *cx,
                chunk_y: *cy,
                mines: &c.mines,
                revealed: &c.revealed,
                flagged: &c.flagged,
                new_indices: Vec::new(),
            })
            .collect();
        flood_fill(
            cs,
            max_reveals,
            0,
            HIDDEN_CELL,
            HIDDEN_CELL,
            seeds,
            &mut slots,
        )
    }

    fn global_to_local(gx: i32, gy: i32, cs: i32) -> (i32, i32, i32, i32) {
        let (cx, lx) = chunk_coords(gx, cs);
        let (cy, ly) = chunk_coords(gy, cs);
        (cx, cy, lx, ly)
    }

    #[test]
    fn chunk_coords_handles_negative_globals() {
        assert_eq!(chunk_coords(-1, 4), (-1, 3));
        assert_eq!(chunk_coords(-4, 4), (-1, 0));
        assert_eq!(chunk_coords(-5, 4), (-2, 3));
        assert_eq!(chunk_coords(0, 32), (0, 0));
        assert_eq!(chunk_coords(31, 32), (0, 31));
        assert_eq!(chunk_coords(32, 32), (1, 0));
    }

    #[test]
    fn hidden_and_flagged_helpers() {
        assert!(is_hidden(HIDDEN_CELL, HIDDEN_CELL));
        assert!(!is_hidden(0, HIDDEN_CELL));
        assert!(is_flagged(0, HIDDEN_CELL));
        assert!(!is_flagged(HIDDEN_CELL, HIDDEN_CELL));
    }

    #[test]
    fn single_chunk_open_region() {
        let cs = 4;
        let cells = (cs * cs) as usize;
        let mut chunks = [TestChunk::open(cells)];

        let out = run_fill(cs, 100, &[(1, 1)], &mut chunks, &[(0, 0)]);

        assert_eq!(out.revealed_count, 16);
        assert!(!out.capped);
        assert_eq!(out.reveals.len(), 1);
        assert_eq!(out.reveals[0].indices.len(), 16);
        assert!(!out.pending_fills.is_empty());
    }

    #[test]
    fn stops_at_numbered_boundary() {
        let cs = 3;
        let mut chunks = [TestChunk::with_mine(9, 4)];

        let out = run_fill(cs, 100, &[(0, 0)], &mut chunks, &[(0, 0)]);

        assert_eq!(out.revealed_count, 8);
        assert!(!out.reveals[0].indices.contains(&4));
    }

    #[test]
    fn unsubscribed_neighbor_becomes_pending() {
        let cs = 2;
        let mut chunks = [TestChunk::open(4)];

        let out = run_fill(cs, 100, &[(0, 0)], &mut chunks, &[(0, 0)]);

        assert_eq!(out.revealed_count, 4);
        assert!(out
            .pending_fills
            .iter()
            .any(|p| p.chunk_x == 1 && p.local_x == 0 && p.local_y == 0));
    }

    #[test]
    fn respects_reveal_cap() {
        let cs = 4;
        let mut chunks = [TestChunk::open(16)];

        let out = run_fill(cs, 5, &[(0, 0)], &mut chunks, &[(0, 0)]);

        assert_eq!(out.revealed_count, 5);
        assert!(out.capped);
        assert!(!out.continuation.is_empty());
        assert!(out.continuation.len() <= 16);
    }

    #[test]
    fn empty_seeds_reveal_nothing() {
        let cs = 4;
        let mut chunks = [TestChunk::open(16)];

        let out = run_fill(cs, 100, &[], &mut chunks, &[(0, 0)]);

        assert_eq!(out.revealed_count, 0);
        assert!(out.reveals.is_empty());
        assert!(!out.capped);
    }

    #[test]
    fn skips_flagged_seed() {
        let cs = 3;
        let mut chunks = [TestChunk::open(9)];
        chunks[0].flagged[4] = 0;

        let out = run_fill(cs, 100, &[(1, 1)], &mut chunks, &[(0, 0)]);

        assert_eq!(out.revealed_count, 0);
    }

    #[test]
    fn skips_already_revealed_seed() {
        let cs = 3;
        let mut chunks = [TestChunk::open(9)];
        chunks[0].revealed[0] = 0;

        let out = run_fill(cs, 100, &[(0, 0)], &mut chunks, &[(0, 0)]);

        assert_eq!(out.revealed_count, 0);
    }

    #[test]
    fn skips_mine_seed() {
        let cs = 3;
        let mut chunks = [TestChunk::with_mine(9, 4)];

        let out = run_fill(cs, 100, &[(1, 1)], &mut chunks, &[(0, 0)]);

        assert_eq!(out.revealed_count, 0);
    }

    #[test]
    fn does_not_expand_through_flagged_cells() {
        let cs = 5;
        let cells = 25;
        let mut chunks = [TestChunk::open(cells)];
        // Flag a cell that would block expansion from (0,0) toward the east half.
        let (cx, cy, lx, ly) = global_to_local(2, 0, cs);
        assert_eq!((cx, cy), (0, 0));
        let block_idx = (ly * cs + lx) as usize;
        chunks[0].flagged[block_idx] = 0;

        let out = run_fill(cs, 100, &[(0, 0)], &mut chunks, &[(0, 0)]);

        assert!(!out.reveals[0].indices.contains(&(block_idx as u32)));
        assert!(out.revealed_count < 25);
    }

    #[test]
    fn multi_seed_merges_into_one_region() {
        let cs = 4;
        let mut chunks = [TestChunk::open(16)];

        let out = run_fill(cs, 100, &[(0, 0), (3, 3)], &mut chunks, &[(0, 0)]);

        assert_eq!(out.revealed_count, 16);
        assert_eq!(out.reveals[0].indices.len(), 16);
    }

    #[test]
    fn cross_chunk_fill_with_two_loaded_chunks() {
        let cs = 2;
        let mut chunks = [TestChunk::open(4), TestChunk::open(4)];

        let out = run_fill(cs, 100, &[(0, 0)], &mut chunks, &[(0, 0), (1, 0)]);

        assert_eq!(out.revealed_count, 8);
        assert_eq!(out.reveals.len(), 2);
        assert!(out.reveals.iter().any(|r| r.chunk_x == 1 && !r.indices.is_empty()));
    }

    #[test]
    fn expansion_to_unloaded_chunk_creates_pending_fills() {
        let cs = 2;
        let mut chunks = [TestChunk::open(4)];

        let out = run_fill(cs, 100, &[(0, 0)], &mut chunks, &[(0, 0)]);

        assert!(out.pending_fills.iter().any(|p| p.chunk_x == 1));
    }

    #[test]
    fn pending_fills_are_unique_by_chunk_local() {
        let cs = 2;
        let mut chunks = [TestChunk::open(4)];

        let out = run_fill(cs, 100, &[(0, 0)], &mut chunks, &[(0, 0)]);

        let mut keys: Vec<_> = out
            .pending_fills
            .iter()
            .map(|p| (p.chunk_x, p.chunk_y, p.local_x, p.local_y))
            .collect();
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(keys.len(), out.pending_fills.len());
    }

    #[test]
    fn numbered_seed_reveals_only_itself() {
        let cs = 3;
        let mut mines = vec![0u8; 9];
        mines[4] = 2;
        let mut chunks = [TestChunk {
            mines,
            revealed: vec![HIDDEN_CELL; 9],
            flagged: vec![HIDDEN_CELL; 9],
        }];

        let out = run_fill(cs, 100, &[(1, 1)], &mut chunks, &[(0, 0)]);

        assert_eq!(out.revealed_count, 1);
        assert_eq!(out.reveals[0].indices, vec![4]);
    }

    #[test]
    fn custom_hidden_marker_values() {
        let cs = 2;
        let hidden = 0xab;
        let chunks = [TestChunk {
            mines: vec![0u8; 4],
            revealed: vec![hidden; 4],
            flagged: vec![hidden; 4],
        }];
        let mut slots = [ChunkSlot {
            chunk_x: 0,
            chunk_y: 0,
            mines: &chunks[0].mines,
            revealed: &chunks[0].revealed,
            flagged: &chunks[0].flagged,
            new_indices: Vec::new(),
        }];

        let out = flood_fill(
            cs,
            100,
            0,
            hidden,
            hidden,
            &[(0, 0)],
            &mut slots,
        );

        assert_eq!(out.revealed_count, 4);
    }

    #[test]
    fn negative_global_coordinates_fill_correct_chunk() {
        let cs = 4;
        let cells = 16;
        let mut chunks = [TestChunk::open(cells)];
        let gx = -1;
        let gy = -1;
        let (cx, cy, lx, ly) = global_to_local(gx, gy, cs);
        assert_eq!((cx, cy, lx, ly), (-1, -1, 3, 3));

        let out = run_fill(cs, 100, &[(gx, gy)], &mut chunks, &[(cx, cy)]);

        assert_eq!(out.revealed_count, 16);
        assert_eq!(out.reveals[0].chunk_x, -1);
        assert_eq!(out.reveals[0].chunk_y, -1);
    }

    #[test]
    fn mismatched_buffer_lengths_are_skipped() {
        let cs = 2;
        let mut chunks = [TestChunk::open(4)];
        chunks[0].mines = vec![0u8; 3]; // wrong length

        let out = run_fill(cs, 100, &[(0, 0)], &mut chunks, &[(0, 0)]);

        assert_eq!(out.revealed_count, 0);
    }

    #[test]
    fn continuation_contains_unprocessed_queue_positions() {
        let cs = 4;
        let mut chunks = [TestChunk::open(16)];

        let out = run_fill(cs, 3, &[(0, 0)], &mut chunks, &[(0, 0)]);

        assert_eq!(out.revealed_count, 3);
        assert!(out.capped);
        for (x, y) in &out.continuation {
            assert!(*x >= 0 && *x < cs);
            assert!(*y >= 0 && *y < cs);
        }
    }

    #[test]
    fn reveal_indices_are_unique_per_chunk() {
        let cs = 4;
        let mut chunks = [TestChunk::open(16)];

        let out = run_fill(cs, 100, &[(0, 0), (0, 0), (1, 1)], &mut chunks, &[(0, 0)]);

        let mut indices = out.reveals[0].indices.clone();
        let len = indices.len();
        indices.sort_unstable();
        indices.dedup();
        assert_eq!(indices.len(), len);
    }

    /// Flood fill with a cap smaller than the open region: two passes (first with
    /// continuation, second seeded from it) must cover the full region with no
    /// duplicate reveals across passes.
    #[test]
    fn capped_fill_plus_continuation_covers_full_region_no_duplicates() {
        let cs = 4i32;
        let cells = (cs * cs) as usize;
        let cap = 8u32; // region has 16 cells; cap at 8

        // Pass 1
        let mut chunks1 = [TestChunk::open(cells)];
        let out1 = run_fill(cs, cap, &[(0, 0)], &mut chunks1, &[(0, 0)]);
        assert!(out1.capped, "expected first pass to be capped");
        assert_eq!(out1.revealed_count, cap);
        assert!(!out1.continuation.is_empty(), "expected non-empty continuation");

        // Collect all indices revealed in pass 1
        let mut all_indices: std::collections::HashSet<u32> = out1
            .reveals
            .iter()
            .flat_map(|r| r.indices.iter().copied())
            .collect();
        assert_eq!(all_indices.len(), cap as usize);

        // Pass 2: seed from continuation, mark pass-1 cells as already revealed
        let mut p2_revealed = vec![HIDDEN_CELL; cells];
        for &idx in &all_indices {
            p2_revealed[idx as usize] = 0; // mark as revealed
        }
        let p2_chunks = [TestChunk {
            mines: vec![0u8; cells],
            revealed: p2_revealed,
            flagged: vec![HIDDEN_CELL; cells],
        }];
        let mut p2_slots = [ChunkSlot {
            chunk_x: 0,
            chunk_y: 0,
            mines: &p2_chunks[0].mines,
            revealed: &p2_chunks[0].revealed,
            flagged: &p2_chunks[0].flagged,
            new_indices: Vec::new(),
        }];
        let seeds2: Vec<(i32, i32)> = out1.continuation.clone();
        let out2 = flood_fill(cs, cells as u32, 0, HIDDEN_CELL, HIDDEN_CELL, &seeds2, &mut p2_slots);

        // Pass 2 must reveal exactly the remaining cells (no overlap, no duplicates)
        let remaining = cells as u32 - cap;
        assert_eq!(out2.revealed_count, remaining, "pass 2 should reveal remaining cells");
        for &idx in out2.reveals.iter().flat_map(|r| r.indices.iter()) {
            assert!(
                all_indices.insert(idx),
                "index {idx} was revealed in both passes — duplicate"
            );
        }
        assert_eq!(all_indices.len(), cells, "total reveals should equal full region");
    }
}
