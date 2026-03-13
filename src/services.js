import {ENDPOINTS, FORMATS} from "./config.js";

/**
 * Calls the grid generator endpoint and returns:
 * { xmlString, resolutionFactor }
 */
export async function fetchGrid({
                                    rows = 3,
                                    cols = 3,
                                    stepX = 1.0,
                                    stepY = 1.0,
                                    format = FORMATS.xml,
                                    signal,
                                }) {
    // Query params (server expects rows/cols/format)
    const query = qs({rows, cols, format});

    // POST body (server expects step sizes and origin)
    const body = {
        x: 0,
        y: 0,
        stepSizeX: stepX,
        stepSizeY: stepY,
    };

    const url = `${ENDPOINTS.generateBiGrid}?${query}`;
    const json = await postJson(url, body, {signal});

    // Normalize names for the caller
    return {
        xmlString: json?.content ?? "",
        resolutionFactor: json?.resolutionFactor ?? 1,
        raw: json,
    };
}

/**
 * Calls the 3D grid generator endpoint and returns:
 * { xmlString, resolutionFactor }
 */
export async function fetchGrid3D({
                                    rows = 3,
                                    cols = 3,
                                    layers = 3,
                                    stepX = 0.5,
                                    stepY = 0.5,
                                    layerHeight = 0.35,
                                    originX = -1.0,
                                    originY = -1.0,
                                    originZ = 0,
                                    format = FORMATS.xml,
                                    signal,
                                }) {
    const query = qs({rows, cols, layers, format});

    const body = {
        x: originX,
        y: originY,
        z: originZ,
        stepSizeX: stepX,
        stepSizeY: stepY,
        layerHeight: layerHeight,
    };

    const url = `${ENDPOINTS.generateBiGrid3D}?${query}`;
    const json = await postJson(url, body, {signal});

    // Normalize names for the caller
    return {
        xmlString: json?.content ?? "",
        resolutionFactor: json?.resolutionFactor ?? 1,
        raw: json,
    };
}

/**
 * Generate a 3D bigrid from occupancy map data.
 * Extracts grid dimensions from the occupancy JSON and calls the 3D bigrid API,
 * using the map's origin and step sizes so coordinates align.
 *
 * @param {Object} occupancyData - Parsed occupancy JSON (grid + occupancy fields)
 * @param {number} [layerHeightOverride] - Optional override for layerHeight
 * @returns {Promise<{xmlString: string, resolutionFactor: number, raw: Object}>}
 */
export async function fetchGrid3DFromOccupancy(occupancyData, layerHeightOverride) {
    const g = occupancyData.grid;
    const layerHeight = layerHeightOverride ?? g.layerHeight;

    return fetchGrid3D({
        rows: g.rows,
        cols: g.cols,
        layers: g.layers,
        stepX: g.stepSizeX,
        stepY: g.stepSizeY,
        layerHeight,
        originX: g.originX,
        originY: g.originY,
        originZ: g.originZ,
    });
}

/**
 * Connects to the CDO service and returns either text (xml/protobuf) or JSON.
 *
 * @param {Object} opts
 * @param {string} opts.address - "host:port" (e.g., "127.0.0.1:2036")
 * @param {string} opts.repoPath - e.g., "/repo1/system"
 * @param {boolean} [opts.coordAsLinks=false]
 * @param {"xml"|"json"|"protobuf"} [opts.format="xml"]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<string|any>} XML/Proto as text, or JSON object
 */
export async function fetchCdoModel({
                                        address,
                                        repoPath,
                                        format = FORMATS.xml, // keep "xml" so server returns XML in the content field
                                        signal,
                                    }) {
    const url = `${ENDPOINTS.cdo}?${qs({
        address,
        repopath: repoPath, // backend expects "repopath"
        format,
    })}`;

    const json = await getJson(url, { signal });
    return {
        xmlString: json?.content ?? "",
        resolutionFactor: json?.resolutionFactor ?? 1,
        raw: json,
    };
}

/**
 * Query builder helper
 * @param params
 * @returns {string}
 */
export function qs(params) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        // Encode booleans explicitly to avoid "on"/"off"
        search.set(k, typeof v === "boolean" ? String(v) : String(v));
    });
    return search.toString();
}

/**
 * Basic GET wrapper with consistent error handling.
 * Add auth headers or credentials here if needed later.
 */
export async function httpGet(url, {signal} = {}) {
    const res = await fetch(url, {signal});
    if (!res.ok) {
        // Surface a concise error with enough context
        const text = await safeReadText(res);
        throw new Error(`HTTP ${res.status} ${res.statusText} @ ${res.url} :: ${truncate(text, 200)}`);
    }
    return res;
}

export async function postJson(url, body, { signal, headers = {} } = {}) {
    const res = await fetch(url, {
        method: "POST",
        signal,
        headers: {
            "Content-Type": "application/json",
            ...headers,
        },
        body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
        const text = await safeReadText(res);
        throw new Error(`HTTP ${res.status} ${res.statusText} @ ${res.url} :: ${truncate(text, 200)}`);
    }
    return res.json();
}

/** Convenience helpers for common payloads */
export async function getText(url, opts) {
    const res = await httpGet(url, opts);
    return res.text();
}

export async function getJson(url, opts) {
    const res = await httpGet(url, opts);
    return res.json();
}

/** Utilities (internal) */
async function safeReadText(res) {
    try {
        return await res.text();
    } catch {
        return "<no body>";
    }
}

function truncate(s, n) {
    return s && s.length > n ? s.slice(0, n) + "…" : s;
}
