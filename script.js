// Import Three.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Three.js setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0x404040);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(1, 1, 1);
scene.add(directionalLight);

// Camera position
camera.position.set(0, 0, 20);
camera.rotation.set(0, 0, 0);
camera.lookAt(0, 0, 0);

// Game state
let score = 0;
let gameOver = false;
let obstacles = [];
let stars = [];
let projectiles = [];
const maxObstacles = 5;
const maxDifficultyScore = 35;

// Debug mode
const debug = false;

// Add these camera-related variables with other game state variables
const cameraViews = {
  default: {
    position: new THREE.Vector3(0, 0, 20),
    rotation: new THREE.Euler(0, 0, 0),
    lookAt: new THREE.Vector3(0, 0, 0)
  },
  side: {
    position: new THREE.Vector3(20, 0, 0),
    rotation: new THREE.Euler(0, -Math.PI/2, 0),
    lookAt: new THREE.Vector3(0, 0, 0)
  },
  top: {
    position: new THREE.Vector3(0, 20, 0),
    rotation: new THREE.Euler(-Math.PI/2, 0, 0),
    lookAt: new THREE.Vector3(0, 0, 0)
  },
  chase: {
    position: new THREE.Vector3(0, 5, 25),
    rotation: new THREE.Euler(0, 0, 0),
    lookAt: null // Will follow player
  },
  cinematic: {
    position: new THREE.Vector3(15, 5, 15),
    rotation: new THREE.Euler(-Math.PI/8, Math.PI/4, 0),
    lookAt: new THREE.Vector3(0, 0, 0)
  }
};

let currentView = 'default';
let isTransitioningCamera = false;

// Add this function to handle camera transitions
function transitionCamera(newView) {
  if (isTransitioningCamera || currentView === newView) return;
  
  isTransitioningCamera = true;
  const startPosition = camera.position.clone();
  const targetPosition = cameraViews[newView].position.clone();
  const startRotation = camera.rotation.clone();
  const targetRotation = cameraViews[newView].rotation.clone();
  
  let progress = 0;
  
  function animateTransition() {
    progress += 0.02;
    const t = THREE.MathUtils.smoothstep(progress, 0, 1);
    
    camera.position.lerpVectors(startPosition, targetPosition, t);
    
    // Interpolate rotation
    camera.rotation.x = THREE.MathUtils.lerp(startRotation.x, targetRotation.x, t);
    camera.rotation.y = THREE.MathUtils.lerp(startRotation.y, targetRotation.y, t);
    camera.rotation.z = THREE.MathUtils.lerp(startRotation.z, targetRotation.z, t);
    
    if (progress < 1) {
      requestAnimationFrame(animateTransition);
    } else {
      isTransitioningCamera = false;
      currentView = newView;
    }
  }
  
  animateTransition();
}

// Handle window resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Add this before creating the player instance
class Player3D {
  constructor() {
    // Create rocket body geometry
    const bodyGeometry = new THREE.CylinderGeometry(0.5, 1, 4, 8);
    const bodyMaterial = new THREE.MeshPhongMaterial({
      color: 0xcccccc,
      specular: 0x666666,
      shininess: 30
    });
    this.mesh = new THREE.Group(); // Use Group to hold all rocket parts
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    this.mesh.add(body);

    // Add fins
    const finGeometry = new THREE.BoxGeometry(2, 0.2, 1);
    const finMaterial = new THREE.MeshPhongMaterial({ color: 0xff4000 });
    
    this.leftFin = new THREE.Mesh(finGeometry, finMaterial);
    this.rightFin = new THREE.Mesh(finGeometry, finMaterial);
    
    this.leftFin.position.set(-1, -1, 0);
    this.rightFin.position.set(1, -1, 0);
    
    this.mesh.add(this.leftFin);
    this.mesh.add(this.rightFin);

    // Add engine glow
    const engineLight = new THREE.PointLight(0xff6600, 1, 5);
    engineLight.position.set(0, -2, 0);
    this.mesh.add(engineLight);

    // Add cockpit (window)
    const cockpitGeometry = new THREE.SphereGeometry(0.5, 16, 16);
    const cockpitMaterial = new THREE.MeshPhongMaterial({
      color: 0x88ccff,
      specular: 0xffffff,
      shininess: 100
    });
    const cockpit = new THREE.Mesh(cockpitGeometry, cockpitMaterial);
    cockpit.position.set(0, 0.5, 0);
    this.mesh.add(cockpit);

    // Initial position and rotation
    this.mesh.position.set(0, 5, 0);
    this.mesh.rotation.x = -Math.PI / 2; // Rotate to point forward (along negative Z)

    // Add to scene
    scene.add(this.mesh);

    // Movement properties
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.speed = 0.2;
    this.shield = false;
    this.rapidFire = false;

    // Remove fixed bounds and add frustum for view checking
    this.frustum = new THREE.Frustum();
    this.cameraViewProjectionMatrix = new THREE.Matrix4();
  }

