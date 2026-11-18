import * as THREE from "three"

export const court = { width: 14, length: 14, baseline: -7, rimZ: -5.65, rimY: 3.05, arc: 6.1 }
const white = new THREE.MeshBasicMaterial({ color: "#fff2d8" })
const matte = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.72 })

function mesh(parent, geometry, material, x, y, z) {
  const object = new THREE.Mesh(geometry, material)
  object.position.set(x, y, z)
  parent.add(object)
  return object
}

function box(parent, material, x, y, z, w, h, d) {
  return mesh(parent, new THREE.BoxGeometry(w, h, d), material, x, y, z)
}

function tube(parent, material, from, to, radius) {
  const delta = to.clone().sub(from)
  const center = from.clone().addScaledVector(delta, 0.5)
  const object = mesh(parent, new THREE.CylinderGeometry(radius, radius, delta.length(), 8), material, ...center)
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize())
  return object
}

function ring(parent, material, x, y, z, radius, width, start = 0, sweep = Math.PI * 2) {
  const geometry = new THREE.RingGeometry(radius - width / 2, radius + width / 2, 64, 1, start, sweep)
  mesh(parent, geometry, material, x, y, z).rotation.x = -Math.PI / 2
}

export function buildCourt(scene) {
  const { width, length, baseline, rimZ, rimY, arc } = court
  const ground = box(scene, matte("#263c48"), 0, -0.22, 0, 80, 0.25, 80)
  ground.receiveShadow = true
  box(scene, matte("#183d47"), 0, -0.095, 0, 16.3, 0.16, 16.3)
  const boards = ["#bd8550", "#ce9760", "#d4a06b", "#c58d56", "#d8a269"].map(matte)
  for (let row = 0; row < 40; row++) {
    const depth = length / 40
    const offset = row % 2 ? 1 : 0
    for (let x = -7; x < 7;) {
      const end = Math.min(7, x === -7 ? x + 2 - offset : x + 2)
      box(scene, boards[(row * 7 + Math.round(x + 7) * 3) % boards.length],
        (x + end) / 2, -0.025, baseline + (row + 0.5) * depth,
        end - x - 0.012, 0.05, depth - 0.012).receiveShadow = true
      x = end
    }
  }
  const paint = matte("#327984")
  box(scene, paint, 0, 0.005, -4.35, 4.25, 0.01, 5.3).receiveShadow = true
  for (const side of [-1, 1]) {
    box(scene, white, side * 7, 0.018, 0, 0.055, 0.01, length)
    box(scene, white, 0, 0.018, side * 7, width, 0.01, 0.055)
    box(scene, white, side * 2.125, 0.018, -4.35, 0.045, 0.01, 5.3)
    const depth = Math.sqrt(arc ** 2 - 5.96 ** 2) + rimZ
    box(scene, white, side * 5.96, 0.018, (baseline + depth) / 2, 0.052, 0.01, depth - baseline)
  }
  box(scene, white, 0, 0.018, -1.7, 4.25, 0.01, 0.045)
  const cornerAngle = Math.acos(5.96 / arc)
  ring(scene, white, 0, 0.018, rimZ, arc, 0.055, Math.PI + cornerAngle, Math.PI - cornerAngle * 2)
  ring(scene, white, 0, 0.018, -1.7, 1.72, 0.045, Math.PI, Math.PI)
  ring(scene, white, 0, 0.018, 7, 1.55, 0.05, 0, Math.PI)

  const steel = matte("#35525e")
  box(scene, steel, 0, 1.81, -7.65, 0.22, 3.62, 0.22)
  box(scene, steel, 0, 3.51, -6.95, 0.14, 0.14, 1.45)
  box(scene, paint, 0, 0.62, -7.65, 0.43, 1.24, 0.43)
  box(scene, matte("#b1d2d5"), 0, 3.45, -6.06, 1.8, 1.05, 0.07)
  for (const sign of [-1, 1]) {
    box(scene, white, sign * 0.29, 3.26, -6.018, 0.035, 0.44, 0.012)
    box(scene, white, 0, 3.26 + sign * 0.22, -6.018, 0.61, 0.035, 0.012)
  }
  const orange = matte("#f04c20")
  box(scene, orange, 0, rimY, -5.94, 0.12, 0.04, 0.19)
  mesh(scene, new THREE.TorusGeometry(0.245, 0.025, 10, 40), orange, 0, rimY, rimZ).rotation.x = Math.PI / 2
  const net = []
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6
    const top = [0.235 * Math.cos(angle), rimY, rimZ + 0.235 * Math.sin(angle)]
    for (const turn of [-1, 1]) {
      const end = angle + turn * Math.PI / 6
      net.push(...top, 0.15 * Math.cos(end), rimY - 0.37, rimZ + 0.15 * Math.sin(end))
    }
  }
  const netGeometry = new THREE.BufferGeometry()
  netGeometry.setAttribute("position", new THREE.Float32BufferAttribute(net, 3))
  scene.add(new THREE.LineSegments(netGeometry, new THREE.LineBasicMaterial({ color: "#ffffff" })))

  const seat = matte("#36515d")
  for (const side of [-1, 1]) {
    for (let step = 0; step < 4; step++) {
      box(scene, seat, side * (9.2 + step * 0.69), 0.04 + step * 0.26, -0.4, 0.69, 0.34 + step * 0.52, 13)
    }
  }
  scene.add(new THREE.HemisphereLight("#e9f6ff", "#ab7351", 2.35))
  const sun = new THREE.DirectionalLight("#fff0d1", 2.4)
  sun.position.set(-6, 13, 7)
  sun.castShadow = true
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, far: 37 })
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.normalBias = 0.035
  scene.add(sun)
}

