"""
map_to_bigrid.py

Reads multi-layer ROS occupancy grid maps (.npy) and produces an occupancy JSON
file suitable for bispace-viewer's "Load Occupancy Map" feature.

The script:
  1. Loads each layer's numpy array (ROS values: -1=unknown, 0=free, 1..100=occupied).
  2. Computes the minimum bounding rectangle across all layers (union of non-unknown cells).
  3. Optionally downsamples when step_size > map resolution.
  4. Outputs a JSON with grid metadata + per-layer occupancy matrices.

Usage:
    python map_to_bigrid.py --map-dir <path_to_export_dir> [options]

Example:
    python map_to_bigrid.py \
        --map-dir ../used_multi_layer_map_20251023_091856/export \
        --step-size 0.05 \
        --layer-height 0.35 \
        --output occupancy_map.json
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import yaml


def load_manifest(map_dir: Path):
    manifest_path = map_dir / "manifest.yaml"
    if not manifest_path.exists():
        raise FileNotFoundError(f"manifest.yaml not found in {map_dir}")
    with open(manifest_path, "r") as f:
        return yaml.safe_load(f)


def load_layer(map_dir: Path, npy_filename: str) -> np.ndarray:
    npy_path = map_dir / npy_filename
    if not npy_path.exists():
        raise FileNotFoundError(f"{npy_filename} not found in {map_dir}")
    data = np.load(str(npy_path))
    return data


def classify_cell(value: float, occupied_thresh: float = 65.0, free_thresh: float = 19.6) -> int:
    """Classify a ROS occupancy grid cell value.

    Returns 0 for free, 1 for occupied, -1 for unknown.

    ROS convention: -1 = unknown, 0 = free, 100 = fully occupied.
    The thresholds are on the 0-100 scale.
    """
    if value < 0:
        return -1  # unknown
    if value <= free_thresh:
        return 0   # free
    if value >= occupied_thresh:
        return 1   # occupied
    return -1       # uncertain → treat as unknown


def compute_bounding_rect(layers: list[np.ndarray], margin: int = 1) -> tuple[int, int, int, int]:
    """Find the bounding rectangle based on explored (free) cells, then expand to
    include nearby obstacles.

    Uses free cells (value 0) as the reliable indicator of explored area, then
    expands the bounding box by *margin* cells to capture surrounding walls.
    Finally clips to the grid dimensions.

    Expects classified grids where 0=free, 1=occupied, -1=unknown.
    Returns (min_row, max_row, min_col, max_col) inclusive.
    """
    min_row, max_row = None, None
    min_col, max_col = None, None
    grid_rows, grid_cols = layers[0].shape

    for grid in layers:
        free_cells = np.argwhere(grid == 0)
        if free_cells.size == 0:
            continue
        r_min, c_min = free_cells.min(axis=0)
        r_max, c_max = free_cells.max(axis=0)

        min_row = r_min if min_row is None else min(min_row, r_min)
        max_row = r_max if max_row is None else max(max_row, r_max)
        min_col = c_min if min_col is None else min(min_col, c_min)
        max_col = c_max if max_col is None else max(max_col, c_max)

    if min_row is None:
        raise ValueError("All layers are completely unknown - nothing to process")

    # Expand by margin to include surrounding obstacles/walls, then clip
    min_row = max(0, min_row - margin)
    max_row = min(grid_rows - 1, max_row + margin)
    min_col = max(0, min_col - margin)
    max_col = min(grid_cols - 1, max_col + margin)

    return int(min_row), int(max_row), int(min_col), int(max_col)


def downsample_grid(grid: np.ndarray, factor: int) -> np.ndarray:
    """Downsample by *factor* using a majority-vote rule.

    Within each factor×factor block the cell is marked occupied if *any*
    source cell is occupied; otherwise free if any source cell is free;
    otherwise unknown.
    """
    rows, cols = grid.shape
    new_rows = (rows + factor - 1) // factor
    new_cols = (cols + factor - 1) // factor
    out = np.full((new_rows, new_cols), -1, dtype=grid.dtype)

    for r in range(new_rows):
        for c in range(new_cols):
            block = grid[r * factor: (r + 1) * factor, c * factor: (c + 1) * factor]
            if np.any(block == 1):
                out[r, c] = 1
            elif np.any(block == 0):
                out[r, c] = 0
    return out


def build_occupancy_json(
    layers_raw: list[np.ndarray],
    manifest: dict,
    step_size: float,
    layer_height: float,
    occupied_thresh: float,
    free_thresh: float,
):
    layer_meta = manifest["layers"]
    resolution = layer_meta[0]["resolution"]
    origin = layer_meta[0]["origin"]  # [x, y, z]

    # Classify each layer
    classified = []
    for raw in layers_raw:
        grid = np.vectorize(
            lambda v: classify_cell(v, occupied_thresh, free_thresh)
        )(raw).astype(np.int8)
        classified.append(grid)

    # Bounding rectangle on classified grids (pixel coordinates)
    min_row, max_row, min_col, max_col = compute_bounding_rect(classified)
    bbox_rows = max_row - min_row + 1
    bbox_cols = max_col - min_col + 1
    print(f"Bounding rect (pixels): rows [{min_row}, {max_row}], cols [{min_col}, {max_col}]")
    print(f"  = {bbox_rows} rows x {bbox_cols} cols")

    # Crop to bounding rectangle
    cropped = []
    for grid in classified:
        cropped.append(grid[min_row: max_row + 1, min_col: max_col + 1])

    # Downsample if step_size > resolution
    ds_factor = max(1, round(step_size / resolution))
    effective_step = resolution * ds_factor
    if ds_factor > 1:
        print(f"Downsampling by factor {ds_factor} (effective step: {effective_step:.4f}m)")
        cropped = [downsample_grid(g, ds_factor) for g in cropped]
    else:
        effective_step = resolution

    rows, cols = cropped[0].shape
    num_layers = len(cropped)

    # Convert: unknown (-1) and occupied (1) → 1 (occupied in output)
    # free (0) → 0
    occupancy = {}
    for i, grid in enumerate(cropped):
        occ = np.where(grid == 0, 0, 1).tolist()
        occupancy[str(i)] = occ

    # Compute world-space origin of the cropped bounding rectangle.
    # ROS origin is the world coordinate of grid cell (0, 0).
    # row → X axis, col → Y axis (per the plan description).
    origin_x = round(origin[0] + min_row * resolution, 6)
    origin_y = round(origin[1] + min_col * resolution, 6)
    origin_z = round(origin[2], 6)

    if ds_factor > 1:
        # After downsampling, keep the same world-space origin
        pass

    result = {
        "grid": {
            "rows": rows,
            "cols": cols,
            "layers": num_layers,
            "stepSizeX": round(effective_step, 6),
            "stepSizeY": round(effective_step, 6),
            "layerHeight": layer_height,
            "originX": origin_x,
            "originY": origin_y,
            "originZ": origin_z,
        },
        "occupancy": occupancy,
    }

    # Statistics
    for i, grid in enumerate(cropped):
        total = grid.size
        free_count = int(np.sum(grid == 0))
        occ_count = total - free_count
        print(f"Layer {i}: {rows}x{cols} = {total} cells, "
              f"free={free_count} ({100*free_count/total:.1f}%), "
              f"occupied={occ_count} ({100*occ_count/total:.1f}%)")

    return result


def main():
    parser = argparse.ArgumentParser(
        description="Convert multi-layer ROS occupancy grids to bigrid occupancy JSON"
    )
    parser.add_argument(
        "--map-dir", required=True,
        help="Path to the export directory containing manifest.yaml and .npy files"
    )
    parser.add_argument(
        "--step-size", type=float, default=0.05,
        help="Desired grid step size in meters (default: 0.05, same as map resolution)"
    )
    parser.add_argument(
        "--layer-height", type=float, default=0.35,
        help="Height between layers in meters (default: 0.35)"
    )
    parser.add_argument(
        "--occupied-thresh", type=float, default=65.0,
        help="Occupied threshold on 0-100 scale (default: 65.0)"
    )
    parser.add_argument(
        "--free-thresh", type=float, default=19.6,
        help="Free threshold on 0-100 scale (default: 19.6)"
    )
    parser.add_argument(
        "--output", "-o", default="occupancy_map.json",
        help="Output JSON file path (default: occupancy_map.json)"
    )

    args = parser.parse_args()
    map_dir = Path(args.map_dir)

    manifest = load_manifest(map_dir)
    layer_meta = manifest["layers"]
    print(f"Found {len(layer_meta)} layers in manifest")

    layers_raw = []
    for lm in layer_meta:
        npy_file = lm["npy"]
        print(f"Loading {npy_file} ...")
        data = load_layer(map_dir, npy_file)
        print(f"  Shape: {data.shape}, dtype: {data.dtype}, "
              f"range: [{data.min()}, {data.max()}]")
        layers_raw.append(data)

    result = build_occupancy_json(
        layers_raw,
        manifest,
        step_size=args.step_size,
        layer_height=args.layer_height,
        occupied_thresh=args.occupied_thresh,
        free_thresh=args.free_thresh,
    )

    output_path = Path(args.output)
    with open(output_path, "w") as f:
        json.dump(result, f)
    print(f"\nWritten {output_path} ({output_path.stat().st_size} bytes)")
    print(f"Grid: {result['grid']['rows']}x{result['grid']['cols']}x{result['grid']['layers']}")


if __name__ == "__main__":
    main()