  update() {
    // Update position based on velocity
    this.mesh.position.add(this.velocity);
    
    // Update frustum for boundary checking
    this.cameraViewProjectionMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    this.frustum.setFromProjectionMatrix(this.cameraViewProjectionMatrix);

    // Create a point slightly inside the edges of the ship for checking
    const margin = 1; // Adjust this value to control how close to the edge the ship can get
    const testPoints = [
      new THREE.Vector3(
        this.mesh.position.x + this.mesh.scale.x * margin,
        this.mesh.position.y,
        this.mesh.position.z
      ),
      new THREE.Vector3(
        this.mesh.position.x - this.mesh.scale.x * margin,
        this.mesh.position.y,
        this.mesh.position.z
      ),
      new THREE.Vector3(
        this.mesh.position.x,
        this.mesh.position.y + this.mesh.scale.y * margin,
        this.mesh.position.z
      ),
      new THREE.Vector3(
        this.mesh.position.x,
        this.mesh.position.y - this.mesh.scale.y * margin,
        this.mesh.position.z
      )
    ];

    // Check if any test point is outside the frustum
    let isOutOfBounds = false;
    for (const point of testPoints) {
      if (!this.frustum.containsPoint(point)) {
        isOutOfBounds = true;
        break;
      }
    }

    // If out of bounds, revert the position update
    if (isOutOfBounds) {
      this.mesh.position.sub(this.velocity);
    }

    // Add slight tilt in movement direction while maintaining forward orientation
    const tiltAmount = 0.2;
    const targetRotationZ = -this.velocity.x * tiltAmount;
    const targetRotationX = -Math.PI / 2 + this.velocity.y * tiltAmount;
    
    this.mesh.rotation.z += (targetRotationZ - this.mesh.rotation.z) * 0.1;
    this.mesh.rotation.x += (targetRotationX - this.mesh.rotation.x) * 0.1;
  }

  shoot() {
    if (this.rapidFire) {
      const projectile = new Projectile3D(
        this.mesh.position.x,
        this.mesh.position.y,
        this.mesh.position.z - 1
      );
      projectiles.push(projectile);
      setTimeout(() => this.shoot(), 100);
    } else {
      const projectile = new Projectile3D(
        this.mesh.position.x,
        this.mesh.position.y,
        this.mesh.position.z - 1
      );
      projectiles.push(projectile);
    }
  }
}

// Also need to define Projectile3D class
class Projectile3D {
  constructor(x, y, z) {
    const geometry = new THREE.SphereGeometry(0.2, 8, 8);
    const material = new THREE.MeshBasicMaterial({ 
      color: 0xff0000,
      emissive: 0xff0000
    });
    
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(x, y, z);
    
    // Add point light to make it glow
    const light = new THREE.PointLight(0xff0000, 1, 2);
    this.mesh.add(light);
    
    scene.add(this.mesh);
    
    this.speed = 0.5;
  }

  update() {
    this.mesh.position.z -= this.speed;
  }

  destroy() {
    while(this.mesh.children.length > 0) { 
      this.mesh.remove(this.mesh.children[0]);
    }
    scene.remove(this.mesh);
  }
}