export function makePlayer(scene, robot) {
  const root = new THREE.Group()
  const uniform = matte(robot ? "#dd653e" : "#1260ab")
  const shell = matte(robot ? "#33434e" : "#683f30")
  const shoes = matte(robot ? "#192b36" : "#ecf4fc")
  const tag = new THREE.MeshBasicMaterial({ color: robot ? "#fa9865" : "#75d7ff", side: THREE.DoubleSide })
  const body = mesh(root, new THREE.CapsuleGeometry(0.265, 0.38, 5, 12), uniform, 0, 1.15, 0)
  body.scale.z = 0.72
  if (robot) {
    box(root, shell, 0, 1.72, 0, 0.42, 0.33, 0.34)
    box(root, tag, 0, 1.75, 0.177, 0.3, 0.062, 0.013)
  } else {
    mesh(root, new THREE.SphereGeometry(0.205, 16, 12), shell, 0, 1.72, 0)
    mesh(root, new THREE.SphereGeometry(0.209, 16, 10, 0, Math.PI * 2, 0, 1.2), shoes, 0, 1.73, 0)
    box(root, shoes, 0, 1.25, -0.196, 0.1, 0.19, 0.012)
  }
  const arms = []
  const legs = []
  const hands = []
  for (const side of [-1, 1]) {
    const arm = new THREE.Group()
    arm.position.set(side * 0.285, 1.34, 0)
    root.add(arm)
    tube(arm, shell, new THREE.Vector3(), new THREE.Vector3(side * 0.11, -0.46, 0.055), 0.078)
    mesh(arm, new THREE.SphereGeometry(0.09, 10, 8), shell, side * 0.11, -0.46, 0.055)
    arms.push(arm)
    const hand = new THREE.Object3D()
    hand.position.set(side * 0.11, -0.46, 0.055)
    arm.add(hand)
    hands.push(hand)

    const leg = new THREE.Group()
    leg.position.set(side * 0.145, 0.81, 0)
    root.add(leg)
    box(leg, uniform, 0, -0.17, 0, 0.2, 0.39, 0.2)
    box(leg, shell, 0, -0.51, 0, 0.13, 0.34, 0.14)
    box(leg, shoes, 0, -0.745, 0.06, 0.19, 0.13, 0.31)
    legs.push(leg)
  }
  root.traverse((object) => { if (object.isMesh) object.castShadow = true })
  const marker = new THREE.Group()
  ring(marker, tag, 0, 0.033, 0, 0.48, 0.046)
  scene.add(root, marker)
  return { root, marker, arms, legs, hands }
}

export function makeBall(scene) {
  const ball = new THREE.Group()
  mesh(ball, new THREE.SphereGeometry(0.12, 20, 14), matte("#f28526"), 0, 0, 0).castShadow = true
  const seam = matte("#412110")
  for (let i = 0; i < 3; i++) {
    const band = mesh(ball, new THREE.TorusGeometry(0.119, 0.003, 5, 36), seam, 0, 0, 0)
    band.rotation.set(i === 1 ? Math.PI / 2 : 0, i === 2 ? Math.PI / 2 : 0, 0)
  }
  scene.add(ball)
  return ball
}
