import * as THREE from 'three';

export class BlockWorld {
    constructor(scene, world) {
        this.scene = scene;
        this.world = world;
        this.blocks = new Map(); // key: "x,y,z", value: { mesh, timer }
    }

    /** Round to fixed decimals so grid cell keys match across lookups (avoids float mismatch). */
    _roundCoord(v, decimals = 6) {
        const f = Math.pow(10, decimals);
        return Math.round(v * f) / f;
    }

    _key(x, y, z) {
        return `${this._roundCoord(x)},${this._roundCoord(y)},${this._roundCoord(z)}`;
    }
    _materialKey(material) {
        // Assumes you're identifying materials by their color
        return material.color.getHexString();
    }

    //first version
    setBlock(x, y, z, size, material, is3D = false, layerHeight = 1.0) {
        const key = this._key(x, y, z);
        if (this.blocks.has(key)) {
            console.warn(`Skipping duplicate block at (${x}, ${y}, ${z})`);
            return; // already exists
        }

        let mesh;
        if (is3D) {
            // 3D mode: Create transparent cube with colored edges
            const geometry = new THREE.BoxGeometry(size, size, layerHeight);
            
            // Create transparent material
            const transparentMaterial = new THREE.MeshBasicMaterial({
                color: material.color || 0x00ff00,
                transparent: true,
                opacity: 0.1,
                side: THREE.DoubleSide
            });
            
            mesh = new THREE.Mesh(geometry, transparentMaterial);
            // Position cube so its bottom is at z coordinate (center is at z + layerHeight/2)
            mesh.position.set(x, y, z + layerHeight / 2);
            this.world.add(mesh);
            
            // Add wireframe edges
            const edges = new THREE.EdgesGeometry(geometry);
            const edgeMaterial = new THREE.LineBasicMaterial({
                color: material.color || 0x00ff00,
                linewidth: 2
            });
            const wireframe = new THREE.LineSegments(edges, edgeMaterial);
            mesh.add(wireframe);
            
            // Store wireframe reference for cleanup
            mesh.userData.wireframe = wireframe;
        } else {
            // 2D mode: Original flat block
            const geometry = new THREE.BoxGeometry(size, size, size/4);
            mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(x, y, z);
            this.world.add(mesh);
        }

        // Create coordinate label
        if(true) {
            if (is3D) {
                // Place label slightly above the cube bottom to avoid z-fighting, and always render in front
                const coordLbl = new THREE.Vector3(x, y, z + 0.01);
                const label = this.createTextLabel(
                    `${x}, ${y}, ${z}`,
                    coordLbl,
                    14,
                    { depthTest: false, depthWrite: false, renderOrder: 999 }
                );
                this.world.add(label);
            } else {
                const coordLbl = mesh.position.clone();
                coordLbl.z += size/2 + 0.125;
                const label = this.createTextLabel(`${coordLbl.x}, ${coordLbl.y}`, coordLbl, 14);
                this.world.add(label);
            }
        }

        // Add a timer state to the block (increasing over time), plus highlight state
        const baseColor = mesh.material && mesh.material.color
            ? mesh.material.color.clone()
            : new THREE.Color(0xffffff);
        this.blocks.set(key, {
            mesh,
            timer: 0,
            is3D,
            baseColor,
            highlightCount: 0
        });
    }


    removeBlock(x, y, z) {
        const key = this._key(x, y, z);
        const block = this.blocks.get(key);
        if (block) {
            // Clean up wireframe if exists
            if (block.mesh.userData.wireframe) {
                block.mesh.remove(block.mesh.userData.wireframe);
                block.mesh.userData.wireframe.geometry.dispose();
                block.mesh.userData.wireframe.material.dispose();
            }
            // this.scene.remove(block.mesh);
            this.world.remove(block.mesh);
            this.blocks.delete(key);
        }
    }

    clearAll() {
        // Remove all blocks from the scene
        for (let [key, block] of this.blocks) {
            // this.scene.remove(block.mesh);
            this.world.remove(block.mesh);
        }
        this.clearGroup(this.world);
        this.blocks.clear();
    }