// Create player instance
const player = new Player3D();

// Setup controls
function setupControls() {
  document.addEventListener('keydown', (e) => {
    switch(e.key) {
      case 'ArrowLeft':
      case 'a':
        player.velocity.x = -player.speed;
        break;
      case 'ArrowRight':
      case 'd':
        player.velocity.x = player.speed;
        break;
      case 'ArrowUp':
      case 'w':
        player.velocity.y = player.speed;
        break;
      case 'ArrowDown':
      case 's':
        player.velocity.y = -player.speed;
        break;
      case ' ':
        player.shoot();
        break;
      case '1':
        transitionCamera('default');
        break;
      case '2':
        transitionCamera('side');
        break;
      case '3':
        transitionCamera('top');
        break;
      case '4':
        transitionCamera('chase');
        break;
      case '5':
        transitionCamera('cinematic');
        break;
    }
  });

  document.addEventListener('keyup', (e) => {
    switch(e.key) {
      case 'ArrowLeft':
      case 'a':
      case 'ArrowRight':
      case 'd':
        player.velocity.x = 0;
        break;
      case 'ArrowUp':
      case 'w':
      case 'ArrowDown':
      case 's':
        player.velocity.y = 0;
        break;
    }
  });
}

// Star class for 3D
class Star3D {
  constructor() {
    const geometry = new THREE.SphereGeometry(0.05, 4, 4);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.Mesh(geometry, material);
    
    this.mesh.position.set(
      (Math.random() - 0.5) * 100,
      (Math.random() - 0.5) * 100,
      (Math.random() - 0.5) * 50
    );
    
    scene.add(this.mesh);
  }

  update() {
    this.mesh.position.y -= 0.1;
    if (this.mesh.position.y < -50) {
      this.mesh.position.y = 50;
      this.mesh.position.x = (Math.random() - 0.5) * 100;
      this.mesh.position.z = (Math.random() - 0.5) * 50;
    }
  }
}

function createStars() {
  stars = [];
  for (let i = 0; i < 200; i++) {
    stars.push(new Star3D());
  }
}

