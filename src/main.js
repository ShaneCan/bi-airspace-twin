import * as THREE from "three";
import {DEFAULT_GRID} from "./config.js";
import {BlockWorld} from "./BlockWorld.js";
import {parseBigraphXML_singleBRoot} from "./BigraphGridXMLParser.js";
import {fetchCdoModel, fetchGrid3D, fetchGrid3DFromOccupancy} from "./services.js";
import {createScene} from "./scene.js";
import {subscribeMultipleDrones, subscribeSimulation, disconnectAllRosConnections} from "./ros2.js";

const element = id => document.getElementById(id);
const {scene, camera, renderer, controls, frameAirspace} = createScene(element("viewport"));

const world = new THREE.Group();
world.rotation.x = -Math.PI / 2; // Z is altitude in the model.
scene.add(world);
const blockWorld = new BlockWorld(world);
const fleetGroup = new THREE.Group();
fleetGroup.renderOrder = 3;
world.add(fleetGroup);

const CF_START = 231;
const keys = new Set();
const navigationKeys = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"]);
const airspaceSource = element("airspaceSource");
const modelButtons = ["fetchServiceAPI", "loadOccupancyMap", "connectCDO"].map(element);
const modelStatuses = ["gridStatus", "occStatus", "cdoStatus"].map(element);
const uasCount = element("uasCount");
const uasRange = element("uasRange");
const uasList = element("uasList");
const uasError = element("uasError");
const rosHost = element("rosBridgeHost");
const simulationMode = element("simulationMode");
const showOccupied = element("showOccupied");

let configuredCount = uasCount.valueAsNumber;
let fleet = [];
let activeGrid = null;
let markerScale = .4;
let loadingModel = false;
let previousTime = performance.now();

function createDroneModel(size, color) {
    const droneGroup = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({color: color});
    const propMaterial = new THREE.MeshStandardMaterial({
        color: color,
        transparent: true,
        opacity: 0.6
    });
    
    // Main body (center, slightly flattened)
    const bodyWidth = size * 0.25;
    const bodyLength = size * 0.3;
    const bodyHeight = size * 0.08;
    const body = new THREE.Mesh(
        new THREE.BoxGeometry(bodyWidth, bodyLength, bodyHeight),
        bodyMaterial
    );
    droneGroup.add(body);
    
    // Four arms extending diagonally from center (X configuration)
    const armLength = size * 0.35;
    const armWidth = size * 0.04;
    const armHeight = size * 0.02;
    
    // X configuration: arms at 45-degree angles
    const armAngles = [Math.PI / 4, -Math.PI / 4, 3 * Math.PI / 4, -3 * Math.PI / 4];

    armAngles.forEach(angle => {
        const x = Math.cos(angle) * armLength;
        const y = Math.sin(angle) * armLength;
        
        // Arm
        const arm = new THREE.Mesh(
            new THREE.BoxGeometry(armWidth, armLength, armHeight),
            bodyMaterial
        );
        arm.rotation.z = angle;
        arm.position.set(x, y, 0);
        droneGroup.add(arm);
        
        // Motor housing at the end of each arm
        const motorRadius = size * 0.06;
        const motorHeight = size * 0.05;
        const motor = new THREE.Mesh(
            new THREE.CylinderGeometry(motorRadius, motorRadius, motorHeight, 12),
            bodyMaterial
        );
        motor.rotation.x = Math.PI / 2;
        motor.position.set(x, y, motorHeight / 2);
        droneGroup.add(motor);
        
        // Propeller above motor
        const propRadius = size * 0.12;
        const propHeight = size * 0.008;
        const propeller = new THREE.Mesh(
            new THREE.CylinderGeometry(propRadius, propRadius, propHeight, 16),
            propMaterial
        );
        propeller.rotation.x = Math.PI / 2;
        propeller.position.set(x, y, motorHeight + propHeight / 2);
        droneGroup.add(propeller);
    });
    
    return droneGroup;
}