        update() {
        // Loop through blocks and update their timers/material
        for (let [key, block] of this.blocks) {

            // Example: animate matrix (e.g., bobbing block)
            // const matrix = new THREE.Matrix4().makeTranslation(0, Math.sin(performance.now() / 500) * 0.1, 0);
            // block.mesh.updateMatrix();
            // block.mesh.geometry.applyMatrix4( matrix );

            block.timer += 0.01; // increment timer
            if (block.timer > 4) block.timer = 0; // reset after 2 seconds

            // If highlighted, keep highlight color and skip animation
            if (block.highlightCount && block.highlightCount > 0) {
                continue;
            }

            // Change block color based on timer (only for 2D blocks, 3D blocks keep wireframe color)
            if (!block.is3D) {
                const color = new THREE.Color(0x00ee00).lerp(
                    new THREE.Color(0x00bb00),
                    Math.sin(block.timer * Math.PI/2)
                );
                if (block.mesh.material && block.mesh.material.color) {
                    block.mesh.material.color.set(color);
                }
            } else {
                // Update wireframe color for 3D blocks
                if (block.mesh.userData.wireframe && block.mesh.userData.wireframe.material) {
                    const color = new THREE.Color(0x00ee00).lerp(
                        new THREE.Color(0x00bb00),
                        Math.sin(block.timer * Math.PI/2)
                    );
                    block.mesh.userData.wireframe.material.color.set(color);
                }
            }
        }
    }

    /**
     * Highlight a cell at the given world coordinates (x,y,z).
     * If multiple drones occupy the same cell, we keep a reference count.
     */
    highlightCellAt(x, y, z) {
        const key = this._key(x, y, z);
        const block = this.blocks.get(key);
        if (!block) return;

        block.highlightCount = (block.highlightCount || 0) + 1;

        // Choose color based on number of drones in this cell:
        // 1 drone -> gold, 2 or more -> red
        const color =
            block.highlightCount === 1
                ? new THREE.Color(0xffd700) // gold
                : new THREE.Color(0xff0000); // red

        if (block.mesh.material && block.mesh.material.color) {
            block.mesh.material.color.set(color);
        }
        if (block.mesh.userData.wireframe && block.mesh.userData.wireframe.material) {
            block.mesh.userData.wireframe.material.color.set(color);
        }
    }

    /**
     * Remove highlight from a cell. Only resets when reference count drops to zero.
     */
    unhighlightCellAt(x, y, z) {
        const key = this._key(x, y, z);
        const block = this.blocks.get(key);
        if (!block) return;

        if (!block.highlightCount || block.highlightCount <= 0) {
            block.highlightCount = 0;
            return;
        }

        block.highlightCount -= 1;

        // After decrement, choose appropriate color
        if (block.highlightCount === 0) {
            // Restore base color
            if (block.mesh.material && block.mesh.material.color && block.baseColor) {
                block.mesh.material.color.copy(block.baseColor);
            }
            if (block.mesh.userData.wireframe && block.mesh.userData.wireframe.material && block.baseColor) {
                block.mesh.userData.wireframe.material.color.copy(block.baseColor);
            }
        } else if (block.highlightCount === 1) {
            // Back to single-drone: gold
            const color = new THREE.Color(0xffd700);
            if (block.mesh.material && block.mesh.material.color) {
                block.mesh.material.color.set(color);
            }
            if (block.mesh.userData.wireframe && block.mesh.userData.wireframe.material) {
                block.mesh.userData.wireframe.material.color.set(color);
            }
        } else {
            // Still multi-drone: red
            const color = new THREE.Color(0xff0000);
            if (block.mesh.material && block.mesh.material.color) {
                block.mesh.material.color.set(color);
            }
            if (block.mesh.userData.wireframe && block.mesh.userData.wireframe.material) {
                block.mesh.userData.wireframe.material.color.set(color);
            }
        }
    }

    createTextLabel(text, position, fontSize = 28, options = {}) {
        const { depthTest = true, depthWrite = true, renderOrder = 0 } = options;
        // Create canvas to draw text
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        // const fontSize = 42;

        canvas.width = 512;
        canvas.height = 128;

        // Style text
        context.font = `${fontSize}px Arial`;
        context.fillStyle = 'white';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, canvas.width / 2, canvas.height / 2);

        // Create texture
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        texture.needsUpdate = true;

        // Create sprite
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest,
            depthWrite,
        });
        const sprite = new THREE.Sprite(material);
        sprite.renderOrder = renderOrder;

        // Scale and position sprite
        const scale = 1;
        sprite.scale.set(2 * scale, 0.5 * scale, 1);
        sprite.position.set(position.x, position.y, position.z);

        return sprite;
    }

    clearGroup(group) {
        while (group.children.length > 0) {
            const child = group.children[0];

            // Dispose geometry
            if (child.geometry) {
                child.geometry.dispose();
            }

            // Dispose material (handle arrays too)
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }

            // Dispose texture if present
            if (child.material && child.material.map) {
                child.material.map.dispose();
            }

            group.remove(child);
        }
    }
}