// Add this before the spawnObstacle function
class Obstacle3D {
  constructor(x, y, z, size, speed, rotationSpeed) {
    // Create asteroid geometry with irregular shape
    const geometry = new THREE.IcosahedronGeometry(size, 1);
    
    // Distort vertices for more asteroid-like appearance
    const positions = geometry.attributes.position.array;
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] += (Math.random() - 0.5) * 0.2 * size;
      positions[i + 1] += (Math.random() - 0.5) * 0.2 * size;
      positions[i + 2] += (Math.random() - 0.5) * 0.2 * size;
    }
    geometry.computeVertexNormals(); // Recompute normals after distortion

    // Create asteroid material with rocky texture
    const material = new THREE.MeshStandardMaterial({
      color: 0x808080,
      roughness: 0.9,
      metalness: 0.1,
      flatShading: true
    });

    // Create the main mesh
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(x, y, z);
    scene.add(this.mesh);

    // Create hitbox (slightly smaller than visible mesh)
    const hitboxGeometry = new THREE.SphereGeometry(size * 0.8);
    const hitboxMaterial = new THREE.MeshBasicMaterial({
      visible: debug,
      wireframe: true,
      color: 0xff0000
    });
    this.hitbox = new THREE.Mesh(hitboxGeometry, hitboxMaterial);
    this.hitbox.position.copy(this.mesh.position);
    scene.add(this.hitbox);

    // Add craters
    this.addCraters(size);

    // Store properties
    this.size = size;
    this.speed = speed;
    this.rotationSpeed = rotationSpeed;
    this.rotationAxis = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5
    ).normalize();
    this.direction = new THREE.Vector3(0, 0, 1); // Default direction, will be set by spawnObstacle
  }

  addCraters(size) {
    const numCraters = Math.floor(Math.random() * 5) + 3;
    for (let i = 0; i < numCraters; i++) {
      const craterSize = size * (Math.random() * 0.3 + 0.1);
      const craterGeometry = new THREE.CircleGeometry(craterSize, 16);
      const craterMaterial = new THREE.MeshStandardMaterial({
        color: 0x505050,
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide
      });
      const crater = new THREE.Mesh(craterGeometry, craterMaterial);

      // Position crater on asteroid surface
      crater.position.set(
        (Math.random() - 0.5) * size,
        (Math.random() - 0.5) * size,
        (Math.random() - 0.5) * size
      );
      crater.lookAt(this.mesh.position);
      crater.position.normalize().multiplyScalar(size * 1.01); // Slightly above surface
      
      this.mesh.add(crater);
    }
  }

  update() {
    // Move straight forward, maintaining X position
    this.mesh.position.z += this.direction.z * this.speed;
    this.hitbox.position.copy(this.mesh.position);

    // Rotate around random axis
    this.mesh.rotateOnAxis(this.rotationAxis, this.rotationSpeed);
  }

  destroy() {
    // Create explosion effect
    const particleCount = 20;
    const particles = [];
    
    for (let i = 0; i < particleCount; i++) {
      const geometry = new THREE.SphereGeometry(this.size * 0.1);
      const material = new THREE.MeshBasicMaterial({
        color: 0x808080,
        transparent: true
      });
      
      const particle = new THREE.Mesh(geometry, material);
      particle.position.copy(this.mesh.position);
      
      const velocity = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5
      ).multiplyScalar(0.2);
      
      particles.push({ mesh: particle, velocity });
      scene.add(particle);
    }

    // Animate particles
    const animateParticles = () => {
      particles.forEach(p => {
        p.mesh.position.add(p.velocity);
        p.mesh.material.opacity -= 0.02;
        if (p.mesh.material.opacity <= 0) {
          scene.remove(p.mesh);
        }
      });
      
      if (particles.some(p => p.mesh.material.opacity > 0)) {
        requestAnimationFrame(animateParticles);
      }
    };
    
    animateParticles();

    // Remove asteroid meshes
    scene.remove(this.mesh);
    scene.remove(this.hitbox);
  }
}

// Add collision detection function if not already defined
function checkCollision(object1, object2) {
  const box1 = new THREE.Box3().setFromObject(object1);
  const box2 = new THREE.Box3().setFromObject(object2);
  return box1.intersectsBox(box2);
}

// Spawn obstacle function
function spawnObstacle(cappedScore) {
  const horizonDistance = 50;
  const spawnWidth = 40;
  const spawnHeight = 20; // Height range for spawning
  
  // Calculate spawn position
  const x = (Math.random() - 0.5) * spawnWidth;
  const y = (Math.random() - 0.5) * spawnHeight;
  const z = -horizonDistance;
  
  const size = Math.random() * (3 - 1) + 1;
  
  // Direction is straight forward
  const direction = new THREE.Vector3(0, 0, 1).normalize();
  
  const speed = (0.1 + cappedScore * 0.01) * 2;
  const rotationSpeed = (Math.random() * 0.02 - 0.01) * (1 + cappedScore / 50);

  const obstacle = new Obstacle3D(x, y, z, size, speed, rotationSpeed);
  obstacle.direction = direction;
  obstacles.push(obstacle);
}

// Spawn obstacles function
function spawnObstacles() {
  if (gameOver) return;

  const cappedScore = Math.min(score, maxDifficultyScore);
  const numObstacles = Math.min(1 + Math.floor(cappedScore / 10), maxObstacles);

  for (let i = 0; i < numObstacles; i++) {
    spawnObstacle(cappedScore);
  }

  const spawnDelay = Math.max(300, 1000 - cappedScore * 20);
  setTimeout(spawnObstacles, spawnDelay);
}

