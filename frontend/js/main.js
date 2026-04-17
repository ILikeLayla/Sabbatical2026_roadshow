'use strict';

// ─── Socket Connection ──────────────────────────────────────────────────────────
const socket = io(window.location.origin, {
    transports: ['websocket'],
    upgrade: false,
    reconnectionDelay: 1000,
    reconnectionAttempts: 10
});

// ─── Game State ────────────────────────────────────────────────────────────────
const gameState = {
    isConnected: false,
    gameId: null,
    playerRole: null,
    playerHealth: 100,
    opponentHealth: 100,
    opponentName: 'Opponent',
    username: null,
    gameActive: false,
    currentAmmo: 30,
    totalAmmo: 120,
    maxMagazine: 30,
    playerWins: 0,
    opponentWins: 0
};

// ─── UI References ─────────────────────────────────────────────────────────────
const lobbyScreen   = document.getElementById('lobby-screen');
const gameScreen    = document.getElementById('game-screen');
const resultScreen  = document.getElementById('result-screen');
const usernameInput  = document.getElementById('username-input');
const joinBtn        = document.getElementById('join-btn');
const statusText     = document.getElementById('status-text');
const playAgainBtn   = document.getElementById('play-again-btn');
const crosshairEl    = document.getElementById('crosshair');
const pointerMsgEl   = document.getElementById('pointer-lock-msg');
const damageFlashEl  = document.getElementById('damage-flash');
const ammoText       = document.getElementById('ammo-text');
const reloadStatus   = document.getElementById('reload-status');

// ─── Three.js Core ─────────────────────────────────────────────────────────────
const canvas   = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x0d0d1a);
scene.fog = new THREE.FogExp2(0x0d0d1a, 0.018);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);

// ─── Lighting ──────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffffff, 0.35));

const sunLight = new THREE.DirectionalLight(0xffeedd, 1.0);
sunLight.position.set(10, 25, 5);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far  = 120;
sunLight.shadow.camera.left = sunLight.shadow.camera.bottom = -35;
sunLight.shadow.camera.right = sunLight.shadow.camera.top   =  35;
scene.add(sunLight);

const accentA = new THREE.PointLight(0x3344ff, 1.2, 20);
accentA.position.set(-8, 4, -18);
scene.add(accentA);

const accentB = new THREE.PointLight(0xff3344, 1.2, 20);
accentB.position.set(8, 4, 18);
scene.add(accentB);

// ─── Arena ─────────────────────────────────────────────────────────────────────
const colliders = [];

