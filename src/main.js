import {ENDPOINTS, FORMATS, DEFAULT_GRID} from "./config.js";
import {BlockWorld} from './BlockWorld.js';
import {parseBigraphXML_singleBRoot} from './BigraphGridXMLParser.js';
import {fetchCdoModel, fetchGrid, fetchGrid3D} from "./services.js";

import * as THREE from 'three';
import {createScene} from "./scene.js";
import {subscribeMultipleDrones, subscribeSimulation, disconnectAllRosConnections} from "./ros2.js";

const {scene, camera, renderer, controls} = createScene();

const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const move = {forward: false, backward: false, left: false, right: false, up: false, down: false};
const speed = 5; // units per second
let prevTime = performance.now();

const mouse = new THREE.Vector2();
const world = new THREE.Group();
scene.add(world);
// Rotate so +Z becomes "up", +Y becomes left-to-right, and +X becomes top-to-bottom
world.rotation.order = 'XYZ'; // default, but being explicit
world.rotation.x = -Math.PI / 2; // Rotate -90° around X

const blockWorld = new BlockWorld(scene, world);
const grassMaterial = new THREE.MeshStandardMaterial({color: 0x00ff00});

let resolutionFactor = 0.2;
let liveBlock = [];
let numOfLiveBlocks = 4;
let rosUnsubscribeFunctions = [];
let gridMode = "2d"; // "2d" or "3d"
let simulationMode = false;

// Current grid configuration, used for mapping drone position to grid cell
let gridConfig = {
    rows: DEFAULT_GRID.rows,
    cols: DEFAULT_GRID.cols,
    stepX: DEFAULT_GRID.stepX,
    stepY: DEFAULT_GRID.stepY,
    layers: 1,
    layerHeight: 1,
    originX: 0,
    originY: 0,
    originZ: 0,
    ready: false,
};

// Track which cell each drone currently occupies (for highlighting)
let droneCellKeys = [];

// Drone ID label sprites above each drone (cf231, cf232, ...)
const DRONE_CF_START = 231;
let liveBlockLabels = [];

let rowsSlider, colsSlider, stepXSlider, stepYSlider;

