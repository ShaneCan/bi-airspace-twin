import * as THREE from "three";
import {PointerLockControls} from "three-stdlib";

export function createScene(viewport) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xedf4ef);

    const camera = new THREE.PerspectiveCamera(38, 1, .02, 500);
    const renderer = new THREE.WebGLRenderer({antialias: true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const canvas = renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "3D airspace. Press Enter to look around, Escape to exit.");
    viewport.append(canvas);

    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(10, 14, 7);
    scene.add(light, new THREE.AmbientLight(0xffffff, 1.6));

    const controls = new PointerLockControls(camera, canvas);
    canvas.addEventListener("click", () => controls.lock());
    canvas.addEventListener("keydown", event => {
        if (event.code === "Enter") controls.lock();
    });

    const viewDirection = new THREE.Vector3(1.03, .94, 1.65).normalize();
    const right = new THREE.Vector3().crossVectors(camera.up, viewDirection).normalize();
    const up = new THREE.Vector3().crossVectors(viewDirection, right);
    let framedBounds;
    let floor;

    function fitCamera(bounds) {
        const center = bounds.getCenter(new THREE.Vector3());
        const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const horizontal = vertical * camera.aspect;
        let distance = .35;
        const corners = [];
        for (const x of [bounds.min.x, bounds.max.x]) {
            for (const y of [bounds.min.y, bounds.max.y]) {
                for (const z of [bounds.min.z, bounds.max.z]) {
                    const corner = new THREE.Vector3(x, y, z).sub(center);
                    const projected = [corner.dot(right), corner.dot(up), corner.dot(viewDirection)];
                    const fit = Math.max(Math.abs(projected[0]) / horizontal, Math.abs(projected[1]) / vertical);
                    distance = Math.max(distance, projected[2] + fit * 1.24);
                    corners.push(projected);
                }
            }
        }
        const projectedX = corners.map(([x, , z]) => x / (distance - z));
        const projectedY = corners.map(([, y, z]) => y / (distance - z));
        center.addScaledVector(right, (Math.min(...projectedX) + Math.max(...projectedX)) * distance / 2);
        center.addScaledVector(up, (Math.min(...projectedY) + Math.max(...projectedY)) * distance / 2);
        camera.position.copy(center).addScaledVector(viewDirection, distance);
        camera.lookAt(center);
        camera.updateMatrixWorld();
    }

    function resize() {
        const {width, height} = viewport.getBoundingClientRect();
        if (!width || !height) return;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        if (framedBounds && !controls.isLocked) fitCamera(framedBounds);
    }
    new ResizeObserver(resize).observe(viewport);
    resize();

    function frameAirspace(bounds, groundSpacing) {
        framedBounds = bounds.clone();
        const size = bounds.getSize(new THREE.Vector3());
        const floorSize = Math.max(size.x, size.z, groundSpacing * 4) * 2.3;
        const subdivisions = Math.min(64, Math.max(4, Math.round(floorSize / groundSpacing)));
        if (floor) {
            floor.removeFromParent();
            floor.dispose();
        }
        floor = new THREE.GridHelper(floorSize, subdivisions, 0xb8d0be, 0xc9ddce);
        floor.position.copy(bounds.getCenter(new THREE.Vector3()));
        floor.position.y = bounds.min.y - .015;
        floor.material.transparent = true;
        floor.material.opacity = .53;
        floor.material.depthWrite = false;
        scene.add(floor);
        fitCamera(framedBounds);
    }

    return {scene, camera, renderer, controls, frameAirspace};
}