// Add this function before gameLoop
function createExplosion(position) {
  // Create particle system for explosion
  const particleCount = 30;
  const particles = [];
  
  // Create explosion flash
  const flashGeometry = new THREE.SphereGeometry(1, 16, 16);
  const flashMaterial = new THREE.MeshBasicMaterial({
    color: 0xff8800,
    transparent: true,
    opacity: 1
  });
  const flash = new THREE.Mesh(flashGeometry, flashMaterial);
  flash.position.copy(position);
  scene.add(flash);

  // Create particles
  for (let i = 0; i < particleCount; i++) {
    const geometry = new THREE.SphereGeometry(0.2, 8, 8);
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(Math.random() * 0.1, 1, 0.5), // Orange-red colors
      transparent: true,
      opacity: 1
    });
    
    const particle = new THREE.Mesh(geometry, material);
    particle.position.copy(position);
    
    // Random velocity in all directions
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2
    ).multiplyScalar(0.5);
    
    particles.push({ mesh: particle, velocity });
    scene.add(particle);
  }

  // Add point light for glow effect
  const light = new THREE.PointLight(0xff5500, 5, 10);
  light.position.copy(position);
  scene.add(light);

  // Animate explosion
  let frame = 0;
  function animateExplosion() {
    frame++;
    
    // Fade out and expand flash
    flash.scale.multiplyScalar(1.1);
    flash.material.opacity -= 0.15;
    
    // Update particles
    particles.forEach(p => {
      p.mesh.position.add(p.velocity);
      p.mesh.material.opacity -= 0.02;
      p.velocity.multiplyScalar(0.98); // Slow down particles
    });

    // Fade out light
    light.intensity *= 0.9;

    // Continue animation until particles fade out
    if (frame < 30) {
      requestAnimationFrame(animateExplosion);
    } else {
      // Clean up
      scene.remove(flash);
      scene.remove(light);
      particles.forEach(p => scene.remove(p.mesh));
    }
  }

  animateExplosion();
}

// Add these variables at the top with other game state variables
let deathAnimation = false;
let deathCamera = null;
let originalCameraPosition = null;
let targetCameraPosition = null;
let cameraAnimationProgress = 0;

// Add this new function to handle death sequence
function startDeathSequence(killerAsteroid) {
  if (deathAnimation) return;
  deathAnimation = true;
  
  // Store original camera position
  originalCameraPosition = camera.position.clone();
  
  // Calculate new camera position for dramatic view
  const offsetDistance = 15;
  const collisionPoint = player.mesh.position.clone();
  
  // Position camera to see both player and asteroid
  targetCameraPosition = new THREE.Vector3(
    collisionPoint.x + offsetDistance,
    collisionPoint.y + offsetDistance/2,
    collisionPoint.z + offsetDistance
  );
  
  // Slow down game physics
  player.velocity.multiplyScalar(0.2);
  killerAsteroid.speed *= 0.2;
  
  // Start death animation
  animateDeathCamera();
}

// Add camera animation function
function animateDeathCamera() {
  if (!deathAnimation) return;
  
  cameraAnimationProgress += 0.02;
  const progress = THREE.MathUtils.smoothstep(cameraAnimationProgress, 0, 1);
  
  // Interpolate camera position
  camera.position.lerpVectors(originalCameraPosition, targetCameraPosition, progress);
  
  // Make camera look at collision point
  camera.lookAt(player.mesh.position);
  
  if (cameraAnimationProgress >= 1) {
    // Animation complete, show game over screen
    showGameOver();
    return;
  }
  
  requestAnimationFrame(animateDeathCamera);
}

