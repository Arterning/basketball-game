import * as THREE from "three"
import { createBasketNet } from "./net.js"

export const court = { width: 14, length: 14, baseline: -7, rimZ: -5.65, rimY: 3.05, arc: 6.1, dunkRange: 1.55, dunkBackEdge: 0.14 }
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

  const { dunkRange, dunkBackEdge } = court
  const edgeAngle = Math.asin(dunkBackEdge / dunkRange)
  const start = Math.PI - edgeAngle
  const sweep = Math.PI + 2 * edgeAngle
  const outline = new THREE.MeshBasicMaterial({ color: "#ffbd6e", toneMapped: false })
  const fill = new THREE.MeshBasicMaterial({
    color: "#ff9b42", transparent: true, opacity: 0.27, depthWrite: false,
  })
  const shape = new THREE.Shape()
  shape.absarc(0, 0, dunkRange, start, start + sweep)
  shape.closePath()
  const zone = mesh(scene, new THREE.ShapeGeometry(shape, 40), fill, 0, 0.014, rimZ)
  zone.rotation.x = -Math.PI / 2
  zone.name = "dunk-zone"
  ring(scene, outline, 0, 0.019, rimZ, dunkRange, 0.045, start, sweep)
  const edgeWidth = 2 * Math.sqrt(dunkRange ** 2 - dunkBackEdge ** 2)
  box(scene, outline, 0, 0.019, rimZ - dunkBackEdge, edgeWidth, 0.004, 0.045)

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
  const net = createBasketNet(rimY, rimZ)
  scene.add(net.mesh)

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
  return { net, dunkZone: zone }
}

function joint(parent, x, y, z = 0) {
  const object = new THREE.Group()
  object.position.set(x, y, z)
  parent.add(object)
  return object
}

function oval(parent, material, x, y, z, width, height, depth) {
  const object = mesh(parent, new THREE.SphereGeometry(1, 20, 14), material, x, y, z)
  object.scale.set(width, height, depth)
  return object
}

function profile(parent, material, x, y, z, points, depth) {
  const geometry = new THREE.LatheGeometry(points.map(([radius, height]) => new THREE.Vector2(radius, height)), 24)
  const object = mesh(parent, geometry, material, x, y, z)
  object.scale.z = depth
  return object
}

function jerseyNumber(parent, number) {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 128
  const context = canvas.getContext("2d")
  context.fillStyle = "#fff5db"
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.font = "bold 95px sans-serif"
  context.fillText(number, 64, 66)
  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: 0.4 })
  mesh(parent, new THREE.PlaneGeometry(0.24, 0.26), material, 0, 1.20, -0.164).rotation.y = Math.PI
  mesh(parent, new THREE.PlaneGeometry(0.19, 0.21), material, 0, 1.21, 0.166)
}

export function makePlayer(scene, robot) {
  const root = new THREE.Group()
  const rig = joint(root, 0, 0)
  const torso = joint(rig, 0, 0)
  const uniform = matte(robot ? "#b63a25" : "#17528e")
  const shorts = matte(robot ? "#702317" : "#132d4a")
  const trim = matte(robot ? "#ffbe63" : "#94daed")
  const skin = matte(robot ? "#495861" : "#976044")
  const hair = matte("#231b1a")
  const shoes = matte(robot ? "#243039" : "#e8e9dd")
  const sole = matte("#c4c8bf")
  const tag = new THREE.MeshBasicMaterial({ color: robot ? "#fa9865" : "#75d7ff" })
  const jersey = [[0, 0], [0.20, 0], [0.211, 0.10], [0.235, 0.25], [0.27, 0.41], [0.247, 0.49], [0.105, 0.53], [0, 0.53]]
  profile(torso, uniform, 0, 0.88, 0, jersey, 0.61)
  profile(torso, trim, 0, 0.88, 0, [[0.202, 0], [0.205, 0.035]], 0.63)
  jerseyNumber(torso, robot ? "02" : "11")
  oval(torso, skin, 0, 1.445, 0, 0.077, 0.11, 0.07)
  const head = joint(torso, 0, 0)
  oval(head, skin, 0, 1.625, 0, 0.122, 0.165, 0.126)
  oval(head, skin, 0, 1.546, 0.048, 0.095, 0.076, 0.087)
  if (robot) {
    oval(head, hair, 0, 1.656, 0.075, 0.124, 0.052, 0.074)
    for (const side of [-1, 1]) oval(head, tag, side * 0.047, 1.658, 0.137, 0.027, 0.013, 0.009)
  } else {
    const cap = mesh(head, new THREE.SphereGeometry(1, 24, 14, 0, Math.PI * 2, 0, 1.57), hair, 0, 1.665, -0.013)
    cap.scale.set(0.126, 0.127, 0.132)
    oval(head, skin, 0, 1.602, 0.122, 0.029, 0.039, 0.029)
    for (const side of [-1, 1]) {
      oval(head, skin, side * 0.113, 1.612, 0, 0.022, 0.043, 0.029)
      oval(head, hair, side * 0.051, 1.643, 0.115, 0.025, 0.009, 0.012)
    }
  }

  const arms = [], elbows = [], legs = [], knees = [], feet = [], hands = []
  for (const side of [-1, 1]) {
    const arm = joint(torso, side * 0.249, 1.357)
    oval(arm, trim, 0, -0.015, 0, 0.083, 0.082, 0.079)
    oval(arm, skin, 0, -0.128, 0, 0.063, 0.158, 0.067)
    const elbow = joint(arm, 0, -0.255)
    oval(elbow, skin, 0, -0.105, 0, 0.052, 0.144, 0.055)
    const hand = joint(elbow, 0, -0.247, 0.011)
    oval(hand, skin, 0, -0.029, 0, 0.048, 0.072, 0.031)
    oval(hand, skin, -side * 0.037, -0.013, 0.019, 0.020, 0.041, 0.019)

    const leg = joint(rig, side * 0.115, 0.90)
    profile(leg, shorts, 0, 0, 0, [[0.112, -0.34], [0.121, -0.29], [0.133, -0.04], [0.128, 0.025]], 0.92)
    oval(leg, skin, 0, -0.33, 0, 0.082, 0.13, 0.083)
    const knee = joint(leg, 0, -0.404)
    oval(knee, skin, 0, -0.139, 0, 0.070, 0.178, 0.077)
    oval(knee, trim, 0, -0.348, 0, 0.062, 0.087, 0.067)
    const foot = joint(knee, 0, -0.414)
    oval(foot, sole, 0, -0.045, 0.060, 0.090, 0.025, 0.159)
    oval(foot, shoes, 0, -0.015, 0.061, 0.086, 0.054, 0.148)
    oval(foot, shoes, 0, 0.013, 0.002, 0.074, 0.074, 0.095)
    for (let lace = 0; lace < 3; lace++) {
      oval(foot, trim, 0, 0.041 - lace * 0.004, 0.059 + lace * 0.026, 0.056, 0.005, 0.008)
    }
    arms.push(arm)
    elbows.push(elbow)
    hands.push(hand)
    legs.push(leg)
    knees.push(knee)
    feet.push(foot)
  }
  root.traverse((object) => { if (object.isMesh) object.castShadow = true })
  const marker = new THREE.Group()
  ring(marker, tag, 0, 0.033, 0, 0.48, 0.046)
  scene.add(root, marker)
  return { root, rig, torso, head, marker, arms, elbows, legs, knees, feet, hands }
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