function animate(time) {
    const delta = Math.min((time - previousTime) / 1000, .05);
    previousTime = time;
    if (controls.isLocked && keys.size) {
        const x = Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
        const z = Number(keys.has("KeyW")) - Number(keys.has("KeyS"));
        const distance = delta * 5 / (Math.hypot(x, z) || 1);
        controls.moveRight(x * distance);
        controls.moveForward(z * distance);
        camera.position.y += (Number(keys.has("KeyQ")) - Number(keys.has("KeyE"))) * delta * 5;
    }
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}

document.addEventListener("keydown", event => {
    if (controls.isLocked && navigationKeys.has(event.code)) {
        event.preventDefault();
        keys.add(event.code);
    }
});
document.addEventListener("keyup", event => keys.delete(event.code));
controls.addEventListener("unlock", () => keys.clear());
window.addEventListener("blur", () => keys.clear());

function showStatus(status, message, error = false) {
    status.textContent = message;
    status.dataset.error = String(error);
}

function cellKeyForPosition([x, y, z]) {
    if (!activeGrid) return null;
    const {rows, cols, layers, stepX, stepY, layerHeight, originX, originY, originZ} = activeGrid;
    const row = Math.round((x - originX) / stepX);
    const col = Math.round((y - originY) / stepY);
    // Z marks a layer's floor. The tolerance absorbs decimal rounding at shared faces.
    const layer = Math.floor((z - originZ) / layerHeight + 1e-9);
    if (row < 0 || row >= rows || col < 0 || col >= cols || layer < 0 || layer >= layers) {
        return null;
    }
    return BlockWorld.key(originX + row * stepX, originY + col * stepY, originZ + layer * layerHeight);
}

function updateCell(uas, cellKey) {
    if (uas.cellKey === cellKey) return;
    if (uas.cellKey) blockWorld.highlightCell(uas.cellKey, -1);
    if (cellKey) blockWorld.highlightCell(cellKey, 1);
    uas.cellKey = cellKey;
}

function updateLivePosition(position, index) {
    const uas = fleet[index];
    if (!uas || !position.every(Number.isFinite)) return;

    if (!uas.model) {
        const color = new THREE.Color().setHSL((.58 + index * .618) % 1, .7, .39);
        uas.model = createDroneModel(1, color);
        uas.label = blockWorld.createTextLabel(uas.id, new THREE.Vector3(), {live: true});
        fleetGroup.add(uas.model, uas.label);
        uas.item.classList.add("has-pose");
    }

    uas.position = position;
    uas.model.position.fromArray(position);
    uas.model.scale.setScalar(markerScale);
    uas.label.position.copy(uas.model.position);
    uas.label.position.z += Math.max(.18, markerScale * .63);
    updateCell(uas, cellKeyForPosition(position));
}

function refreshFleet() {
    disconnectAllRosConnections();
    for (const uas of fleet) updateCell(uas, null);
    blockWorld.dispose(fleetGroup);
    fleetGroup.clear();

    fleet = Array.from({length: configuredCount}, (_, index) => {
        const id = `cf${CF_START + index}`;
        const item = document.createElement("li");
        item.textContent = id;
        return {id, item, cellKey: null};
    });
    uasList.replaceChildren(...fleet.map(uas => uas.item));
    const first = fleet[0].id;
    const last = fleet.at(-1).id;
    uasRange.value = first === last ? first : `${first}–${last}`;

    const host = rosHost.value.trim() || rosHost.defaultValue;
    try {
        if (simulationMode.checked) {
            subscribeSimulation(host, CF_START, configuredCount, updateLivePosition);
        } else {
            subscribeMultipleDrones(host, CF_START, configuredCount, updateLivePosition);
        }
    } catch (error) {
        showStatus(uasError, "Enter a valid ROS Bridge address.", true);
        console.error(error);
    }
}

function validateUasCount() {
    const valid = uasCount.validity.valid;
    uasCount.setAttribute("aria-invalid", String(!valid));
    showStatus(uasError, valid ? "" : "Enter a whole number from 1 to 30.", !valid);
    return valid;
}

