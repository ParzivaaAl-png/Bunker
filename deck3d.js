// =============================================================================
// BUNKER 3D Graphics Engine (Three.js & GSAP)
// =============================================================================

// Global 3D States
let deck3D = {
  scene: null,
  camera: null,
  renderer: null,
  cards: [], // Array of card mesh objects { mesh, category, text, isRevealed, defaultPos, defaultRot }
  hoveredCard: null,
  inspectedCard: null,
  raycaster: new THREE.Raycaster(),
  mouse: new THREE.Vector2(),
  width: 0,
  height: 0,
  lastDeckStateStr: "" // Store serialized player cards state to prevent resetting on hovers/ticks
};

let spotlight3D = {
  scene: null,
  camera: null,
  renderer: null,
  cardMesh: null,
  currentSpeakerId: "",
  currentCardType: "",
  isRevealed: false
};

// Category details
const CATEGORY_INFO = {
  profession: { label: "Профессия", color: "#ff9800" },
  health: { label: "Здоровье", color: "#00e676" },
  biology: { label: "Биология", color: "#ff007f" },
  hobby: { label: "Хобби", color: "#00e5ff" },
  phobia: { label: "Фобия", color: "#ff1744" },
  baggage: { label: "Багаж", color: "#ffd600" },
  addInfo: { label: "Доп. инфо", color: "#2979ff" },
  quality: { label: "Качества", color: "#1de9b6" },
  special: { label: "Спец-карта", color: "#7c4dff" }
};

// -----------------------------------------------------------------------------
// 1. DYNAMIC CANVAS TEXTURE CREATOR
// -----------------------------------------------------------------------------