function buildArena() {
    // ── Floor ──────────────────────────────────────────────────────────
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(50, 50),
        new THREE.MeshLambertMaterial({ color: 0x222233 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    scene.add(new THREE.GridHelper(50, 25, 0x333355, 0x222244));

    const ceil = new THREE.Mesh(
        new THREE.PlaneGeometry(50, 50),
        new THREE.MeshLambertMaterial({ color: 0x111122 })
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = 6;
    scene.add(ceil);

    // ── Boundary walls ─────────────────────────────────────────────────
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x2a2a44 });
    [
        [50, 6, 1,   0, 3, -25],
        [50, 6, 1,   0, 3,  25],
        [1,  6, 50, -25, 3,  0],
        [1,  6, 50,  25, 3,  0],
    ].forEach(([w, h, d, x, y, z]) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        colliders.push(mesh);
    });

    // ── Solid box helper ────────────────────────────────────────────────
    function addBox(w, h, d, x, y, z, color) {
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(w, h, d),
            new THREE.MeshLambertMaterial({ color })
        );
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        colliders.push(mesh);
    }

    // ── Windowed bunkers at z = ±6 ─────────────────────────────────────
    // Window gap: x = -1 to +1, y = 0.8 to 2.2  (shoot / peek through)
    [-6, 6].forEach(bz => {
        addBox(6, 3.0, 0.8, -4, 1.5, bz, 0x3a3a5a); // left pillar
        addBox(6, 3.0, 0.8,  4, 1.5, bz, 0x3a3a5a); // right pillar
        addBox(2, 0.8, 0.8,  0, 0.4, bz, 0x3a3a5a); // bottom sill
        addBox(2, 0.8, 0.8,  0, 2.6, bz, 0x3a3a5a); // top lintel
    });

    // ── Raised platforms + staircases at x = ±16 ───────────────────────
    // Platform: 4 wide, 8 deep (z = -5 to 3), 2 m tall
    // 4 steps per side, each 0.5 m rise × 0.8 m run
    const PLAT_H = 2.0;
    const STEP_D = 0.8;
    const STEP_H = 0.5;
    [-16, 16].forEach(px => {
        addBox(4, PLAT_H, 8, px, PLAT_H / 2, -1, 0x4a3a2a); // platform body

        // South stairs (player2 climbs from +z side)
        for (let i = 0; i < 4; i++) {
            const h  = PLAT_H - i * STEP_H;             // 2.0, 1.5, 1.0, 0.5
            const cz = 3 + STEP_D * 0.5 + i * STEP_D;  // 3.4, 4.2, 5.0, 5.8
            addBox(4, h, STEP_D, px, h / 2, cz, 0x5a4a3a);
        }

        // North stairs (player1 climbs from -z side)
        for (let i = 0; i < 4; i++) {
            const h  = PLAT_H - i * STEP_H;
            const cz = -5 - STEP_D * 0.5 - i * STEP_D; // -5.4, -6.2, -7.0, -7.8
            addBox(4, h, STEP_D, px, h / 2, cz, 0x5a4a3a);
        }
    });

    // ── Cover boxes ─────────────────────────────────────────────────────
    [
        [-4, 0,  0,  0x444466, 1.5, 1.0, 1.5],
        [ 4, 0,  0,  0x444466, 1.5, 1.0, 1.5],
        [ 0, 0, -10, 0x7a5c1e, 1.8, 1.2, 1.8],
        [ 0, 0,  10, 0x7a5c1e, 1.8, 1.2, 1.8],
        [-8, 0, -2,  0x556644, 1.2, 1.5, 1.2],
        [ 8, 0,  2,  0x556644, 1.2, 1.5, 1.2],
    ].forEach(([x,, z, color, w, h, d]) => {
        addBox(w, h, d, x, h / 2, z, color);
    });
}
buildArena();

// ─── Opponent Mesh ─────────────────────────────────────────────────────────────
const opponentGroup = new THREE.Group();

const bodyMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.65, 1.2, 0.5),
    new THREE.MeshLambertMaterial({ color: 0xff2233 })
);
bodyMesh.position.y = 0.8;
bodyMesh.castShadow = true;
opponentGroup.add(bodyMesh);

const headMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.45, 0.45),
    new THREE.MeshLambertMaterial({ color: 0xff6677 })
);
headMesh.position.y = 1.65;
headMesh.castShadow = true;
opponentGroup.add(headMesh);

opponentGroup.visible = false;
scene.add(opponentGroup);

// ─── Gun Viewmodel ─────────────────────────────────────────────────────────────
const gunGroup = new THREE.Group();

const gunBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.14, 0.36),
    new THREE.MeshLambertMaterial({ color: 0x333333 })
);
gunBody.position.set(0, 0, 0.05);
gunGroup.add(gunBody);

const gunBarrel = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.07, 0.5),
    new THREE.MeshLambertMaterial({ color: 0x222222 })
);
gunBarrel.position.set(0, -0.015, -0.25);
gunGroup.add(gunBarrel);

const muzzleFlash = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffdd44 })
);
muzzleFlash.position.set(0, -0.015, -0.52);
muzzleFlash.visible = false;
gunGroup.add(muzzleFlash);

gunGroup.position.set(0.22, -0.28, -0.42);
camera.add(gunGroup);
scene.add(camera);

// ─── Player State ──────────────────────────────────────────────────────────────
const playerPos       = new THREE.Vector3(0, 1.7, -15);
const PLAYER_HEIGHT   = 1.7;
const SQUAT_HEIGHT    = 1.0;
const PLAYER_RADIUS   = 0.4;
const MOVE_SPEED      = 5.5;
const SQUAT_SPEED     = 2.5;
const GRAVITY         = 20;
const JUMP_FORCE      = 8;