function commitUasCount() {
    if (!validateUasCount() || uasCount.valueAsNumber === configuredCount) return;
    configuredCount = uasCount.valueAsNumber;
    refreshFleet();
}

uasCount.addEventListener("input", validateUasCount);
uasCount.addEventListener("change", commitUasCount);
element("uasForm").addEventListener("submit", event => {
    event.preventDefault();
    commitUasCount();
});
rosHost.addEventListener("change", () => {
    if (uasCount.validity.valid) showStatus(uasError, "");
    refreshFleet();
});
simulationMode.addEventListener("change", refreshFleet);

function makeCells(points, {stepX, stepY, layerHeight}, isOccupied = () => false) {
    return points.map(point => ({
        ...point,
        width: stepX,
        depth: stepY,
        height: layerHeight,
        occupied: isOccupied(point),
    }));
}

function renderAirspace(cells, {source, grid = null, flat = false, perimeter = false}) {
    const bounds = blockWorld.render(cells, {flat, emphasizePerimeter: perimeter});
    world.updateMatrixWorld(true);
    const groundSpacing = Math.min(cells[0].width, cells[0].depth);
    frameAirspace(bounds.applyMatrix4(world.matrixWorld), groundSpacing);
    airspaceSource.textContent = source;
    activeGrid = grid;
    markerScale = THREE.MathUtils.clamp(groundSpacing * .6, .12, .42);
    blockWorld.setOccupiedVisible(showOccupied.checked);
    for (const [index, uas] of fleet.entries()) {
        uas.cellKey = null;
        if (uas.position) updateLivePosition(uas.position, index);
    }
}

function showLocalPreview() {
    const {rows, cols, layers, stepX, stepY, layerHeight, originX, originY, originZ} = DEFAULT_GRID;
    const points = [];
    for (let layer = 0; layer < layers; layer++) {
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                points.push({
                    x: originX + row * stepX,
                    y: originY + col * stepY,
                    z: originZ + layer * layerHeight,
                });
            }
        }
    }
    renderAirspace(makeCells(points, DEFAULT_GRID), {source: "Local preview", perimeter: true});
}

function parsePoints(xmlString, coordinatesAsLinks) {
    let cells;
    try {
        ({cells} = parseBigraphXML_singleBRoot(xmlString, coordinatesAsLinks));
    } catch {
        throw new Error("The service returned an invalid grid model.");
    }

    const points = new Map();
    for (const {point} of cells) {
        const {x, y, z = 0} = point;
        if ([x, y, z].every(Number.isFinite)) points.set(BlockWorld.key(x, y, z), {x, y, z});
    }
    if (!points.size) throw new Error("The service returned a model with no renderable cells.");
    return [...points.values()];
}

function findGridOrigin(points) {
    const origin = {originX: Infinity, originY: Infinity, originZ: Infinity};
    for (const {x, y, z} of points) {
        origin.originX = Math.min(origin.originX, x);
        origin.originY = Math.min(origin.originY, y);
        origin.originZ = Math.min(origin.originZ, z);
    }
    return origin;
}

function bindModelRequest(form, status, pending, failure, load) {
    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (loadingModel) return;
        loadingModel = true;
        for (const button of modelButtons) button.disabled = true;
        showStatus(status, pending);
        try {
            const message = await load();
            for (const other of modelStatuses) {
                if (other !== status) showStatus(other, "");
            }
            showStatus(status, message);
        } catch (error) {
            showStatus(status, error.message.startsWith("HTTP") || error instanceof TypeError ? failure : error.message, true);
            console.error(error);
        } finally {
            loadingModel = false;
            for (const button of modelButtons) button.disabled = false;
        }
    });
}