// Create a drone 3D model (quadcopter style)
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
    
    armAngles.forEach((angle, index) => {
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

// Add a sample block

function initLiveBlock(resolutionFactor, numOfBlocks = 4) {
    // clear previous blocks and labels if re-initializing
    liveBlock.forEach(block => world.remove(block));
    liveBlock = [];

    liveBlockLabels.forEach((sprite) => {
        world.remove(sprite);
        if (sprite.material && sprite.material.map) sprite.material.map.dispose();
        if (sprite.material) sprite.material.dispose();
    });
    liveBlockLabels = [];

    const labelOffset = 0.35; // height above drone in world Z

    for (let i = 0; i < numOfBlocks; i++) {
        const color = new THREE.Color().setHSL((0.6 + i * 0.1) % 1.0, 1.0, 0.5);
        const droneSize = 0.8 * resolutionFactor;
        const droneObject = createDroneModel(droneSize, color);

        // Example placement: offset each block in x-direction
        droneObject.position.set(0, 0, 1.5);

        world.add(droneObject);
        liveBlock.push(droneObject);

        // Label above drone: cf231, cf232, ...
        const cfId = `cf${DRONE_CF_START + i}`;
        const labelPos = new THREE.Vector3(0, 0, 1.5 + labelOffset);
        const label = blockWorld.createTextLabel(cfId, labelPos, 16, {
            depthTest: false,
            depthWrite: false,
            renderOrder: 999
        });
        world.add(label);
        liveBlockLabels.push(label);
    }
}

// Draw Grid
for (let x = 0; x <= 5; x++) {
    for (let y = 0; y <= 5; y++) {
        blockWorld.setBlock(x, y, 0, resolutionFactor, grassMaterial); // flat terrain at y=0
    }
}

// Animate
function animate() {
    requestAnimationFrame(animate); //!start

    const time = performance.now();
    const delta = (time - prevTime) / 1000; // in seconds

    // Movement
    direction.z = Number(move.forward) - Number(move.backward);
    direction.x = Number(move.right) - Number(move.left);
    direction.normalize(); // diagonal movement

    velocity.x = direction.x * speed * delta;
    velocity.z = direction.z * speed * delta;
    
    // Vertical movement (Q = up, E = down)
    const verticalSpeed = speed * delta;
    if (move.up) {
        controls.getObject().position.y += verticalSpeed;
    }
    if (move.down) {
        controls.getObject().position.y -= verticalSpeed;
    }

    controls.moveRight(velocity.x);
    controls.moveForward(velocity.z);

    // Update blocks (change colors over time)
    blockWorld.update();

    renderer.render(scene, camera);//!end
    prevTime = time;
}

function updateLiveBlockPosition([x, y, z], liveBlockIndex = 0) {
    if (!liveBlock || liveBlock.length <= liveBlockIndex) {
        console.warn(`liveBlock index ${liveBlockIndex} invalid, current length: ${liveBlock ? liveBlock.length : 0}`);
        return;
    }
    
    const droneObject = liveBlock[liveBlockIndex];
    if (!droneObject) {
        console.warn(`liveBlock[${liveBlockIndex}] does not exist`);
        return;
    }
    
    // Update drone position
    const zPos = (gridMode === "3d" && z !== undefined) ? z : 1.5;
    droneObject.position.set(x, y, zPos);

    // Update label above this drone
    const labelOffset = 0.35;
    if (liveBlockLabels[liveBlockIndex]) {
        liveBlockLabels[liveBlockIndex].position.set(x, y, zPos + labelOffset);
    }

    // Highlight corresponding grid cell if grid is ready
    if (!gridConfig || !gridConfig.ready) {
        return;
    }

    // Map world coordinates (x,y,z) to grid cell center coordinates (support any origin)
    const { rows, cols, stepX, stepY, layers, layerHeight, originX = 0, originY = 0, originZ = 0 } = gridConfig;

    // Compute (unclamped) indices relative to grid origin
    const rowIdx = Math.round((x - originX) / stepX);
    const colIdx = Math.round((y - originY) / stepY);
    const layerIdx = gridMode === "3d" && layerHeight > 0 && z !== undefined
        ? Math.round((z - originZ) / layerHeight)
        : 0;

    const prevCellKey = droneCellKeys[liveBlockIndex];

    // If out of bounds, treat as leaving the grid: unhighlight previous cell and return
    const outOfBounds =
        rowIdx < 0 || rowIdx >= rows ||
        colIdx < 0 || colIdx >= cols ||
        layerIdx < 0 || layerIdx >= layers;

    if (outOfBounds) {
        if (prevCellKey) {
            const [px, py, pz] = prevCellKey.split(',').map(Number);
            blockWorld.unhighlightCellAt(px, py, pz);
            droneCellKeys[liveBlockIndex] = null;
        }
        return;
    }

    // Convert indices back to cell center coordinates (matching how blocks were created).
    // Round to avoid floating-point key mismatch with BlockWorld.blocks.
    const roundGrid = (v, d = 6) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
    const cellX = roundGrid(originX + rowIdx * stepX);
    const cellY = roundGrid(originY + colIdx * stepY);
    const cellZ = roundGrid(originZ + layerIdx * (gridMode === "3d" ? layerHeight : 0));

    const newCellKey = `${cellX},${cellY},${cellZ}`;

    // If cell hasn't changed, nothing to do
    if (prevCellKey === newCellKey) {
        return;
    }

    // Unhighlight previous cell
    if (prevCellKey) {
        const [px, py, pz] = prevCellKey.split(',').map(Number);
        blockWorld.unhighlightCellAt(px, py, pz);
    }

    // Highlight new cell
    blockWorld.highlightCellAt(cellX, cellY, cellZ);
    droneCellKeys[liveBlockIndex] = newCellKey;
}

function bindSlider(id, valueId) {
    const slider = document.getElementById(id);
    const valueEl = document.getElementById(valueId);
    slider.addEventListener('input', () => {
        valueEl.textContent = slider.value;
    });
    return slider;
}

async function fetchGridAndRender(rows = 3, cols = 3, stepSizeX = 1.0, stepSizeY = 1.0) {
    console.log('Generating 2D bigrid ...');

    // 1) Call service
    const {xmlString, resolutionFactor} = await fetchGrid({
        rows,
        cols,
        stepX: stepSizeX,
        stepY: stepSizeY,
    });

    // Update grid configuration
    gridConfig = {
        rows,
        cols,
        stepX: stepSizeX,
        stepY: stepSizeY,
        layers: 1,
        layerHeight: 1,
        ready: true,
    };

    // 2) Parse XML
    const {cells, linkMap} = parseBigraphXML_singleBRoot(xmlString, true);

    // Infer grid origin from parsed cell coordinates
    let originX = 0, originY = 0;
    if (cells.length > 0) {
        originX = Math.min(...cells.map(c => c.point.x));
        originY = Math.min(...cells.map(c => c.point.y));
    }
    gridConfig.originX = originX;
    gridConfig.originY = originY;
    gridConfig.originZ = 0;

    // 3) Map roots → 3D blocks
    blockWorld.clearAll();
    initLiveBlock(resolutionFactor, numOfLiveBlocks);
    for (const cell of cells) {
        blockWorld.setBlock(cell.point.x, cell.point.y, 1, resolutionFactor, grassMaterial, false);
    }

    console.log("Loaded bigraph with", cells.length, "roots");
}

async function fetchGridAndRender3D(rows = 3, cols = 3, layers = 3, stepSizeX = 1.0, stepSizeY = 1.0, layerHeight = 2.0) {
    console.log('Generating 3D bigrid ...');

    // 1) Call service
    const {xmlString, resolutionFactor} = await fetchGrid3D({
        rows,
        cols,
        layers,
        stepX: stepSizeX,
        stepY: stepSizeY,
        layerHeight: layerHeight,
    });

    // Update grid configuration for 3D grid
    gridConfig = {
        rows,
        cols,
        stepX: stepSizeX,
        stepY: stepSizeY,
        layers,
        layerHeight,
        originX: 0,
        originY: 0,
        originZ: 0,
        ready: true,
    };

    // 2) Parse XML
    const {cells, linkMap} = parseBigraphXML_singleBRoot(xmlString, true);

    // Infer grid origin from parsed cell coordinates
    if (cells.length > 0) {
        const xs = cells.map(c => c.point.x).filter(v => v !== undefined);
        const ys = cells.map(c => c.point.y).filter(v => v !== undefined);
        const zs = cells.map(c => c.point.z).filter(v => v !== undefined);
        if (xs.length) gridConfig.originX = Math.min(...xs);
        if (ys.length) gridConfig.originY = Math.min(...ys);
        if (zs.length) gridConfig.originZ = Math.min(...zs);
    }

    // 3) Map roots → 3D cubes
    blockWorld.clearAll();
    initLiveBlock(resolutionFactor, numOfLiveBlocks);
    
    console.log(`Parsed ${cells.length} cells from XML`);
    
    // Create a set to track rendered coordinates for debugging
    const renderedCoords = new Set();
    const coordMap = new Map(); // Track which cells map to which coordinates
    const allCoords = new Set(); // Track all coordinates we try to render
    let renderedCount = 0;
    let skippedCount = 0;
    let duplicateCount = 0;
    
    // First pass: collect all coordinates
    for (const cell of cells) {
        const z = cell.point.z !== undefined ? cell.point.z : 0;
        if (cell.point.x !== undefined && cell.point.y !== undefined) {
            const coordKey = `${cell.point.x},${cell.point.y},${z}`;
            allCoords.add(coordKey);
        }
    }
    
    console.log(`Unique coordinates to render: ${allCoords.size} out of ${cells.length} cells`);
    
    // Second pass: render cubes
    for (const cell of cells) {
        // Use z coordinate if available, otherwise use 0 (bottom layer)
        const z = cell.point.z !== undefined ? cell.point.z : 0;
        if (cell.point.x !== undefined && cell.point.y !== undefined) {
            const coordKey = `${cell.point.x},${cell.point.y},${z}`;
            
            // Check for duplicates before rendering
            if (renderedCoords.has(coordKey)) {
                console.warn(`Duplicate coordinate detected: (${cell.point.x}, ${cell.point.y}, ${z}) from locale ${cell.locale}`);
                duplicateCount++;
            } else {
                renderedCoords.add(coordKey);
                coordMap.set(coordKey, cell);
            }
            
            blockWorld.setBlock(cell.point.x, cell.point.y, z, resolutionFactor, grassMaterial, true, layerHeight);
            renderedCount++;
        } else {
            console.warn(`Skipping cell with invalid coordinates:`, cell);
            skippedCount++;
        }
    }
    
    console.log(`Rendering summary: ${renderedCount} attempted, ${duplicateCount} duplicates detected, ${skippedCount} skipped`);
    console.log(`Unique coordinates: ${allCoords.size}, Rendered coordinates: ${renderedCoords.size}`);

    console.log(`Loaded 3D bigraph: ${cells.length} cells parsed, ${renderedCount} cubes rendered, ${skippedCount} skipped`);
    
    // Debug: Check if we're missing any expected coordinates
    const expectedCount = rows * cols * layers;
    if (renderedCoords.size < expectedCount) {
        console.warn(`Expected ${expectedCount} unique cubes but only have ${renderedCoords.size} unique coordinates`);
        console.warn(`Rendered ${renderedCount} cubes (may include duplicates)`);
        
        // Log missing coordinates
        const missingCoords = [];
        for (let layer = 0; layer < layers; layer++) {
            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                    const expectedZ = layer * layerHeight;
                    const expectedX = row * stepSizeX;
                    const expectedY = col * stepSizeY;
                    const coordKey = `${expectedX},${expectedY},${expectedZ}`;
                    if (!renderedCoords.has(coordKey)) {
                        missingCoords.push(`(${expectedX}, ${expectedY}, ${expectedZ})`);
                    }
                }
            }
        }
        
        if (missingCoords.length > 0) {
            console.warn(`Missing ${missingCoords.length} cubes:`, missingCoords.slice(0, 10));
            if (missingCoords.length > 10) {
                console.warn(`... and ${missingCoords.length - 10} more`);
            }
        }
        
        // Also check for unexpected coordinates
        const unexpectedCoords = [];
        for (const coordKey of renderedCoords) {
            const [x, y, z] = coordKey.split(',').map(Number);
            const expectedRow = Math.round(x / stepSizeX);
            const expectedCol = Math.round(y / stepSizeY);
            const expectedLayer = Math.round(z / layerHeight);
            
            if (expectedRow < 0 || expectedRow >= rows || 
                expectedCol < 0 || expectedCol >= cols || 
                expectedLayer < 0 || expectedLayer >= layers) {
                unexpectedCoords.push(coordKey);
            }
        }
        
        if (unexpectedCoords.length > 0) {
            console.warn(`Found ${unexpectedCoords.length} unexpected coordinates:`, unexpectedCoords.slice(0, 10));
        }
    }
}