// ─── Opponent State ────────────────────────────────────────────────────────────
let opponentIsSquatting = false;
let opponentVerticalVelocity = 0;
let opponentCameraHeightCurrent = PLAYER_HEIGHT;

let yaw   = 0;
let isADS = false;
let pitch = 0;
let isLocked = false;
let verticalVelocity = 0;
let isGrounded = true;
let isSquatting = false;
let cameraHeightTarget = PLAYER_HEIGHT;
let cameraHeightCurrent = PLAYER_HEIGHT;
const keys = { w: false, a: false, s: false, d: false, space: false, shift: false };

// ─── Shooting ──────────────────────────────────────────────────────────────────
const raycaster      = new THREE.Raycaster();
const bulletLines    = [];
const impactParticles = [];
let   canShoot       = true;
let   isReloading    = false;
let   reloadEndTime  = 0;
const RELOAD_TIME    = 1500;  // milliseconds

function showMuzzleFlash() {
    muzzleFlash.visible = true;
    setTimeout(() => { muzzleFlash.visible = false; }, 60);
}

function createTracer(start, end) {
    const geo = new THREE.BufferGeometry().setFromPoints([start.clone(), end.clone()]);
    const mat = new THREE.LineBasicMaterial({ color: 0xffee44, transparent: true, opacity: 1.0 });
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    bulletLines.push({ line, age: 0, maxAge: 12 });
}

function flashHitMarker() {
    const ch = document.getElementById('crosshair');
    ch.style.color = '#ff2222';
    ch.style.transform = 'translate(-50%, -50%) scale(1.4)';
    setTimeout(() => {
        ch.style.color = 'rgba(255,255,255,0.85)';
        ch.style.transform = 'translate(-50%, -50%) scale(1)';
    }, 120);
}

function flashMeshHit(mesh) {
    const origColor = mesh.material.color.getHex();
    mesh.material.color.setHex(0xffffff);
    setTimeout(() => { mesh.material.color.setHex(origColor); }, 80);
}

function createImpact(point, isPlayerHit) {
    const color  = isPlayerHit ? 0xff2222 : 0xff8800;
    const count  = isPlayerHit ? 10 : 6;

    // Central flash sphere
    const flashGeo = new THREE.SphereGeometry(isPlayerHit ? 0.12 : 0.08, 6, 6);
    const flashMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1.0, depthWrite: false });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.copy(point);
    scene.add(flash);
    impactParticles.push({ mesh: flash, vel: new THREE.Vector3(), age: 0, maxAge: 6, scale0: 1 });

    // Sparks / blood drops
    for (let i = 0; i < count; i++) {
        const geo = new THREE.SphereGeometry(0.025, 4, 4);
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1.0, depthWrite: false });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(point);
        scene.add(mesh);
        const speed = 2 + Math.random() * 4;
        const theta = Math.random() * Math.PI * 2;
        const phi   = (Math.random() - 0.5) * Math.PI;
        const vel = new THREE.Vector3(
            Math.cos(phi) * Math.cos(theta) * speed,
            Math.abs(Math.sin(phi)) * speed + 1,
            Math.cos(phi) * Math.sin(theta) * speed
        );
        impactParticles.push({ mesh, vel, age: 0, maxAge: 18 + Math.floor(Math.random() * 12) });
    }
}

function shoot() {
    if (!gameState.gameActive || !isLocked || !canShoot || isReloading) return;
    if (gameState.currentAmmo <= 0) return;
    
    canShoot = false;
    setTimeout(() => { canShoot = true; }, 250);

    gameState.currentAmmo--;
    updateAmmoUI();

    showMuzzleFlash();
    raycaster.setFromCamera({ x: 0, y: 0 }, camera);

    // Cast against both player meshes AND all obstacles
    const allTargets = [bodyMesh, headMesh, ...colliders];
    const hits = raycaster.intersectObjects(allTargets, false);
    // Tracer starts at the muzzle tip (world space), ends at hit or max range
    const tracerOrigin = muzzleFlash.getWorldPosition(new THREE.Vector3());
    const tracerEnd = raycaster.ray.at(40, new THREE.Vector3());

    if (hits.length > 0) {
        const nearest = hits[0];
        createTracer(tracerOrigin, nearest.point.clone());
        createImpact(nearest.point.clone(), nearest.object === bodyMesh || nearest.object === headMesh);

        // Only register damage if the nearest hit is a player mesh (not an obstacle)
        if (nearest.object === bodyMesh || nearest.object === headMesh) {
            const isHead = nearest.object === headMesh;
            const damage = isHead ? 25 : 10;
            socket.emit('hit', { damage });
            gameState.opponentHealth = Math.max(0, gameState.opponentHealth - damage);
            updateHealthUI('opponent', gameState.opponentHealth, 100);
            flashHitMarker();
            flashMeshHit(nearest.object);
        }
    } else {
        createTracer(tracerOrigin, tracerEnd);
    }

    socket.emit('shoot', {
        x: playerPos.x,
        y: PLAYER_HEIGHT - 0.15,
        z: playerPos.z,
        yaw,
        pitch
    });
}