const gridInputs = Object.entries(DEFAULT_GRID).map(([key, value]) => {
    const input = element(key);
    input.value = value;
    return input;
});
bindModelRequest(element("gridForm"), element("gridStatus"), "Generating 3D grid…",
    "Could not reach the grid service. Check that it is running and try again.", async () => {
        const dimensions = Object.fromEntries(gridInputs.map(input => [input.name, input.valueAsNumber]));
        const {xmlString} = await fetchGrid3D(dimensions);
        const points = parsePoints(xmlString, true);
        const grid = {...dimensions, ...findGridOrigin(points)};
        const {rows, cols, layers} = grid;
        renderAirspace(makeCells(points, grid), {
            source: `${rows} × ${cols} × ${layers} grid`,
            grid,
            perimeter: points.length === rows * cols * layers,
        });
        return `${points.length.toLocaleString()} cells rendered.`;
    },
);

async function readOccupancyMap(file, layerHeightOverride) {
    let occupancyData;
    try {
        occupancyData = JSON.parse(await file.text());
    } catch {
        throw new Error("Select a valid occupancy map JSON file.");
    }
    const {grid, occupancy} = occupancyData ?? {};
    const layerHeight = layerHeightOverride ?? grid?.layerHeight;
    const validGrid = grid && ["rows", "cols", "layers"].every(key => Number.isSafeInteger(grid[key]) && grid[key] > 0)
        && [grid.stepSizeX, grid.stepSizeY, layerHeight].every(value => Number.isFinite(value) && value > 0)
        && ["originX", "originY", "originZ"].every(key => Number.isFinite(grid[key]));
    if (!validGrid || !occupancy || typeof occupancy !== "object") {
        throw new Error("The map needs valid grid dimensions, an origin and occupancy data.");
    }
    return {occupancyData, layerHeight};
}

bindModelRequest(element("occupancyForm"), element("occStatus"), "Loading occupancy map…",
    "Could not load the map from the grid service. Check that it is running and try again.", async () => {
        const override = element("occLayerHeight").valueAsNumber;
        const {occupancyData, layerHeight} = await readOccupancyMap(
            element("occupancyFile").files[0], Number.isFinite(override) ? override : undefined,
        );
        const {grid: map, occupancy} = occupancyData;
        const grid = {...map, layerHeight, stepX: map.stepSizeX, stepY: map.stepSizeY};
        const {xmlString} = await fetchGrid3DFromOccupancy(occupancyData, layerHeight);
        const points = parsePoints(xmlString, true);
        const {originX, originY, originZ, stepX, stepY, rows, cols} = grid;
        const cells = makeCells(points, grid, ({x, y, z}) => {
            const layer = occupancy[Math.round((z - originZ) / layerHeight)];
            const row = Math.round((x - originX) / stepX);
            const col = Math.round((y - originY) / stepY);
            if (!layer || row < 0 || row >= rows || col < 0 || col >= cols) return true;
            return layer[row]?.[col] === 1;
        });
        const occupiedCount = cells.filter(cell => cell.occupied).length;
        renderAirspace(cells, {source: "Occupancy map", grid});
        return `${cells.length - occupiedCount} free · ${occupiedCount} occupied`;
    },
);
showOccupied.addEventListener("change", () => blockWorld.setOccupiedVisible(showOccupied.checked));

bindModelRequest(element("cdoForm"), element("cdoStatus"), "Loading CDO model…",
    "Could not load the CDO model. Check the service and repository path.", async () => {
        const coordinatesAsLinks = element("coordAsLinks").checked;
        const {xmlString, resolutionFactor} = await fetchCdoModel({
            address: element("cdoHost").value.trim(),
            repoPath: element("cdoRepo").value.trim(),
        });
        const points = parsePoints(xmlString, coordinatesAsLinks);
        const resolution = Number(resolutionFactor);
        const size = Number.isFinite(resolution) && resolution > 0 ? resolution : 1;
        const flatPoints = points.map(({x, y}) => ({x, y, z: 1}));
        const cells = makeCells(flatPoints, {stepX: size, stepY: size, layerHeight: size / 4});
        renderAirspace(cells, {source: "CDO model", flat: true});
        return `${blockWorld.blocks.size.toLocaleString()} cells rendered.`;
    },
);

showLocalPreview();
refreshFleet();
requestAnimationFrame(animate);