function drawCardFace(category, text, revealed, color, isRevealedToAll) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 768;
  const ctx = canvas.getContext("2d");

  // Background gradient
  const grad = ctx.createRadialGradient(256, 384, 100, 256, 384, 500);
  grad.addColorStop(0, "#121929");
  grad.addColorStop(1, "#080a10");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 768);

  // Draw tech grid pattern
  ctx.strokeStyle = "rgba(255,255,255,0.015)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 512; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 768);
    ctx.stroke();
  }
  for (let j = 0; j < 768; j += 32) {
    ctx.beginPath();
    ctx.moveTo(0, j);
    ctx.lineTo(512, j);
    ctx.stroke();
  }

  // Draw border: dimmed grey border if fanned card is hidden in hand, neon color border if revealed to everyone
  const isPrivate = (revealed && isRevealedToAll === false);
  const finalBorderColor = isPrivate ? "rgba(140, 150, 170, 0.4)" : color;
  const shadowBlurVal = isPrivate ? 0 : 15;

  ctx.strokeStyle = finalBorderColor;
  ctx.shadowColor = color;
  ctx.shadowBlur = shadowBlurVal;
  ctx.lineWidth = 6;
  ctx.strokeRect(20, 20, 472, 728);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.lineWidth = 1;
  ctx.shadowBlur = 0;
  ctx.strokeRect(28, 28, 456, 712);

  // Tech corners
  ctx.fillStyle = finalBorderColor;
  ctx.fillRect(15, 15, 25, 6);
  ctx.fillRect(15, 15, 6, 25);
  ctx.fillRect(472, 15, 25, 6);
  ctx.fillRect(491, 15, 6, 25);
  ctx.fillRect(15, 747, 25, 6);
  ctx.fillRect(15, 728, 6, 25);
  ctx.fillRect(472, 747, 25, 6);
  ctx.fillRect(491, 728, 6, 25);

  if (revealed) {
    // FRONT FACE: Characteristics
    // Draw Category Badge
    ctx.shadowBlur = isPrivate ? 0 : 5;
    ctx.shadowColor = color;
    ctx.font = "bold 24px 'Orbitron', 'Inter', sans-serif";
    ctx.fillStyle = finalBorderColor;
    ctx.textAlign = "center";
    
    let label = CATEGORY_INFO[category]?.label.toUpperCase() || "ДОСЬЕ";
    if (isRevealedToAll === true) {
      label += "  🔓"; // Revealed badge icon
    } else if (isRevealedToAll === false) {
      label += "  🔒"; // Private/hidden in hand badge icon
    }
    
    ctx.fillText(label, 256, 80);

    // Decorative Line
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(60, 110);
    ctx.lineTo(452, 110);
    ctx.stroke();

    // Secondary line
    ctx.strokeStyle = finalBorderColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(180, 110);
    ctx.lineTo(332, 110);
    ctx.stroke();

    // Icon or decorative shape
    ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
    ctx.beginPath();
    ctx.arc(256, 220, 80, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
    ctx.lineWidth = 2;
    ctx.strokeRect(216, 180, 80, 80);

    // Main Value text wrapping
    ctx.fillStyle = isPrivate ? "rgba(255, 255, 255, 0.8)" : "#ffffff";
    ctx.shadowBlur = 0;
    ctx.font = "500 28px 'Inter', sans-serif";
    ctx.textAlign = "center";
    
    wrapText(ctx, text, 256, 380, 400, 42);

    // Watermark/Footer
    ctx.font = "bold 16px 'Orbitron', 'Inter', sans-serif";
    ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
    ctx.fillText("BUNKER V.2", 256, 680);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.strokeRect(200, 655, 112, 35);
  } else {
    // BACK FACE: Cover / Hologram
    // Circular graphics
    ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
    ctx.beginPath();
    ctx.arc(256, 384, 150, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(256, 384, 120, 0, Math.PI * 2);
    ctx.stroke();

    // Circuit details
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(100, 384);
    ctx.lineTo(200, 384);
    ctx.moveTo(312, 384);
    ctx.lineTo(412, 384);
    ctx.moveTo(256, 200);
    ctx.lineTo(256, 280);
    ctx.moveTo(256, 488);
    ctx.lineTo(256, 568);
    ctx.stroke();

    // Large Center Title/Question Mark for unrevealed active cards
    ctx.shadowBlur = 25;
    ctx.shadowColor = color;
    ctx.font = "900 120px 'Orbitron', 'Inter', sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("?", 256, 420);

    // Warning Badge
    ctx.shadowBlur = 5;
    ctx.font = "bold 20px 'Orbitron', sans-serif";
    ctx.fillStyle = color;
    ctx.fillText("RESTRICTED DATA", 256, 540);
  }

  return canvas;
}

// Wrap text in canvas helper
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  let currentY = y;

  for (let n = 0; n < words.length; n++) {
    let testLine = line + words[n] + " ";
    let metrics = ctx.measureText(testLine);
    let testWidth = metrics.width;
    if (testWidth > maxWidth && n > 0) {
      ctx.fillText(line, x, currentY);
      line = words[n] + " ";
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, currentY);
}

// -----------------------------------------------------------------------------
// 2. INITIALIZATION ROUTINES
// -----------------------------------------------------------------------------

function init3D() {
  console.log("Initializing 3D Card Engine...");

  // A. Local Player's 3D Deck
  const deckWrapper = document.querySelector(".my-3d-deck-wrapper");
  const deckCanvas = document.getElementById("my-3d-deck-canvas");
  if (deckCanvas && deckWrapper) {
    deck3D.width = deckWrapper.clientWidth;
    deck3D.height = deckWrapper.clientHeight;

    deck3D.scene = new THREE.Scene();
    
    // Transparent or dark space background
    deck3D.renderer = new THREE.WebGLRenderer({ canvas: deckCanvas, antialias: true, alpha: true });
    deck3D.renderer.setSize(deck3D.width, deck3D.height);
    deck3D.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Camera setup
    deck3D.camera = new THREE.PerspectiveCamera(45, deck3D.width / deck3D.height, 0.1, 100);
    deck3D.camera.position.set(0, 0, 9.0); // Clean camera framing for fanning card hand in full viewport

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    deck3D.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(5, 5, 10);
    deck3D.scene.add(dirLight);

    // Event listener for raycasting on window instead of canvas so pointer-events: none works
    window.addEventListener("mousemove", onDeckMouseMove);
    window.addEventListener("click", onDeckMouseClick);
  }

  // B. Spotlight Active Speaker 3D Card
  const speakerWrapper = document.querySelector(".speaker-3d-card-wrapper");
  const speakerCanvas = document.getElementById("active-speaker-3d-canvas");
  if (speakerCanvas && speakerWrapper) {
    const w = speakerWrapper.clientWidth;
    const h = speakerWrapper.clientHeight;

    spotlight3D.scene = new THREE.Scene();
    spotlight3D.renderer = new THREE.WebGLRenderer({ canvas: speakerCanvas, antialias: true, alpha: true });
    spotlight3D.renderer.setSize(w, h);
    spotlight3D.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    spotlight3D.camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
    spotlight3D.camera.position.set(0, 0, 9.2); // Brought camera slightly closer to see cards much clearer

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    spotlight3D.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(-2, 4, 10);
    spotlight3D.scene.add(dirLight);

    // Add rotating placeholder mesh if empty
    createSpotlightPlaceholder();
  }

  // C. Start Animation Loops
  animate();

  // Resize Listener
  window.addEventListener("resize", handleResize);
}

function handleResize() {
  // Resizing Deck Canvas
  const deckWrapper = document.querySelector(".my-3d-deck-wrapper");
  if (deckWrapper && deck3D.renderer) {
    deck3D.width = deckWrapper.clientWidth;
    deck3D.height = deckWrapper.clientHeight;
    deck3D.camera.aspect = deck3D.width / deck3D.height;
    deck3D.camera.updateProjectionMatrix();
    deck3D.renderer.setSize(deck3D.width, deck3D.height);
  }

  // Resizing Spotlight Canvas
  const speakerWrapper = document.querySelector(".speaker-3d-card-wrapper");
  if (speakerWrapper && spotlight3D.renderer) {
    const w = speakerWrapper.clientWidth;
    const h = speakerWrapper.clientHeight;
    spotlight3D.camera.aspect = w / h;
    spotlight3D.camera.updateProjectionMatrix();
    spotlight3D.renderer.setSize(w, h);
  }
}

// Placeholder inside Spotlight
function createSpotlightPlaceholder() {
  if (!spotlight3D.scene) return;
  
  if (spotlight3D.cardMesh) {
    spotlight3D.scene.remove(spotlight3D.cardMesh);
  }

  // Creating a blank glowing tech hologram shape
  const geometry = new THREE.OctahedronGeometry(2.5, 0);
  const material = new THREE.MeshPhongMaterial({
    color: 0x00e5ff,
    wireframe: true,
    transparent: true,
    opacity: 0.25,
    emissive: 0x00e5ff,
    emissiveIntensity: 0.3
  });

  spotlight3D.cardMesh = new THREE.Mesh(geometry, material);
  spotlight3D.scene.add(spotlight3D.cardMesh);
}

// -----------------------------------------------------------------------------
// 3. PERS-CARDS DECK BUILDER & RECONCILIATION
// -----------------------------------------------------------------------------

function update3DDeck(players, myId) {
  if (!deck3D.scene) return;

  // If a card is currently being inspected, DO NOT destroy and rebuild the hand!
  // This prevents the active inspected card from disappearing during timer sync updates!
  if (deck3D.inspectedCard !== null) {
    return;
  }

  // Self-Healing Resize Check: fixes the 0x0 initial canvas rendering bug instantly!
  const deckWrapper = document.querySelector(".my-3d-deck-wrapper");
  if (deckWrapper && (deck3D.width === 0 || deck3D.height === 0 || deck3D.width !== deckWrapper.clientWidth || deck3D.height !== deckWrapper.clientHeight)) {
    if (deckWrapper.clientWidth > 0 && deckWrapper.clientHeight > 0) {
      handleResize();
    }
  }

  const myPlayer = players.find(p => p.id === myId);
  if (!myPlayer) return;

  // Rebuild the 3D deck ONLY when the player's cards, revealed status or alive status have actually changed!
  // This prevents cards from resetting on mouse hover and disappearing during periodic timer ticks.
  const currentDeckStateStr = JSON.stringify({
    cards: myPlayer.cards,
    revealed: myPlayer.revealed,
    isAlive: myPlayer.isAlive
  });

  if (deck3D.lastDeckStateStr === currentDeckStateStr && deck3D.scene.children.length > 2) {
    return; // No changes to the local deck, skip rebuild!
  }

  deck3D.lastDeckStateStr = currentDeckStateStr;

  const cardCategories = ["profession", "health", "biology", "hobby", "phobia", "baggage", "addInfo", "quality"];
  
  // Clear old meshes
  deck3D.cards.forEach(cardObj => {
    deck3D.scene.remove(cardObj.mesh);
    cardObj.mesh.geometry.dispose();
    cardObj.mesh.material.forEach(mat => {
      if (mat.map) mat.map.dispose();
      mat.dispose();
    });
  });
  deck3D.cards = [];

  const totalCards = cardCategories.length;
  
  // Curved layout math along an arc: perfectly tailored for the container-free full viewport to avoid clashing overlap!
  const arcRadius = 8.5;
  const angleStep = 0.08; // Tight, compact fanning so they are wowed by the deck!

  cardCategories.forEach((cat, idx) => {
    const val = myPlayer.cards[cat] || "Скрытая характеристика";
    const isRev = myPlayer.revealed[cat] || false;
    const color = CATEGORY_INFO[cat]?.color || "#ffffff";

    // Create Canvas textures (passing reveal status to display public outline/lock badges)
    const frontCanvas = drawCardFace(cat, val, true, color, isRev);
    const backCanvas = drawCardFace(cat, val, false, color, isRev);

    const frontTex = new THREE.CanvasTexture(frontCanvas);
    const backTex = new THREE.CanvasTexture(backCanvas);

    // Highly refined smaller playing card sizes for perfect non-clashing visual representation (width = 1.2, height = 1.9)
    const geom = new THREE.BoxGeometry(1.2, 1.9, 0.04);
    
    // Materials for 6 faces: Right, Left, Top, Bottom, Front (index 4), Back (index 5)
    const sidesMat = new THREE.MeshStandardMaterial({ color: 0x101424, roughness: 0.8 });
    const materials = [
      sidesMat, sidesMat, sidesMat, sidesMat,
      new THREE.MeshPhongMaterial({ map: frontTex, transparent: true }), // Front Face
      new THREE.MeshPhongMaterial({ map: backTex, transparent: true })  // Back Face
    ];

    const mesh = new THREE.Mesh(geom, materials);
    
    // Left to right fanning order along the arc
    const angle = Math.PI / 2 - (idx - (totalCards - 1) / 2) * angleStep;
    const x = Math.cos(angle) * arcRadius;
    const y = Math.sin(angle) * arcRadius - arcRadius - 2.80; // Anchor fanning beautifully to sit aligned with bottom edge of viewport
    const z = 0.5 + idx * 0.08; // Beautiful sequential left-to-right fanning layering depth

    mesh.position.set(x, y, z);
    
    // Tilting cards to face the center/camera along the arc
    mesh.rotation.y = (angle - Math.PI / 2) * -0.2;
    mesh.rotation.x = -0.1; // Elegant slight tilt backwards
    mesh.rotation.z = angle - Math.PI / 2; // Perfect curve/arc rotation

    // Save defaults
    const defaultPos = mesh.position.clone();
    const defaultRot = mesh.rotation.clone();

    // Attach card information to the mesh userData
    mesh.userData = {
      category: cat,
      text: val,
      isRevealed: isRev,
      color: color,
      index: idx
    };

    deck3D.scene.add(mesh);
    
    deck3D.cards.push({
      mesh: mesh,
      category: cat,
      text: val,
      isRevealed: isRev,
      color: color,
      defaultPos: defaultPos,
      defaultRot: defaultRot
    });
  });
}

// -----------------------------------------------------------------------------
// 4. SPOTLIGHT SPEAKER CARD BUILDER & ROTATION
// -----------------------------------------------------------------------------

function update3DSpotlight(activeSpeakerId, players, currentRound, activeSpeakerCardType) {
  if (!spotlight3D.scene) return;

  // Self-Healing Resize Check: fixes 0x0 canvas sizes immediately when active speaker starts!
  const speakerWrapper = document.querySelector(".speaker-3d-card-wrapper");
  if (speakerWrapper && spotlight3D.renderer && (speakerWrapper.clientWidth !== spotlight3D.renderer.domElement.clientWidth || speakerWrapper.clientHeight !== spotlight3D.renderer.domElement.clientHeight)) {
    if (speakerWrapper.clientWidth > 0 && speakerWrapper.clientHeight > 0) {
      handleResize();
    }
  }

  // Use the active speaker's chosen card type or fallback to the current round type
  const roundCardType = activeSpeakerCardType || getRoundCardType(currentRound);

  const speaker = players.find(p => p.id === activeSpeakerId);
  
  if (!speaker) {
    if (spotlight3D.currentSpeakerId !== "") {
      spotlight3D.currentSpeakerId = "";
      spotlight3D.currentCardType = "";
      spotlight3D.isRevealed = false;
      createSpotlightPlaceholder();
    }
    return;
  }

  const isRev = speaker.revealed[roundCardType] || false;
  const val = isRev ? speaker.cards[roundCardType] : "[Характеристика скрыта]";
  const color = CATEGORY_INFO[roundCardType]?.color || "#ffffff";

  // Rebuild only if speaker, round, or reveal state changed!
  if (
    spotlight3D.currentSpeakerId === activeSpeakerId &&
    spotlight3D.currentCardType === roundCardType &&
    spotlight3D.isRevealed === isRev
  ) {
    return; // Already up to date
  }

  spotlight3D.currentSpeakerId = activeSpeakerId;
  spotlight3D.currentCardType = roundCardType;
  
  // Clear old mesh
  if (spotlight3D.cardMesh) {
    spotlight3D.scene.remove(spotlight3D.cardMesh);
    if (spotlight3D.cardMesh.geometry) {
      spotlight3D.cardMesh.geometry.dispose();
    }
    if (spotlight3D.cardMesh.material) {
      if (Array.isArray(spotlight3D.cardMesh.material)) {
        spotlight3D.cardMesh.material.forEach(mat => {
          if (mat.map) mat.map.dispose();
          mat.dispose();
        });
      } else {
        if (spotlight3D.cardMesh.material.map) spotlight3D.cardMesh.material.map.dispose();
        spotlight3D.cardMesh.material.dispose();
      }
    }
  }

  // Draw front face and back face (with locks/glowing status synced correctly)
  const frontCanvas = drawCardFace(roundCardType, val, true, color, isRev);
  const backCanvas = drawCardFace(roundCardType, "Скрыто до выбора спикера", false, color, isRev);

  const frontTex = new THREE.CanvasTexture(frontCanvas);
  const backTex = new THREE.CanvasTexture(backCanvas);

  // Scaled up spotlight physical dimensions (width = 2.9, height = 4.4) for crystal clear reading!
  const geom = new THREE.BoxGeometry(2.9, 4.4, 0.05);
  const sidesMat = new THREE.MeshStandardMaterial({ color: 0x12162a, roughness: 0.8 });
  const materials = [
    sidesMat, sidesMat, sidesMat, sidesMat,
    new THREE.MeshPhongMaterial({ map: frontTex, transparent: true }), // Front Face
    new THREE.MeshPhongMaterial({ map: backTex, transparent: true })  // Back Face
  ];

  spotlight3D.cardMesh = new THREE.Mesh(geom, materials);
  
  // Scale it up nicely in center of the canvas viewport
  spotlight3D.cardMesh.position.set(0, 0.2, 0);

  // Set rotation based on reveal status!
  // If not revealed, we display the back face: rotation.y = Math.PI (180 degrees)
  // If revealed, we display the front face: rotation.y = 0
  const targetYRotation = isRev ? 0 : Math.PI;

  if (spotlight3D.isRevealed !== isRev && spotlight3D.isRevealed === false && isRev === true) {
    // Beautiful 3D Flip animation using GSAP!
    spotlight3D.cardMesh.rotation.y = Math.PI; // start face-down
    gsap.to(spotlight3D.cardMesh.rotation, {
      y: 0,
      duration: 1.2,
      ease: "back.out(1.5)",
      overwrite: "auto"
    });
  } else {
    spotlight3D.cardMesh.rotation.y = targetYRotation;
  }

  spotlight3D.isRevealed = isRev;
  spotlight3D.scene.add(spotlight3D.cardMesh);
}

// -----------------------------------------------------------------------------
// 5. INTERACTIVE RAYCASTING (HOVERS & CLICKS)
// -----------------------------------------------------------------------------

function onDeckMouseMove(event) {
  if (!deck3D.scene || deck3D.inspectedCard) return;

  // Only process if the game screen is active and no modal/overlay is open
  const gameScreen = document.getElementById("screen-game");
  if (!gameScreen || !gameScreen.classList.contains("active")) return;
  const inspectOverlay = document.getElementById("card-inspection-overlay");
  if (inspectOverlay && !inspectOverlay.classList.contains("hidden")) return;
  const apocalypseOverlay = document.getElementById("apocalypse-overlay");
  if (apocalypseOverlay && !apocalypseOverlay.classList.contains("hidden")) return;

  const rect = deck3D.renderer.domElement.getBoundingClientRect();
  deck3D.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  deck3D.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  deck3D.raycaster.setFromCamera(deck3D.mouse, deck3D.camera);
  const intersects = deck3D.raycaster.intersectObjects(deck3D.scene.children);

  if (intersects.length > 0) {
    let topMesh = intersects[0].object;
    
    if (deck3D.hoveredCard !== topMesh) {
      // Reset previous hovered card
      if (deck3D.hoveredCard) {
        resetCardHover(deck3D.hoveredCard);
      }

      deck3D.hoveredCard = topMesh;
      
      // Animate Hover Entry using GSAP
      gsap.killTweensOf(topMesh.position);
      gsap.killTweensOf(topMesh.rotation);
      
      // Rise up and come closer
      gsap.to(topMesh.position, {
        y: topMesh.position.y + 0.5,
        z: topMesh.position.z + 0.6,
        duration: 0.3,
        ease: "power2.out"
      });

      gsap.to(topMesh.rotation, {
        x: -0.05, // straighter
        duration: 0.3,
        ease: "power2.out"
      });

      // Cursor indicator
      document.body.style.cursor = "pointer";
    }
  } else {
    if (deck3D.hoveredCard) {
      resetCardHover(deck3D.hoveredCard);
      deck3D.hoveredCard = null;
      document.body.style.cursor = "default";
    }
  }
}

function resetCardHover(cardMesh) {
  const cardObj = deck3D.cards.find(c => c.mesh === cardMesh);
  if (cardObj) {
    gsap.killTweensOf(cardMesh.position);
    gsap.killTweensOf(cardMesh.rotation);
    
    gsap.to(cardMesh.position, {
      x: cardObj.defaultPos.x,
      y: cardObj.defaultPos.y,
      z: cardObj.defaultPos.z,
      duration: 0.3,
      ease: "power2.out"
    });

    gsap.to(cardMesh.rotation, {
      x: cardObj.defaultRot.x,
      y: cardObj.defaultRot.y,
      z: cardObj.defaultRot.z,
      duration: 0.3,
      ease: "power2.out"
    });
  }
}

function onDeckMouseClick(event) {
  if (!deck3D.scene) return;

  // Only process if the game screen is active and no modal/overlay is open
  const gameScreen = document.getElementById("screen-game");
  if (!gameScreen || !gameScreen.classList.contains("active")) return;
  const apocalypseOverlay = document.getElementById("apocalypse-overlay");
  if (apocalypseOverlay && !apocalypseOverlay.classList.contains("hidden")) return;

  // Ignore clicks on UI elements like buttons, sidebars, capsule bars
  if (event.target.closest("button") || event.target.closest(".inspected-card-actions") || event.target.closest(".floating-voice-controls") || event.target.closest(".sidebar")) {
    return;
  }

  const rect = deck3D.renderer.domElement.getBoundingClientRect();
  deck3D.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  deck3D.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  deck3D.raycaster.setFromCamera(deck3D.mouse, deck3D.camera);
  const intersects = deck3D.raycaster.intersectObjects(deck3D.scene.children);

  if (deck3D.inspectedCard) {
    // Click-to-Close UX: If clicking outside the currently zoomed card, close the inspection!
    if (intersects.length > 0 && intersects[0].object === deck3D.inspectedCard) {
      return; // Clicking directly on the zoomed card mesh does nothing
    }
    closeCardInspection();
    return;
  }

  // Normal deck clicking
  const inspectOverlay = document.getElementById("card-inspection-overlay");
  if (inspectOverlay && !inspectOverlay.classList.contains("hidden")) return;

  if (intersects.length > 0) {
    const clickedMesh = intersects[0].object;
    inspectCard(clickedMesh);
  }
}

// Bring Card to Face (Zoom inspect directly in 3D center floating space!)
function inspectCard(cardMesh) {
  deck3D.inspectedCard = cardMesh;
  document.body.style.cursor = "default";

  // Hide hovered state triggers
  deck3D.hoveredCard = null;

  // Rise the canvas z-index to float above blurred glass background
  document.querySelector(".my-3d-deck-wrapper").classList.add("inspecting");

  // Zoom-to-face animations using GSAP
  gsap.killTweensOf(cardMesh.position);
  gsap.killTweensOf(cardMesh.rotation);
  gsap.killTweensOf(cardMesh.scale);

  // Animate card to beautiful center floating position and keep scale at 1.0 to fit perfectly within the viewport bounds
  gsap.to(cardMesh.position, {
    x: 0,
    y: 0.5,
    z: 4.5, // Perfect distance (Z = 4.5) to keep bottom actions bar fully visible
    duration: 0.6,
    ease: "power3.out"
  });

  gsap.to(cardMesh.scale, {
    x: 1.0, // Elegant native 1x scale to avoid covering overlay buttons
    y: 1.0,
    z: 1.0,
    duration: 0.6,
    ease: "power3.out"
  });

  gsap.to(cardMesh.rotation, {
    x: 0,
    y: 0, // Face camera perfectly
    z: 0,
    duration: 0.6,
    ease: "power3.out"
  });

  // Display capsule HTML Actions overlay
  setTimeout(() => {
    const overlay = document.getElementById("card-inspection-overlay");
    const revealBtn = document.getElementById("btn-inspect-reveal");

    const cat = cardMesh.userData.category;
    const isRev = cardMesh.userData.isRevealed;

    const isActiveSpeaker = (window.gameState && window.gameState.activeSpeakerId === window.myPeerId);
    const speakerHasRevealed = (window.gameState && window.gameState.speakerHasRevealedThisTurn);

    // Bind and configure button reveal logic
    if (isRev) {
      revealBtn.className = "btn btn-primary btn-large hidden"; // Hide reveal if already open
    } else if (!isActiveSpeaker) {
      // Rule 4: Disable reveal button if it is not your active speaking turn
      revealBtn.className = "btn btn-secondary btn-large disabled";
      revealBtn.innerHTML = `<i class="fa-solid fa-lock"></i> Не ваш ход`;
      revealBtn.onclick = null;
      revealBtn.style.opacity = "0.5";
      revealBtn.style.cursor = "not-allowed";
      revealBtn.setAttribute("disabled", "true");
    } else if (speakerHasRevealed) {
      // Rule 3: Disable reveal button if speaking turn card opening limit is exceeded
      revealBtn.className = "btn btn-secondary btn-large disabled";
      revealBtn.innerHTML = `<i class="fa-solid fa-ban"></i> Лимит превышен`;
      revealBtn.onclick = null;
      revealBtn.style.opacity = "0.5";
      revealBtn.style.cursor = "not-allowed";
      revealBtn.setAttribute("disabled", "true");
    } else {
      revealBtn.className = "btn btn-primary btn-large";
      revealBtn.innerHTML = `<i class="fa-solid fa-eye"></i> Раскрыть всем игрокам`;
      revealBtn.style.opacity = "1.0";
      revealBtn.style.cursor = "pointer";
      revealBtn.removeAttribute("disabled");
      revealBtn.onclick = () => {
        if (window.revealMyCard) {
          window.revealMyCard(cat);
        }
        closeCardInspection();
      };
    }

    overlay.className = "card-inspection-overlay";
  }, 150);
}

function closeCardInspection() {
  const cardMesh = deck3D.inspectedCard;
  if (!cardMesh) return;

  deck3D.inspectedCard = null; // Reset immediately to prevent interface lockups on state syncs

  // Restore fanning canvas z-index back to behind sidebars
  document.querySelector(".my-3d-deck-wrapper").classList.remove("inspecting");

  const overlay = document.getElementById("card-inspection-overlay");
  overlay.className = "card-inspection-overlay hidden";

  const revealBtn = document.getElementById("btn-inspect-reveal");
  if (revealBtn) {
    revealBtn.removeAttribute("disabled");
    revealBtn.style.opacity = "";
    revealBtn.style.cursor = "";
  }

  const cardObj = deck3D.cards.find(c => c.mesh === cardMesh);
  if (cardObj) {
    // Return card mesh smoothly to its default position, rotation, and scale in fanned arc
    gsap.killTweensOf(cardMesh.position);
    gsap.killTweensOf(cardMesh.rotation);
    gsap.killTweensOf(cardMesh.scale);

    gsap.to(cardMesh.position, {
      x: cardObj.defaultPos.x,
      y: cardObj.defaultPos.y,
      z: cardObj.defaultPos.z,
      duration: 0.6,
      ease: "power2.out"
    });

    gsap.to(cardMesh.scale, {
      x: 1.0, // Restore default 1x scale
      y: 1.0,
      z: 1.0,
      duration: 0.6,
      ease: "power2.out"
    });

    gsap.to(cardMesh.rotation, {
      x: cardObj.defaultRot.x,
      y: cardObj.defaultRot.y,
      z: cardObj.defaultRot.z,
      duration: 0.6,
      ease: "power2.out"
    });
  }
}

// -----------------------------------------------------------------------------
// 6. ANIMATION LOOPS
// -----------------------------------------------------------------------------

function animate() {
  requestAnimationFrame(animate);

  // A. Local Deck Anim Loop
  if (deck3D.scene && deck3D.renderer) {
    deck3D.renderer.render(deck3D.scene, deck3D.camera);
  }

  // B. Spotlight Speaker Anim Loop
  if (spotlight3D.scene && spotlight3D.renderer) {
    if (spotlight3D.cardMesh) {
      // Gentle floating/rotating micro-animation for active card!
      // This makes the center stage feel premium and extremely alive
      const time = Date.now() * 0.001;
      
      if (spotlight3D.currentSpeakerId === "") {
        // Hologram placeholder spins faster
        spotlight3D.cardMesh.rotation.y += 0.01;
        spotlight3D.cardMesh.rotation.x = Math.sin(time) * 0.2;
      } else {
        // The real speaker card has gentle bobbing and subtle tilt, centered inside the speaker canvas
        spotlight3D.cardMesh.position.y = 0.2 + Math.sin(time * 1.5) * 0.12;
        
        // Gentle Y rotation oscillation to catch neon reflections
        // Offset by initial rotation (0 if revealed, Math.PI if backcover)
        const rotOffset = spotlight3D.isRevealed ? 0 : Math.PI;
        spotlight3D.cardMesh.rotation.y = rotOffset + Math.sin(time * 0.7) * 0.08;
        spotlight3D.cardMesh.rotation.x = Math.cos(time * 0.8) * 0.04;
      }
    }
    
    spotlight3D.renderer.render(spotlight3D.scene, spotlight3D.camera);
  }
}

// Bind to window to allow access from game.js
window.init3D = init3D;
window.update3DDeck = update3DDeck;
window.update3DSpotlight = update3DSpotlight;
window.closeCardInspection = closeCardInspection;