// ─── Collision Resolution ──────────────────────────────────────────────────────
function resolveCollisions() {
    for (const obj of colliders) {
        const playerFeet = playerPos.y - PLAYER_HEIGHT; // recalc each step to pick up step-ups
        const bb = new THREE.Box3().setFromObject(obj);
        const bbMinX = bb.min.x - PLAYER_RADIUS;
        const bbMaxX = bb.max.x + PLAYER_RADIUS;
        const bbMinZ = bb.min.z - PLAYER_RADIUS;
        const bbMaxZ = bb.max.z + PLAYER_RADIUS;

        if (playerPos.x > bbMinX && playerPos.x < bbMaxX &&
            playerPos.z > bbMinZ && playerPos.z < bbMaxZ) {

            const bbTop = bb.max.y;

            // Step-up: top of box is within 0.52 m above player feet → ride up
            if (bbTop > playerFeet + 0.01 && bbTop <= playerFeet + 0.52) {
                playerPos.y = PLAYER_HEIGHT + bbTop;
                verticalVelocity = 0;
                isGrounded = true;
                continue;
            }

            // Only push sideways when feet are below the box top surface
            if (playerFeet < bbTop - 0.05) {
                const dx1 = playerPos.x - bbMinX;
                const dx2 = bbMaxX - playerPos.x;
                const dz1 = playerPos.z - bbMinZ;
                const dz2 = bbMaxZ - playerPos.z;
                const min = Math.min(dx1, dx2, dz1, dz2);

                if      (min === dx1) playerPos.x = bbMinX;
                else if (min === dx2) playerPos.x = bbMaxX;
                else if (min === dz1) playerPos.z = bbMinZ;
                else                  playerPos.z = bbMaxZ;
            }
        }
    }
}

// ─── Input ─────────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
    if (e.code === 'KeyW') keys.w = true;
    if (e.code === 'KeyA') keys.a = true;
    if (e.code === 'KeyS') keys.s = true;
    if (e.code === 'KeyD') keys.d = true;
    if (e.code === 'Space') {
        keys.space = true;
        if (isGrounded && gameState.gameActive) jump();
    }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        keys.shift = true;
        isSquatting = true;
        cameraHeightTarget = SQUAT_HEIGHT;
        updateSquatUI();
    }
    if (e.code === 'KeyR') startReload();
});
document.addEventListener('keyup', e => {
    if (e.code === 'KeyW') keys.w = false;
    if (e.code === 'KeyA') keys.a = false;
    if (e.code === 'KeyS') keys.s = false;
    if (e.code === 'KeyD') keys.d = false;
    if (e.code === 'Space') keys.space = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        keys.shift = false;
        isSquatting = false;
        cameraHeightTarget = PLAYER_HEIGHT;
        updateSquatUI();
    }
});

document.addEventListener('mousemove', e => {
    if (!isLocked) return;
    const sens = 0.002;
    yaw   -= e.movementX * sens;
    pitch -= e.movementY * sens;
    pitch  = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
});

document.addEventListener('pointerlockchange', () => {
    isLocked = document.pointerLockElement === canvas;
    if (pointerMsgEl) pointerMsgEl.style.display = (isLocked || !gameState.gameActive) ? 'none' : 'block';
    if (crosshairEl)  crosshairEl.style.display  =  isLocked ? 'block' : 'none';
});

