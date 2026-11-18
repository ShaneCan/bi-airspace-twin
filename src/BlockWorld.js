import * as THREE from "three";

const COLORS = {
    free: 0x41855c,
    perimeter: 0x296744,
    occupied: 0x8b0000,
    single: 0xffd700,
    shared: 0xff0000,
};

const OBSTACLE_OPACITY = .36;
const UAS_OCCUPANCY_OPACITY = .32;

function cellEdges({x, y, z, width, depth, height}) {
    const left = x - width / 2;
    const right = x + width / 2;
    const front = y - depth / 2;
    const back = y + depth / 2;
    const top = z + height;
    return [
        [left, front, z, right, front, z], [left, back, z, right, back, z],
        [left, front, top, right, front, top], [left, back, top, right, back, top],
        [left, front, z, left, back, z], [right, front, z, right, back, z],
        [left, front, top, left, back, top], [right, front, top, right, back, top],
        [left, front, z, left, front, top], [right, front, z, right, front, top],
        [left, back, z, left, back, top], [right, back, z, right, back, top],
    ];
}

function lineSegments(positions, color, opacity) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
        color, opacity, transparent: opacity < 1, depthWrite: false,
    }));
}

function outline(cells, color, opacity, bounds) {
    const uniqueEdges = new Set();
    const exterior = [];
    const interior = [];
    const limits = bounds ? [bounds.min.toArray(), bounds.max.toArray()] : [];
    for (const cell of cells) {
        for (const edge of cellEdges(cell)) {
            const key = edge.map(value => Math.round(value * 1e6)).join(",");
            if (uniqueEdges.has(key)) continue;
            uniqueEdges.add(key);
            const onFace = bounds && limits.some(limit => limit.some((value, axis) =>
                Math.abs(edge[axis] - value) < 1e-6 && Math.abs(edge[axis + 3] - value) < 1e-6,
            ));
            (bounds && !onFace ? interior : exterior).push(...edge);
        }
    }
    const lines = new THREE.Group();
    if (interior.length) lines.add(lineSegments(interior, color, opacity * .48));
    if (exterior.length) lines.add(lineSegments(exterior, color, opacity));
    return lines;
}

function surfaces(cells, {color, opacity, solid = false}) {
    const geometry = solid ? new THREE.BoxGeometry() : new THREE.PlaneGeometry();
    const material = new THREE.MeshBasicMaterial({
        color, opacity, transparent: opacity < 1, depthWrite: solid,
        side: solid ? THREE.FrontSide : THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, cells.length);
    const transform = new THREE.Object3D();
    for (const [index, {x, y, z, width, depth, height}] of cells.entries()) {
        transform.position.set(x, y, solid ? z + height / 2 : z + height);
        transform.scale.set(width, depth, height);
        transform.updateMatrix();
        mesh.setMatrixAt(index, transform.matrix);
    }
    return mesh;
}

export class BlockWorld {
    constructor(world) {
        this.base = new THREE.Group();
        this.occupied = new THREE.Group();
        this.highlights = new THREE.Group();
        world.add(this.base, this.occupied, this.highlights);
        this.blocks = new Map();
    }

    static key(x, y, z) {
        return [x, y, z].map(value => Math.round(value * 1e6) / 1e6).join(",");
    }

    render(cells, {flat = false, emphasizePerimeter = false} = {}) {
        this.clear();
        const bounds = new THREE.Box3();
        const free = [];
        const occupied = [];

        for (const cell of cells) {
            const {x, y, z, width, depth, height} = cell;
            const key = BlockWorld.key(x, y, z);
            if (this.blocks.has(key)) continue;
            this.blocks.set(key, {cell, count: 0, highlight: null});
            (cell.occupied ? occupied : free).push(cell);
            bounds.expandByPoint(new THREE.Vector3(x - width / 2, y - depth / 2, z));
            bounds.expandByPoint(new THREE.Vector3(x + width / 2, y + depth / 2, z + height));
            if (flat) {
                this.base.add(this.createTextLabel(`${x}, ${y}`, new THREE.Vector3(x, y, z + height * 2)));
            }
        }

        if (free.length) {
            this.base.add(surfaces(free, {color: COLORS.free, opacity: flat ? .4 : .066, solid: flat}));
            this.base.add(outline(free, COLORS.free, .60, emphasizePerimeter ? bounds : undefined));
        }
        if (occupied.length) {
            this.occupied.add(surfaces(occupied, {color: COLORS.occupied, opacity: OBSTACLE_OPACITY, solid: true}));
            this.occupied.add(outline(occupied, COLORS.occupied, .8));
        }
        if (emphasizePerimeter && !bounds.isEmpty()) {
            const frame = new THREE.Box3Helper(bounds.clone(), COLORS.perimeter);
            frame.material.depthWrite = false;
            this.base.add(frame);
        }
        return bounds;
    }

    highlightCell(key, delta) {
        const block = this.blocks.get(key);
        if (!block) return;

        const oldColor = Math.min(block.count, 2);
        block.count = Math.max(0, block.count + delta);
        const newColor = Math.min(block.count, 2);
        if (oldColor === newColor) return;

        if (block.highlight) {
            block.highlight.removeFromParent();
            this.dispose(block.highlight);
            block.highlight = null;
        }
        if (newColor === 0) return;

        const color = newColor === 1 ? COLORS.single : COLORS.shared;
        const marker = new THREE.Group();
        marker.renderOrder = 2;
        marker.add(surfaces([block.cell], {color, opacity: UAS_OCCUPANCY_OPACITY, solid: true}));
        marker.add(outline([block.cell], color, .9));
        marker.visible = !block.cell.occupied || this.occupied.visible;
        block.highlight = marker;
        this.highlights.add(marker);
    }

    setOccupiedVisible(visible) {
        this.occupied.visible = visible;
        for (const {cell, highlight} of this.blocks.values()) {
            if (cell.occupied && highlight) highlight.visible = visible;
        }
    }

    clear() {
        for (const group of [this.base, this.occupied, this.highlights]) {
            this.dispose(group);
            group.clear();
        }
        this.blocks.clear();
    }

    dispose(object) {
        const materials = new Set();
        object.traverse(child => {
            if (child.isInstancedMesh) child.dispose();
            child.geometry?.dispose();
            if (child.material) materials.add(child.material);
        });
        for (const material of materials) {
            material.map?.dispose();
            material.dispose();
        }
    }

    createTextLabel(text, position, {live = false} = {}) {
        const canvas = document.createElement("canvas");
        canvas.width = live ? 168 : 256;
        canvas.height = 64;
        const context = canvas.getContext("2d");
        if (live) {
            context.fillStyle = "#f8fcf7";
            context.strokeStyle = "#83a991";
            context.lineWidth = 2;
            context.beginPath();
            context.roundRect(3, 3, canvas.width - 6, canvas.height - 6, 12);
            context.fill();
            context.stroke();
        }
        context.font = live ? "600 34px monospace" : "30px monospace";
        context.fillStyle = "#183329";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(text, canvas.width / 2, canvas.height / 2);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: !live,
            depthWrite: false,
        }));
        sprite.scale.set(live ? .48 : .72, .18, 1);
        sprite.position.copy(position);
        if (live) sprite.renderOrder = 10;
        return sprite;
    }
}