// Modify gameLoop to respect death animation
function gameLoop() {
  if (gameOver && !deathAnimation) return;

  // Update camera position for chase view
  if (currentView === 'chase' && !deathAnimation) {
    const targetPosition = player.mesh.position.clone();
    targetPosition.z += 25; // Position camera behind player
    targetPosition.y += 5;  // Slightly above player
    
    camera.position.lerp(targetPosition, 0.1);
    camera.lookAt(player.mesh.position);
  } else if (!deathAnimation && !isTransitioningCamera) {
    // For other views, maintain lookAt point
    const view = cameraViews[currentView];
    if (view.lookAt) {
      camera.lookAt(view.lookAt);
    }
  }

  // Update game objects at normal speed if not in death animation
  if (!deathAnimation) {
    // Update stars
    stars.forEach(star => star.update());

    // Update player
    player.update();

    // Update obstacles
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const obstacle = obstacles[i];
      obstacle.update();

      // Remove if passed player
      if (obstacle.mesh.position.z > 15) {
        obstacle.destroy();
        obstacles.splice(i, 1);
        continue;
      }

      // This is where the collision check should be
      if (checkCollision(player.mesh, obstacle.hitbox)) {
        if (player.shield) {
          createExplosion(obstacle.mesh.position);
          obstacle.destroy();
          obstacles.splice(i, 1);
        } else {
          startDeathSequence(obstacle);
          break; // Exit the loop after starting death sequence
        }
      }
    }

    // Update projectiles
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const projectile = projectiles[i];
      projectile.update();

      let hitObstacle = false;
      for (let j = obstacles.length - 1; j >= 0; j--) {
        const obstacle = obstacles[j];
        if (checkCollision(projectile.mesh, obstacle.hitbox)) {
          createExplosion(obstacle.mesh.position);
          obstacle.destroy();
          obstacles.splice(j, 1);
          hitObstacle = true;
          score++;
          document.getElementById('score').textContent = `Score: ${score}`;
          break;
        }
      }

      if (hitObstacle || projectile.mesh.position.z < -50) {
        projectile.destroy();
        projectiles.splice(i, 1);
      }
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(gameLoop);
}

// Initialize game
function initGame() {
  createStars();
  setupControls();
  spawnObstacles();
  addViewUI();
  gameLoop();
}

// Start the game
initGame();

// Modify showGameOver function
function showGameOver() {
  gameOver = true;
  
  // Wait for death animation to complete
  setTimeout(() => {
    const gameOverDiv = document.createElement('div');
    gameOverDiv.style.position = 'absolute';
    gameOverDiv.style.top = '50%';
    gameOverDiv.style.left = '50%';
    gameOverDiv.style.transform = 'translate(-50%, -50%)';
    gameOverDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    gameOverDiv.style.padding = '20px';
    gameOverDiv.style.borderRadius = '10px';
    gameOverDiv.style.textAlign = 'center';
    gameOverDiv.style.color = 'white';
    gameOverDiv.style.zIndex = '1000';

    gameOverDiv.innerHTML = `
      <h2 style="font-size: 24px; margin-bottom: 10px;">Game Over</h2>
      <p style="font-size: 18px; margin-bottom: 20px;">Your score: ${score}</p>
      <button id="playAgain" style="
        padding: 10px 20px;
        font-size: 16px;
        background-color: #4CAF50;
        color: white;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        transition: background-color 0.3s;
      ">Play Again</button>
    `;

    document.body.appendChild(gameOverDiv);

    const playAgainButton = document.getElementById('playAgain');
    playAgainButton.addEventListener('click', () => {
      location.reload();
    });
  }, 2000); // Wait for death animation to complete
}

// Add reset function for play again
function resetGame() {
  score = 0;
  gameOver = false;
  deathAnimation = false;
  cameraAnimationProgress = 0;
  obstacles = [];
  projectiles = [];
  
  // Reset camera
  camera.position.copy(originalCameraPosition);
  camera.lookAt(0, 0, 0);
  
  // Reset player
  player.mesh.position.set(0, 5, 0);
  player.velocity.set(0, 0, 0);
  
  // Restart game
  initGame();
}

// Add UI to show current view
function addViewUI() {
  const viewLabel = document.createElement('div');
  viewLabel.style.position = 'absolute';
  viewLabel.style.top = '60px';
  viewLabel.style.left = '20px';
  viewLabel.style.color = 'white';
  viewLabel.style.fontFamily = 'Arial';
  viewLabel.style.fontSize = '16px';
  viewLabel.id = 'viewLabel';
  document.body.appendChild(viewLabel);

  function updateViewLabel() {
    viewLabel.textContent = `View: ${currentView} (Press 1-5 to change)`;
  }

  // Update label when view changes
  const originalTransition = transitionCamera;
  transitionCamera = function(newView) {
    originalTransition(newView);
    updateViewLabel();
  };

  updateViewLabel();
}