canvas.addEventListener('click', () => {
    if (!isLocked && gameState.gameActive) {
        canvas.requestPointerLock();
    }
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

document.addEventListener('mousedown', e => {
    if (!isLocked) return;
    if (e.button === 0) shoot();
    if (e.button === 2 && gameState.gameActive) isADS = !isADS;
});

// ─── Socket Events ─────────────────────────────────────────────────────────────
socket.on('connect', () => {
    gameState.isConnected = true;
    if (statusText) statusText.textContent = 'Connected — enter a username to play';
});

socket.on('disconnect', () => {
    gameState.isConnected = false;
    if (statusText) statusText.textContent = 'Disconnected from server';
});

socket.on('game_start', data => {
    gameState.gameId         = data.gameId;
    gameState.playerRole     = data.you;
    gameState.opponentName   = data.opponent;
    gameState.gameActive     = true;
    gameState.playerHealth   = 100;
    gameState.opponentHealth = 100;
    if (data.yourWins   !== undefined) gameState.playerWins   = data.yourWins;
    if (data.opponentWins !== undefined) gameState.opponentWins = data.opponentWins;

    if (data.you === 'player1') {
        playerPos.set(-20, PLAYER_HEIGHT, -20);
        yaw = Math.PI * 1.25;          // face toward (+x, +z) corner — center of map
        opponentGroup.position.set(20, 0, 20);
    } else {
        playerPos.set(20, PLAYER_HEIGHT, 20);
        yaw = Math.PI * 0.25;          // face toward (-x, -z) corner — center of map
        opponentGroup.position.set(-20, 0, -20);
    }

    camera.position.copy(playerPos);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = 0;
    pitch = 0;
    verticalVelocity = 0;
    isGrounded = true;
    isSquatting = false;
    isADS = false;
    cameraHeightTarget = PLAYER_HEIGHT;
    cameraHeightCurrent = PLAYER_HEIGHT;

    opponentGroup.visible = true;
    document.getElementById('opponent-name').textContent = data.opponent;
    gameState.currentAmmo = 30;
    gameState.totalAmmo = 120;
    isReloading = false;
    updateHealthUI('player',   100, 100);
    updateHealthUI('opponent', 100, 100);
    updateAmmoUI();
    if (reloadStatus) reloadStatus.textContent = '';

    const roundOverlayEl = document.getElementById('round-overlay');
    if (roundOverlayEl) roundOverlayEl.style.display = 'none';
    updateScoreboard();
    showScreen('game-screen');
    canvas.requestPointerLock();
});

socket.on('opponent_move', data => {
    opponentIsSquatting = data.isSquatting || false;
    // groundY is actual floor position: player.y is camera height, subtract full standing height
    const groundY = data.y - PLAYER_HEIGHT;
    opponentGroup.position.set(data.x, groundY, data.z);
    opponentGroup.rotation.y = data.yaw + Math.PI;
});

socket.on('opponent_shot', data => {
    const start = new THREE.Vector3(data.x, data.y, data.z);
    const dir = new THREE.Vector3(
        -Math.sin(data.yaw) * Math.cos(data.pitch),
         Math.sin(data.pitch),
        -Math.cos(data.yaw) * Math.cos(data.pitch)
    ).normalize();

    // Raycast from opponent's muzzle through colliders to find where tracer stops
    const oppRay = new THREE.Raycaster(start, dir, 0, 40);
    const obstacleHits = oppRay.intersectObjects(colliders, false);
    const tracerEnd = obstacleHits.length > 0
        ? obstacleHits[0].point.clone()
        : start.clone().addScaledVector(dir, 40);
    createTracer(start, tracerEnd);
    createImpact(tracerEnd, false);
});

socket.on('take_damage', data => {
    gameState.playerHealth = Math.max(0, data.health);
    updateHealthUI('player', gameState.playerHealth, 100);
    triggerDamageFlash();
});

socket.on('round_end', data => {
    gameState.gameActive   = false;
    gameState.playerWins   = data.yourWins;
    gameState.opponentWins = data.opponentWins;
    opponentGroup.visible  = false;
    document.exitPointerLock();
    updateScoreboard();
    if (data.seriesOver) {
        endGame(data.winner === gameState.username);
    } else {
        showRoundOverlay(data.winner === gameState.username);
    }
});

// ─── UI Helpers ────────────────────────────────────────────────────────────────
function showScreen(id) {
    [lobbyScreen, gameScreen, resultScreen].forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function updateHealthUI(who, current, max) {
    const fill = document.getElementById(`${who}-health-fill`);
    const text = document.getElementById(`${who}-health-text`);
    const pct  = Math.max(0, (current / max) * 100);
    fill.style.width = pct + '%';
    if (who === 'player') {
        fill.style.background =
            pct > 50 ? 'linear-gradient(90deg,#00cc44,#00ff66)' :
            pct > 25 ? 'linear-gradient(90deg,#cc9900,#ffcc00)' :
                       'linear-gradient(90deg,#cc1122,#ff2233)';
    }
    text.textContent = `${Math.max(0, current)}/100`;
}

function triggerDamageFlash() {
    if (!damageFlashEl) return;
    damageFlashEl.style.opacity = '1';
    setTimeout(() => { damageFlashEl.style.opacity = '0'; }, 120);
}

function updateAmmoUI() {
    if (ammoText) {
        ammoText.textContent = `${gameState.currentAmmo}/${gameState.totalAmmo}`;
        ammoText.style.color = gameState.currentAmmo === 0 ? 'rgba(255, 100, 100, 0.8)' : 'rgba(255, 255, 100, 0.8)';
    }
}

function updateScoreboard() {
    const youEl = document.getElementById('score-you');
    const oppEl = document.getElementById('score-opp');
    if (youEl) youEl.textContent = `${gameState.username || 'YOU'} ${gameState.playerWins}`;
    if (oppEl) oppEl.textContent = `${gameState.opponentWins} ${gameState.opponentName}`;
}

function showRoundOverlay(won) {
    const el    = document.getElementById('round-overlay');
    const msg   = document.getElementById('round-result-msg');
    const score = document.getElementById('round-result-score');
    if (!el) return;
    if (msg)   { msg.textContent = won ? 'ROUND WON' : 'ROUND LOST'; msg.style.color = won ? '#00ff66' : '#ff2233'; }
    if (score) score.textContent = `${gameState.playerWins} — ${gameState.opponentWins}`;
    el.style.display = 'flex';
}

function updateSquatUI() {
    if (reloadStatus) {
        reloadStatus.textContent = isSquatting ? 'SQUATTING' : '';
        reloadStatus.style.color = isSquatting ? 'rgba(100, 200, 255, 0.9)' : 'rgba(255, 150, 100, 0.9)';
    }
}

function jump() {
    if (!isGrounded || !gameState.gameActive) return;
    verticalVelocity = JUMP_FORCE;
    isGrounded = false;
}

function startReload() {
    if (!gameState.gameActive || isReloading || gameState.currentAmmo === gameState.maxMagazine) return;
    if (gameState.totalAmmo <= 0) return;
    
    isReloading = true;
    reloadEndTime = Date.now() + RELOAD_TIME;
    
    if (reloadStatus) {
        reloadStatus.textContent = 'RELOADING...';
        reloadStatus.style.color = 'rgba(255, 150, 100, 0.9)';
    }
}

function finishReload() {
    const ammoNeeded = gameState.maxMagazine - gameState.currentAmmo;
    const ammoToAdd = Math.min(ammoNeeded, gameState.totalAmmo);
    gameState.currentAmmo += ammoToAdd;
    gameState.totalAmmo -= ammoToAdd;
    isReloading = false;
    
    updateAmmoUI();
    if (reloadStatus) {
        reloadStatus.textContent = '';
    }
}

function endGame(won) {
    gameState.gameActive = false;
    opponentGroup.visible = false;
    document.exitPointerLock();
    showScreen('result-screen');
    const title      = document.getElementById('result-title');
    const text       = document.getElementById('result-text');
    const finalScore = document.getElementById('final-score');
    title.textContent = won ? 'SERIES WON!' : 'SERIES LOST!';
    title.style.color = won ? '#00ff66' : '#ff2233';
    text.textContent  = won ? 'You dominated the series!' : 'Better luck next time!';
    if (finalScore) finalScore.textContent = `${gameState.username} ${gameState.playerWins} — ${gameState.opponentWins} ${gameState.opponentName}`;
}

// ─── Lobby Buttons ─────────────────────────────────────────────────────────────
joinBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (username) {
        gameState.username = username;
        joinBtn.disabled = true;
        statusText.textContent = 'Searching for opponent...';
        socket.emit('join_queue', username);
    } else {
        statusText.textContent = 'Please enter a username';
    }
});

playAgainBtn.addEventListener('click', () => {
    gameState.playerHealth   = 100;
    gameState.opponentHealth = 100;
    gameState.playerWins     = 0;
    gameState.opponentWins   = 0;
    gameState.currentAmmo    = 30;
    gameState.totalAmmo      = 120;
    isReloading = false;
    updateHealthUI('player',   100, 100);
    updateHealthUI('opponent', 100, 100);
    updateAmmoUI();
    if (reloadStatus) reloadStatus.textContent = '';
    showScreen('lobby-screen');
    usernameInput.value = '';
    joinBtn.disabled    = false;
    statusText.textContent = 'Connected — enter a username to play';
});

// ─── Game Loop ─────────────────────────────────────────────────────────────────
const clock   = new THREE.Clock();
const moveDir = new THREE.Vector3();
let lastEmit  = 0;
let bobTime   = 0;

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    // Check if reload is finished
    if (isReloading && Date.now() >= reloadEndTime) {
        finishReload();
    }

    if (gameState.gameActive && isLocked) {
        // Apply gravity
        verticalVelocity -= GRAVITY * delta;
        playerPos.y += verticalVelocity * delta;
        
        // Ground check — finds highest walkable surface under the player
        let groundY = 0; // main floor at y = 0
        for (const obj of colliders) {
            const bb = new THREE.Box3().setFromObject(obj);
            if (playerPos.x > bb.min.x - PLAYER_RADIUS * 0.5 &&
                playerPos.x < bb.max.x + PLAYER_RADIUS * 0.5 &&
                playerPos.z > bb.min.z - PLAYER_RADIUS * 0.5 &&
                playerPos.z < bb.max.z + PLAYER_RADIUS * 0.5 &&
                bb.max.y + PLAYER_HEIGHT <= playerPos.y + 0.15) {
                if (bb.max.y > groundY) groundY = bb.max.y;
            }
        }
        const floorY = groundY + PLAYER_HEIGHT;
        if (playerPos.y <= floorY) {
            playerPos.y = floorY;
            verticalVelocity = 0;
            isGrounded = true;
        } else {
            isGrounded = false;
        }

        moveDir.set(
            (keys.d ? 1 : 0) - (keys.a ? 1 : 0),
            0,
            (keys.s ? 1 : 0) - (keys.w ? 1 : 0)
        );

        const isMoving = moveDir.lengthSq() > 0;
        const currentSpeed = isSquatting ? SQUAT_SPEED : MOVE_SPEED;

        if (isMoving) {
            moveDir.normalize().applyEuler(new THREE.Euler(0, yaw, 0));
            playerPos.x += moveDir.x * currentSpeed * delta;
            playerPos.z += moveDir.z * currentSpeed * delta;
            playerPos.x = Math.max(-24, Math.min(24, playerPos.x));
            playerPos.z = Math.max(-24, Math.min(24, playerPos.z));
        }

        resolveCollisions();

        // Step-down: while moving, snap to a surface ≤ 0.6 m below (smooth stair descent)
        if (!isGrounded && verticalVelocity <= 0) {
            let dropY = null;
            for (const obj of colliders) {
                const bb = new THREE.Box3().setFromObject(obj);
                const surfY = bb.max.y + PLAYER_HEIGHT;
                if (playerPos.x > bb.min.x - PLAYER_RADIUS * 0.5 &&
                    playerPos.x < bb.max.x + PLAYER_RADIUS * 0.5 &&
                    playerPos.z > bb.min.z - PLAYER_RADIUS * 0.5 &&
                    playerPos.z < bb.max.z + PLAYER_RADIUS * 0.5 &&
                    surfY < playerPos.y && playerPos.y - surfY < 0.6) {
                    if (dropY === null || bb.max.y > dropY) dropY = bb.max.y;
                }
            }
            if (dropY !== null) {
                playerPos.y = dropY + PLAYER_HEIGHT;
                verticalVelocity = 0;
                isGrounded = true;
            }
        }

        // Smooth camera height transition when squatting
        cameraHeightCurrent += (cameraHeightTarget - cameraHeightCurrent) * 0.12;
        camera.position.copy(playerPos);
        camera.position.y += cameraHeightCurrent - PLAYER_HEIGHT;

        // ADS: smooth FOV + gun position lerp
        const targetFov = isADS ? 45 : 75;
        camera.fov += (targetFov - camera.fov) * 0.18;
        camera.updateProjectionMatrix();

        const targetGunX = isADS ?  0.00 : 0.22;
        const targetGunY = isADS ? -0.20 : -0.28;
        const targetGunZ = isADS ? -0.30 : -0.42;

        // Gun bob (suppressed while ADS)
        if (isMoving && !isADS) {
            const bobSpeed = isSquatting ? 4 : 8;
            const bobAmount = isSquatting ? 0.006 : 0.012;
            bobTime += delta * bobSpeed;
            gunGroup.position.y = targetGunY + Math.sin(bobTime) * bobAmount;
            gunGroup.position.x = targetGunX + Math.cos(bobTime * 0.5) * (bobAmount * 0.5);
            gunGroup.position.z += (targetGunZ - gunGroup.position.z) * 0.15;
        } else {
            bobTime = 0;
            gunGroup.position.x += (targetGunX - gunGroup.position.x) * 0.15;
            gunGroup.position.y += (targetGunY - gunGroup.position.y) * 0.15;
            gunGroup.position.z += (targetGunZ - gunGroup.position.z) * 0.15;
        }

        // Emit position at 20 Hz
        const now = Date.now();
        if (now - lastEmit > 50) {
            socket.emit('player_move', {
                x: playerPos.x, y: playerPos.y, z: playerPos.z,
                yaw, pitch,
                isSquatting,
                verticalVelocity
            });
            lastEmit = now;
        }
    }

    // Fade bullet tracers
    for (let i = bulletLines.length - 1; i >= 0; i--) {
        const bt = bulletLines[i];
        bt.age++;
        bt.line.material.opacity = Math.max(0, 1 - bt.age / bt.maxAge);
        if (bt.age >= bt.maxAge) {
            scene.remove(bt.line);
            bulletLines.splice(i, 1);
        }
    }

    // Animate impact particles
    for (let i = impactParticles.length - 1; i >= 0; i--) {
        const p = impactParticles[i];
        p.age++;
        const t = p.age / p.maxAge;
        // Apply gravity to sparks
        p.vel.y -= 18 * delta;
        p.mesh.position.addScaledVector(p.vel, delta);
        p.mesh.material.opacity = Math.max(0, 1 - t);
        p.mesh.scale.setScalar(Math.max(0, 1 - t * 0.7));
        if (p.age >= p.maxAge) {
            scene.remove(p.mesh);
            impactParticles.splice(i, 1);
        }
    }

    // Smooth opponent squat animation every frame
    if (gameState.gameActive) {
        const opponentHeightTarget = opponentIsSquatting ? SQUAT_HEIGHT : PLAYER_HEIGHT;
        opponentCameraHeightCurrent += (opponentHeightTarget - opponentCameraHeightCurrent) * 0.15;
        // squat_ratio: 1.0 when standing, ~0.59 when fully squatted
        const squat_ratio = opponentCameraHeightCurrent / PLAYER_HEIGHT;
        // Body: scale Y, keep bottom fixed at y=0.2 above group origin
        const BODY_BOTTOM = 0.2;
        const BODY_HALF_H = 0.6; // half of original 1.2
        bodyMesh.scale.y = squat_ratio;
        bodyMesh.position.y = BODY_BOTTOM + BODY_HALF_H * squat_ratio;
        // Head: sit on top of compressed body
        headMesh.position.y = BODY_BOTTOM + 1.2 * squat_ratio + 0.225;
    }

    renderer.render(scene, camera);
}

animate();

// ─── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