async function fetchCdoAndRender(address, repoPath, coordinatesAsLinks = false, {signal} = {}) {
    console.log("Connecting to CDO ...");

    // 1) Fetch & normalize
    const {xmlString, resolutionFactor} = await fetchCdoModel({
        address,
        repoPath,
        format: FORMATS.xml, // server returns JSON with XML content field
        signal,
    });

    // 2) Parse XML
    const {cells, linkMap} = parseBigraphXML_singleBRoot(xmlString, coordinatesAsLinks);

    // 3) Map roots → 3D blocks
    blockWorld.clearAll();
    initLiveBlock(resolutionFactor, numOfLiveBlocks);
    for (const cell of cells) {
        blockWorld.setBlock(cell.point.x, cell.point.y, 1, resolutionFactor, grassMaterial, false);
    }

    console.log("Loaded bigraph with", cells.length, "roots");
}


document.addEventListener('DOMContentLoaded', () => {
    const slider = document.getElementById("agentSlider");
    const valueLabel = document.getElementById("agentCountValue");
    const buttonContainer = document.getElementById("agentButtons");
    const rosHostInput = document.getElementById("rosBridgeHost");
    const simulationModeCheckbox = document.getElementById("simulationMode");

    rowsSlider = bindSlider('rowsSlider', 'rowsValue');
    colsSlider = bindSlider('colsSlider', 'colsValue');
    stepXSlider = bindSlider('stepXSlider', 'stepXValue');
    stepYSlider = bindSlider('stepYSlider', 'stepYValue');
    
    const gridModeSelect = document.getElementById("gridMode");
    if (gridModeSelect) {
        gridMode = gridModeSelect.value;
        gridModeSelect.addEventListener("change", (e) => {
            gridMode = e.target.value;
            console.log(`Grid mode switched: ${gridMode}`);
        });
    }

    if (simulationModeCheckbox) {
        simulationMode = simulationModeCheckbox.checked;
        simulationModeCheckbox.addEventListener("change", (e) => {
            simulationMode = e.target.checked;
            console.log(`Simulation mode: ${simulationMode}`);
            renderAgentButtons(+slider.value);
        });
    }

    rosHostInput.addEventListener("change", () => {
        renderAgentButtons(+slider.value);
    });

    // Initial render
    renderAgentButtons(+slider.value);

    initLiveBlock(resolutionFactor, numOfLiveBlocks);

    animate();

    // Update on slider change
    slider.addEventListener("input", (e) => {
        const count = +e.target.value;
        valueLabel.textContent = count;
        renderAgentButtons(count);
    });

    // Prevent the right-click context menu
    document.addEventListener('contextmenu', (event) => event.preventDefault());

    // Resize support
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });


    document.getElementById('fetchServiceAPI').addEventListener('click', () => {
        // Fetch Slider values
        const rows = +document.getElementById("rowsSlider").value;
        const cols = +document.getElementById("colsSlider").value;
        const stepX = +document.getElementById("stepXSlider").value;
        const stepY = +document.getElementById("stepYSlider").value;
        const gridModeSelect = document.getElementById("gridMode");
        const currentGridMode = gridModeSelect ? gridModeSelect.value : "2d";

        if (currentGridMode === "3d") {
            const layers = +document.getElementById("layersSlider").value;
            const layerHeight = +document.getElementById("layerHeightSlider").value;
            console.log(`Call 3D API with rows=${rows}, cols=${cols}, layers=${layers}, stepX=${stepX}, stepY=${stepY}, layerHeight=${layerHeight}`);
            try {
                fetchGridAndRender3D(rows, cols, layers, stepX, stepY, layerHeight).then(r => {
                    console.log("Finished");
                });
            } catch (err) {
                console.error("Failed to generate 3D bigraph grid:", err);
            }
        } else {
            console.log(`Call 2D API with rows=${rows}, cols=${cols}, stepX=${stepX}, stepY=${stepY}`);
            try {
                fetchGridAndRender(rows, cols, stepX, stepY).then(r => {
                    console.log("Finished");
                });
            } catch (err) {
                console.error("Failed to generate bigraph grid:", err);
            }
        }
    });

    document.getElementById('connectCDO').addEventListener('click', (event) => {
        // Read dataset (stepSize)
        const stepSize = event.currentTarget.dataset.stepsize;

        // CDO values
        const address = document.getElementById('cdoHost').value;
        const repoPath = document.getElementById('cdoRepo').value;
        const coordinatesAsLinks = document.getElementById('coordAsLinks').checked;

        try {
            console.log("connectCDO clicked with parameters:", {
                address,
                repoPath,
                coordinatesAsLinks
            });
            // Choose FORMATS.json if you expect JSON; default is XML text
            fetchCdoAndRender(address, repoPath, coordinatesAsLinks).then(r => {
                console.log("Finished.")
            });
        } catch (err) {
            console.error("CDO connection failed:", err);
        }


    });

    document.addEventListener('keydown', (e) => {
        switch (e.code) {
            case 'KeyW':
                move.forward = true;
                break;
            case 'KeyS':
                move.backward = true;
                break;
            case 'KeyA':
                move.left = true;
                break;
            case 'KeyD':
                move.right = true;
                break;
            case 'KeyQ':
                move.up = true;
                break;
            case 'KeyE':
                move.down = true;
                break;
        }
    });

    document.addEventListener('keyup', (e) => {
        switch (e.code) {
            case 'KeyW':
                move.forward = false;
                break;
            case 'KeyS':
                move.backward = false;
                break;
            case 'KeyA':
                move.left = false;
                break;
            case 'KeyD':
                move.right = false;
                break;
            case 'KeyQ':
                move.up = false;
                break;
            case 'KeyE':
                move.down = false;
                break;
        }
    });

    document.addEventListener('mousemove', (event) => {
        // Convert mouse position to normalized device coordinates (-1 to +1) for raycasting
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        const rect = renderer.domElement.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
        // console.log(mouse);
    });

    function renderAgentButtons(count) {
        disconnectAllRosConnections();
        rosUnsubscribeFunctions.forEach(unsub => unsub());
        rosUnsubscribeFunctions = [];

        if (Array.isArray(droneCellKeys)) {
            for (const key of droneCellKeys) {
                if (!key) continue;
                const [x, y, z] = key.split(',').map(Number);
                blockWorld.unhighlightCellAt(x, y, z);
            }
        }
        droneCellKeys = [];
        buttonContainer.innerHTML = "";

        const rosHost = document.getElementById("rosBridgeHost").value || "localhost:9090";
        const simCheckbox = document.getElementById("simulationMode");
        const useSimulation = simCheckbox ? simCheckbox.checked : false;

        if (useSimulation) {
            const startCf = 231;
            console.log(`Simulation mode: subscribing to /cf_positions_path @ ${rosHost}, ${count} drones from cf${startCf}`);
            const unsub = subscribeSimulation(rosHost, startCf, count, updateLiveBlockPosition);
            rosUnsubscribeFunctions = [unsub];
        } else {
            const startCf = 231;
            console.log(`ROS2: ${rosHost}, drone count: ${count}, cf${startCf} to cf${startCf + count - 1}`);
            rosUnsubscribeFunctions = subscribeMultipleDrones(rosHost, startCf, count, updateLiveBlockPosition);
        }

        for (let i = 0; i < count; i++) {
            const cfNumber = 231 + i;
            const btn = document.createElement("button");
            btn.className = "btn";
            btn.id = `rosStatusBtn_${i}`;
            btn.textContent = `cf${cfNumber} (ROS2)`;
            btn.disabled = true;
            buttonContainer.appendChild(btn);
        }

        numOfLiveBlocks = count;
        droneCellKeys = new Array(count).fill(null);
        initLiveBlock(resolutionFactor, numOfLiveBlocks);
    }
});
