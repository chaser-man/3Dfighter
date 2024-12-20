// Import Three.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Three.js setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Add fog to the scene (near the start, after scene creation)
scene.fog = new THREE.Fog(0x000000, 20, 50);

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
  firstPerson: {
    position: new THREE.Vector3(0, 0.5, 0),
    rotation: new THREE.Euler(0, Math.PI, 0),
    lookAt: null,
    offset: new THREE.Vector3(0, 0.8, 0),
    followPlayer: true
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
    this.cockpitMaterial = new THREE.MeshPhongMaterial({
      color: 0x88ccff,
      specular: 0xffffff,
      shininess: 100,
      transparent: true,
      opacity: 1
    });
    const cockpit = new THREE.Mesh(cockpitGeometry, this.cockpitMaterial);
    cockpit.position.set(0, 0.5, 0);
    this.mesh.add(cockpit);
    this.cockpit = cockpit;

    // Initial position and rotation
    this.mesh.position.set(0, 0, 10);
    this.mesh.rotation.x = 0;

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

    // Update cockpit transparency in first-person view
    if (currentView === 'firstPerson') {
      this.cockpitMaterial.opacity = 0;
    } else {
      this.cockpitMaterial.opacity = 1;
    }
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
      case '6': // Add key for first-person view
        transitionCamera('firstPerson');
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
    // Create more detailed base geometry
    const geometry = new THREE.IcosahedronGeometry(size, 2); // Increased detail level
    
    // Create more varied surface
    const positions = geometry.attributes.position.array;
    const noise = new SimplexNoise(); // Now using global SimplexNoise from CDN
    
    for (let i = 0; i < positions.length; i += 3) {
      const vertex = new THREE.Vector3(
        positions[i],
        positions[i + 1],
        positions[i + 2]
      );
      
      // Add noise-based displacement
      const noiseValue = noise.noise3D(
        vertex.x * 0.5,
        vertex.y * 0.5,
        vertex.z * 0.5
      );
      
      vertex.multiplyScalar(1 + noiseValue * 0.3);
      
      positions[i] = vertex.x;
      positions[i + 1] = vertex.y;
      positions[i + 2] = vertex.z;
    }
    
    geometry.computeVertexNormals();

    // Create more realistic material
    const material = new THREE.MeshStandardMaterial({
      color: 0x808080,
      roughness: 0.9,
      metalness: 0.1,
      flatShading: true,
      vertexColors: true // Enable vertex colors
    });

    // Add vertex colors for visual variety
    const colors = [];
    const color = new THREE.Color();
    
    for (let i = 0; i < positions.length; i += 3) {
      // Vary the color slightly for each vertex
      const shade = 0.5 + Math.random() * 0.3;
      color.setRGB(shade, shade, shade);
      colors.push(color.r, color.g, color.b);
    }
    
    geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(colors, 3)
    );

    // Create main mesh
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(x, y, z);
    
    // Add ambient occlusion to crevices
    const aoMap = this.generateAOTexture(geometry);
    material.aoMap = aoMap;
    material.aoMapIntensity = 1.0;

    // Add detail features
    this.addSurfaceDetails(size);
    
    scene.add(this.mesh);

    // Create hitbox (unchanged)
    const hitboxGeometry = new THREE.SphereGeometry(size * 0.8);
    const hitboxMaterial = new THREE.MeshBasicMaterial({
      visible: debug,
      wireframe: true,
      color: 0xff0000
    });
    this.hitbox = new THREE.Mesh(hitboxGeometry, hitboxMaterial);
    this.hitbox.position.copy(this.mesh.position);
    scene.add(this.hitbox);

    // Store properties
    this.size = size;
    this.speed = speed;
    this.rotationSpeed = rotationSpeed;
    this.rotationAxis = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5
    ).normalize();

    // Store original size for scaling calculations
    this.originalSize = size;
    this.baseScale = new THREE.Vector3(1, 1, 1);
  }

  addSurfaceDetails(size) {
    this.addCraters(size);
    this.addRocks(size);
    this.addCracks(size);
    this.addRidges(size);
    this.addDust(size);
  }

  addCraters(size) {
    const numCraters = Math.floor(Math.random() * 8) + 5;
    for (let i = 0; i < numCraters; i++) {
      const craterSize = size * (Math.random() * 0.4 + 0.1);
      
      // Create crater using a modified sphere geometry
      const craterGeometry = new THREE.SphereGeometry(
        craterSize,
        16,
        16,
        0,
        Math.PI * 2,
        0,
        Math.PI / 2
      );
      const craterMaterial = new THREE.MeshStandardMaterial({
        color: 0x404040,
        roughness: 0.9,
        metalness: 0.1,
        flatShading: true,
        side: THREE.DoubleSide
      });
      
      const crater = new THREE.Mesh(craterGeometry, craterMaterial);
      
      // Position crater
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      crater.position.setFromSpherical(new THREE.Spherical(size * 1.01, phi, theta));
      crater.lookAt(this.mesh.position);
      
      // Add debris inside crater
      for (let j = 0; j < 5; j++) {
        const debris = this.createDebris(craterSize * 0.1);
        debris.position.copy(crater.position);
        debris.position.x += (Math.random() - 0.5) * craterSize * 0.8;
        debris.position.y += (Math.random() - 0.5) * craterSize * 0.8;
        debris.position.z += Math.random() * craterSize * 0.1;
        debris.lookAt(this.mesh.position);
        this.mesh.add(debris);
      }
      
      this.mesh.add(crater);
    }
  }

  addRocks(size) {
    const numRocks = Math.floor(Math.random() * 15) + 10; // More rocks
    for (let i = 0; i < numRocks; i++) {
      const rockSize = size * (Math.random() * 0.15 + 0.05);
      const rock = this.createRock(rockSize);
      
      // Better distribution of rocks
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      rock.position.setFromSpherical(new THREE.Spherical(size * 1.02, phi, theta));
      
      rock.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );
      
      this.mesh.add(rock);
    }
  }

  createRock(size) {
    // Create more detailed rocks
    const geometry = new THREE.DodecahedronGeometry(size, 1);
    
    // Distort vertices for more natural look
    const positions = geometry.attributes.position.array;
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] *= 0.8 + Math.random() * 0.4;
      positions[i + 1] *= 0.8 + Math.random() * 0.4;
      positions[i + 2] *= 0.8 + Math.random() * 0.4;
    }
    
    geometry.computeVertexNormals();
    
    const material = new THREE.MeshStandardMaterial({
      color: 0x606060,
      roughness: 0.9,
      metalness: 0.1,
      flatShading: true
    });
    
    return new THREE.Mesh(geometry, material);
  }

  createDebris(size) {
    const geometry = new THREE.TetrahedronGeometry(size);
    const material = new THREE.MeshStandardMaterial({
      color: 0x505050,
      roughness: 1,
      metalness: 0,
      flatShading: true
    });
    return new THREE.Mesh(geometry, material);
  }

  addCracks(size) {
    const numCracks = Math.floor(Math.random() * 5) + 3;
    for (let i = 0; i < numCracks; i++) {
      const points = [];
      const length = size * (Math.random() * 0.5 + 0.5);
      const segments = 10;
      
      // Create jagged line for crack
      for (let j = 0; j < segments; j++) {
        const t = j / (segments - 1);
        points.push(new THREE.Vector3(
          (Math.random() - 0.5) * 0.2 * length,
          t * length,
          (Math.random() - 0.5) * 0.2 * length
        ));
      }
      
      const crackGeometry = new THREE.BufferGeometry().setFromPoints(points);
      const crackMaterial = new THREE.LineBasicMaterial({ 
        color: 0x202020,
        linewidth: 2
      });
      
      const crack = new THREE.Line(crackGeometry, crackMaterial);
      
      // Position crack
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      crack.position.setFromSpherical(new THREE.Spherical(size * 1.01, phi, theta));
      crack.lookAt(this.mesh.position);
      
      this.mesh.add(crack);
    }
  }

  addRidges(size) {
    const numMountains = Math.floor(Math.random() * 3) + 2;
    for (let i = 0; i < numMountains; i++) {
      // Create mountain using cone geometry
      const height = size * (Math.random() * 0.4 + 0.2);
      const radius = size * (Math.random() * 0.3 + 0.1);
      const mountainGeometry = new THREE.ConeGeometry(
        radius,
        height,
        8,
        1,
        true
      );
      
      // Distort vertices for more natural look
      const positions = mountainGeometry.attributes.position.array;
      for (let j = 0; j < positions.length; j += 3) {
        const distortion = (Math.random() - 0.5) * 0.2;
        positions[j] *= 1 + distortion;
        positions[j + 1] *= 1 + Math.abs(distortion);
        positions[j + 2] *= 1 + distortion;
      }
      mountainGeometry.computeVertexNormals();
      
      const mountainMaterial = new THREE.MeshStandardMaterial({
        color: 0x606060,
        roughness: 0.9,
        metalness: 0.1,
        flatShading: true
      });
      
      const mountain = new THREE.Mesh(mountainGeometry, mountainMaterial);
      
      // Position mountain
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      mountain.position.setFromSpherical(new THREE.Spherical(size * 1.01, phi, theta));
      mountain.lookAt(this.mesh.position);
      
      // Random rotation around normal
      mountain.rotateOnAxis(
        new THREE.Vector3().subVectors(mountain.position, this.mesh.position).normalize(),
        Math.random() * Math.PI * 2
      );
      
      // Add some rocks around the base
      const numRocks = Math.floor(Math.random() * 5) + 3;
      for (let j = 0; j < numRocks; j++) {
        const rock = this.createRock(radius * 0.2);
        rock.position.copy(mountain.position);
        rock.position.x += (Math.random() - 0.5) * radius;
        rock.position.y += (Math.random() - 0.5) * radius;
        rock.position.z += Math.random() * radius * 0.1;
        rock.lookAt(this.mesh.position);
        this.mesh.add(rock);
      }
      
      this.mesh.add(mountain);
    }
  }

  addDust(size) {
    // Add dust particle system
    const particleCount = 50;
    const particles = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    
    for (let i = 0; i < particleCount * 3; i += 3) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const radius = size * (1 + Math.random() * 0.1);
      
      positions[i] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i + 2] = radius * Math.cos(phi);
    }
    
    particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    const dustMaterial = new THREE.PointsMaterial({
      color: 0x808080,
      size: size * 0.05,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending
    });
    
    const dustCloud = new THREE.Points(particles, dustMaterial);
    this.mesh.add(dustCloud);
  }

  generateAOTexture(geometry) {
    // Create a simple ambient occlusion texture
    const textureSize = 512;
    const canvas = document.createElement('canvas');
    canvas.width = textureSize;
    canvas.height = textureSize;
    const ctx = canvas.getContext('2d');
    
    // Generate AO based on geometry normals
    // This is a simplified version - could be more sophisticated
    const positions = geometry.attributes.position.array;
    const normals = geometry.attributes.normal.array;
    
    for (let i = 0; i < positions.length; i += 3) {
      const normal = new THREE.Vector3(
        normals[i],
        normals[i + 1],
        normals[i + 2]
      );
      
      // Darker in crevices (where normal faces inward more)
      const ao = Math.pow(0.5 + normal.y * 0.5, 0.5);
      
      ctx.fillStyle = `rgb(${ao * 255},${ao * 255},${ao * 255})`;
      ctx.fillRect(
        (i / 3) % textureSize,
        Math.floor((i / 3) / textureSize),
        1,
        1
      );
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  update() {
    if (currentView === 'firstPerson') {
      // Move towards player in first-person view
      this.mesh.position.z += this.direction.z * this.speed;
    } else {
      // Original movement for other views
      this.mesh.position.z += this.direction.z * this.speed;
    }
    
    // Calculate distance-based scaling
    const distanceToCamera = this.mesh.position.distanceTo(camera.position);
    const maxDistance = 50; // Distance where asteroid is smallest
    const minDistance = 5;  // Distance where asteroid is largest
    
    // Calculate scale factor based on distance
    const scale = THREE.MathUtils.lerp(
      1.5,  // Max scale when closest
      0.5,  // Min scale when farthest
      THREE.MathUtils.smoothstep(distanceToCamera, minDistance, maxDistance)
    );

    // Apply scale to both mesh and hitbox
    this.mesh.scale.copy(this.baseScale).multiplyScalar(scale);
    this.hitbox.scale.copy(this.baseScale).multiplyScalar(scale * 0.8); // Keep hitbox slightly smaller
    
    // Update hitbox position
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
  const spawnHeight = 20;
  
  const x = (Math.random() - 0.5) * spawnWidth;
  const y = (Math.random() - 0.5) * spawnHeight;
  const z = -horizonDistance;
  
  const size = Math.random() * (2 - 1) + 1;
  
  // Direction is always toward player
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

  // Update camera position for special views
  if (!deathAnimation && !isTransitioningCamera) {
    if (currentView === 'chase') {
      const targetPosition = player.mesh.position.clone();
      targetPosition.z += 25;
      targetPosition.y += 5;
      
      camera.position.lerp(targetPosition, 0.1);
      camera.lookAt(player.mesh.position);
    } else if (currentView === 'firstPerson') {
      // Update camera position to be slightly above player
      camera.position.copy(player.mesh.position);
      camera.position.y += 0.8; // Camera height
      
      // Look forward
      camera.rotation.set(0, Math.PI, 0);
      
      // Add slight tilt based on player movement
      camera.rotation.z = player.mesh.rotation.z * 0.5;
    } else {
      const view = cameraViews[currentView];
      if (view.lookAt) {
        camera.lookAt(view.lookAt);
      }
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
    viewLabel.textContent = `View: ${currentView} (Press 1-6 to change)`;
  }

  // Update label when view changes
  const originalTransition = transitionCamera;
  transitionCamera = function(newView) {
    originalTransition(newView);
    updateViewLabel();
  };

  updateViewLabel();
}

function createCoordinateGrid() {
  // Create main grid with more visible colors
  const gridSize = 200;
  const divisions = 40; // More divisions for better detail
  const mainColor = 0x444444; // Brighter main lines
  const secondaryColor = 0x222222; // Brighter secondary lines
  const gridHelper = new THREE.GridHelper(gridSize, divisions, mainColor, secondaryColor);
  gridHelper.position.y = -5; // Move grid closer to action
  
  // Adjust grid transparency
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = 0.3; // Increased opacity
  
  // Add distance-based fade
  gridHelper.material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'gl_FragColor = vec4( color, diffuseColor.a );',
      `
      float dist = length(vViewPosition);
      float fadeStart = 10.0; // Start fading closer
      float fadeEnd = 80.0;  // Fade out further
      float fade = 1.0 - smoothstep(fadeStart, fadeEnd, dist);
      gl_FragColor = vec4( color, diffuseColor.a * fade * 0.3);
      `
    );
  };

  scene.add(gridHelper);

  // Add more visible depth lines
  const lineMaterial = new THREE.LineBasicMaterial({
    color: mainColor,
    transparent: true,
    opacity: 0.25
  });

  // Create depth lines with smaller spacing
  const depthLineGeometry = new THREE.BufferGeometry();
  const depthLinePositions = [];
  const spacing = gridSize / divisions;
  
  // Add more frequent depth lines
  for (let i = -divisions/2; i <= divisions/2; i += 1) {
    depthLinePositions.push(
      i * spacing, -5, -gridSize/2, // Start higher
      i * spacing, -5, gridSize/2
    );
  }

  depthLineGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(depthLinePositions, 3)
  );
  
  const depthLines = new THREE.LineSegments(depthLineGeometry, lineMaterial);
  scene.add(depthLines);
}

