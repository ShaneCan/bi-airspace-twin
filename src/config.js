export const DEFAULT_GRID = Object.freeze({
    rows: 5,
    cols: 5,
    stepX: 1,
    stepY: 1,
    layers: 3,
    layerHeight: 0.35,
    originX: -1,
    originY: -1,
    originZ: 0,
});

/**
 * Central API endpoints.
 */
export const ENDPOINTS = Object.freeze({
    cdo: "/fetch/cdo",
    generateBiGrid: "/generate/bigrid",
    generateBiGrid3D: "/generate/3d-diagonal-directional/bigrid",
});

/** Allowed response formats */
export const FORMATS = Object.freeze({
    xml: "xml",
    json: "json",
    protobuf: "protobuf",
});
