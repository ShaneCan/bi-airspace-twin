const connections = new Map();

function send(ws, op, topic, type) {
    ws.send(JSON.stringify({op, topic, type}));
}

function connectRosBridge(host) {
    const address = /^wss?:\/\//i.test(host) ? host : `ws://${host}`;
    const url = new URL(address).href;
    const existing = connections.get(url);
    if (existing && existing.ws.readyState <= WebSocket.OPEN) return existing;

    const ws = new WebSocket(url);
    const topics = new Map();
    const connection = {ws, topics};
    connections.set(url, connection);

    ws.addEventListener("open", () => {
        if (connections.get(url) !== connection) return;
        for (const [topic, {type}] of topics) send(ws, "subscribe", topic, type);
    });

    ws.addEventListener("message", event => {
        if (connections.get(url) !== connection) return;
        try {
            const {op, topic, msg} = JSON.parse(event.data);
            if (op === "publish" && msg) topics.get(topic)?.handler(msg);
        } catch (error) {
            console.warn("Could not process ROS2 message", error);
        }
    });

    ws.addEventListener("close", () => {
        if (connections.get(url) === connection) connections.delete(url);
    });

    return connection;
}

function subscribe(host, topic, type, handler) {
    const {ws, topics} = connectRosBridge(host);
    const entry = {type, handler};
    const subscribed = topics.has(topic);
    topics.set(topic, entry);
    if (!subscribed && ws.readyState === WebSocket.OPEN) send(ws, "subscribe", topic, type);
    return () => {
        if (topics.get(topic) !== entry) return;
        topics.delete(topic);
        if (ws.readyState === WebSocket.OPEN) send(ws, "unsubscribe", topic);
    };
}

export function subscribeRosTopic(host, topic, messageType, onMessage, liveBlockIndex = 0) {
    return subscribe(host, topic, messageType, msg => {
        if (messageType === "geometry_msgs/PoseStamped") {
            if (msg.pose?.position) onMessage(readPosition(msg.pose.position), liveBlockIndex);
        } else {
            onMessage(msg, liveBlockIndex);
        }
    });
}

export function disconnectAllRosConnections() {
    const active = [...connections.values()];
    connections.clear();
    for (const {ws, topics} of active) {
        if (ws.readyState === WebSocket.OPEN) {
            for (const topic of topics.keys()) send(ws, "unsubscribe", topic);
        }
        topics.clear();
        if (ws.readyState <= WebSocket.OPEN) ws.close();
    }
}

export function subscribeMultipleDrones(host, startCf, count, onUpdate) {
    return Array.from({length: count}, (_, index) => subscribeRosTopic(
        host, `/cf${startCf + index}/pose`, "geometry_msgs/PoseStamped", onUpdate, index,
    ));
}

export function subscribeSimulation(host, startCf, count, onUpdate) {
    return subscribe(host, "/cf_positions_path", "nav_msgs/Path", msg => {
        if (!Array.isArray(msg.poses)) return;
        for (const stampedPose of msg.poses) {
            const frameId = stampedPose?.header?.frame_id;
            if (typeof frameId !== "string") continue;
            const cfNumber = Number.parseInt(frameId.replace(/\D/g, ""), 10);
            const index = cfNumber - startCf;
            if (Number.isInteger(index) && index >= 0 && index < count) {
                onUpdate(readPosition(stampedPose.pose?.position), index);
            }
        }
    });
}

function readPosition(position) {
    const {x, y, z} = position ?? {};
    return [x ?? 0, y ?? 0, z ?? 0];
}
