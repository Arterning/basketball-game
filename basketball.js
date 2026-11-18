import * as THREE from "three"
import { createEngine } from "./engine/engine.js"
import { createInput } from "./engine/input.js"
import { buildCourt, court, makeBall, makePlayer } from "./court.js"

const ui = Object.fromEntries(
  ["arena", "score", "round", "clock", "accuracy", "callout", "meter", "needle",
    "shot-type", "menu", "menu-title", "summary", "start", "dash", "shoot"]
    .map((id) => [id, document.getElementById(id)])
)
const engine = createEngine({
  container: ui.arena, background: "#243743", fov: 48,
  cameraPosition: [2, 7.6, 12.8], lookAt: [0, 0.7, -2],
  fog: { near: 23, far: 52 },
})
const input = createInput({
  engine, actions: { jump: ["Space", "Pad0"], sprint: ["ShiftLeft", "ShiftRight", "TouchDash"] },
})
buildCourt(engine.scene)
const player = makePlayer(engine.scene, false)
const robot = makePlayer(engine.scene, true)
const ball = makeBall(engine.scene)

const rounds = 10
const clockDuration = 12
const maxCharge = 0.94
const ideal = 0.57
const gravity = 10.5
const layupRange = 1.9
const rim = new THREE.Vector3(0, court.rimY, court.rimZ)
const move = new THREE.Vector3()
const waypoint = new THREE.Vector3()
const toRim = new THREE.Vector3()
const previousBall = new THREE.Vector3()
const robotHand = new THREE.Vector3()
const cameraGoal = new THREE.Vector3()
const look = new THREE.Vector3()
const delta = new THREE.Vector3()
const segment = new THREE.Line3()
const closest = new THREE.Vector3()

let phase = "menu"
let score = 0
let round = 1
let makes = 0
let attempts = 0
let remaining = clockDuration
let charge = 0
let airborne = 0
let stride = 0
let robotStride = 0
let dash = 0
let dashCooldown = 0
let defend = "guard"
let defendTime = 0
let defendCooldown = 0
let recovery = 0
let resultTime = 0
let shot = null

const clamp = THREE.MathUtils.clamp
const space = () => Math.hypot(player.root.position.x - robot.root.position.x, player.root.position.z - robot.root.position.z)
const basketDistance = () => Math.hypot(player.root.position.x, player.root.position.z - court.rimZ)
const timestamp = () => remaining.toFixed(1)
function face(actor, x, z) {
  const position = actor.root.position
  actor.root.rotation.y = Math.atan2(x - position.x, z - position.z)
}

function refreshScore() {
  ui.score.textContent = score
  ui.round.textContent = round + " / " + rounds
  ui.accuracy.textContent = attempts ? Math.round(100 * makes / attempts) + "%" : "—"
}

function prepareRound() {
  remaining = clockDuration
  charge = airborne = stride = robotStride = dash = dashCooldown = 0
  defendTime = defendCooldown = recovery = 0
  defend = "guard"
  shot = null
  const x = [0, -2.8, 2.8][(round - 1) % 3]
  player.root.position.set(x, 0, 1.8)
  robot.root.position.set(x * 0.72, 0, -0.65)
  face(player, 0, court.rimZ)
  face(robot, x, 1.8)
  pose(0)
  updateHeldBall(0)
  ui.meter.hidden = true
  ui.callout.textContent = ""
  ui.clock.textContent = timestamp()
  ui.clock.classList.remove("urgent")
  refreshScore()
}

function startMatch() {
  score = makes = attempts = 0
  round = 1
  prepareRound()
  phase = "play"
  ui.menu.hidden = true
  ui.start.blur()
}

function finishRound(message) {
  phase = "result"
  resultTime = 1.3
  charge = 0
  ui.meter.hidden = true
  ui.callout.textContent = message
  refreshScore()
}

function nextRound() {
  if (round < rounds) {
    round++
    prepareRound()
    phase = "play"
    return
  }
  phase = "menu"
  ui.menu.hidden = false
  ui["menu-title"].textContent = "挑战结束"
  ui.summary.textContent = "总得分 " + score + " · " + "命中 " + makes + " 球 / 出手 " + attempts + " 次"
  ui.start.textContent = "再打一局"
  ui.callout.textContent = ""
}

function advancePlayer(dt) {
  dashCooldown = Math.max(0, dashCooldown - dt)
  dash = Math.max(0, dash - dt)
  const position = player.root.position
  move.set(input.move.x, 0, input.move.y)
  if (charge || move.lengthSq() < 0.001) return
  if (input.down("sprint") && dashCooldown === 0) {
    dash = 0.29
    dashCooldown = 0.85
  }
  const distance = dt * (dash > 0 ? 7.1 : 4.35)
  position.addScaledVector(move, distance)
  stride += distance * 4
}

function pressure() {
  return clamp((2.2 - space()) / 1.35, 0, 1)
}

function timingWindow() {
  return clamp(0.14 - basketDistance() * 0.007 - pressure() * 0.047, 0.052, 0.14)
}

function shoot() {
  const error = charge - ideal
  const distance = basketDistance()
  const width = timingWindow()
  const points = distance > court.arc || Math.abs(player.root.position.x) > 5.96 ? 3 : 2
  const timingError = Math.abs(error) / width
  const miss = timingError <= 1 ? timingError * 0.085 : 0.26 + (timingError - 1) * 0.095
  const target = rim.clone()
  target.x += Math.sign(error) * miss
  target.z += Math.sign(error) * miss * 0.38
  const time = distance < layupRange ? 0.76 : clamp(0.83 + distance * 0.078, 0.94, 1.56)
  if (defend === "guard" && space() < 1.64 && defendCooldown <= 0) beginDefense("block")
  const velocity = target.sub(ball.position).divideScalar(time)
  velocity.y += gravity * time / 2
  shot = { origin: ball.position.clone(), velocity, time: 0, points, made: false, blocked: false }
  attempts++
  phase = "flight"
  airborne = 0.48
  ui.meter.hidden = true
  ui.callout.textContent = timingError <= 1 ? "把握时机！" : error < 0 ? "出手偏早" : "出手偏晚"
  charge = 0
  refreshScore()
}

function beginDefense(action) {
  defend = action
  defendTime = 0
  if (action === "steal") ui.callout.textContent = "机器人准备抢断"
}

function recover(seconds) {
  defend = "guard"
  recovery = seconds
  defendCooldown = seconds + 0.45
}

function updateRobot(dt) {
  const position = robot.root.position
  const playerPos = player.root.position
  const oldX = position.x
  const oldZ = position.z
  defendTime += dt
  defendCooldown -= dt
  recovery -= dt
  if (defend === "guard" && recovery <= 0 && phase === "play") {
    toRim.set(-playerPos.x, 0, rim.z - playerPos.z).normalize()
    waypoint.copy(playerPos).addScaledVector(toRim, 1.13)
    delta.set(waypoint.x - position.x, 0, waypoint.z - position.z)
    if (delta.lengthSq() > 0.00001) position.addScaledVector(delta, Math.min(1, (charge ? 2.25 : 3.45) * dt / delta.length()))
    if (defendCooldown <= 0) {
      if (charge > 0.21 && space() < 1.72) beginDefense("block")
      else if (!charge && space() < 1.24) beginDefense("steal")
    }
  } else if (defend === "steal") {
    if (defendTime >= 0.32 && defendTime < 0.48) {
      delta.set(ball.position.x - position.x, 0, ball.position.z - position.z)
      position.addScaledVector(delta.normalize(), 2.2 * dt)
    }
    if (defendTime >= 0.48) {
      const reach = Math.hypot(ball.position.x - position.x, ball.position.z - position.z)
      recover(0.68)
      if (phase === "play" && charge === 0 && reach < 0.92 && dash <= 0) {
        finishRound("被抢断")
      } else if (phase === "play") ui.callout.textContent = "抢断落空"
    }
  } else if (defend === "block" && defendTime >= 0.72) {
    recover(0.48)
  }

  if (phase === "play") {
    delta.set(position.x - playerPos.x, 0, position.z - playerPos.z)
    const gap = delta.length()
    if (gap < 0.72) {
      if (gap < 0.001) delta.set(0, 0, -1)
      playerPos.addScaledVector(delta.normalize(), gap - 0.72)
    }
  }
  robotStride += Math.hypot(position.x - oldX, position.z - oldZ) * 4
  face(robot, playerPos.x, playerPos.z)
}

function pose(dt) {
  const running = phase === "play" && !charge && input.move.lengthSq() > 0.01
  const shooting = charge > 0 || airborne > 0
  airborne = Math.max(0, airborne - dt)
  player.root.position.y = charge
    ? 0.48 * Math.sin(Math.PI * clamp(charge / 1.15, 0, 1))
    : airborne * 0.8
  const jumping = defend === "block" && defendTime > 0.12
  robot.root.position.y = jumping ? Math.max(0, 0.94 * Math.sin(Math.PI * (defendTime - 0.12) / 0.57)) : 0
  for (let i = 0; i < 2; i++) {
    const sign = i === 0 ? 1 : -1
    player.legs[i].rotation.x = running ? sign * Math.sin(stride) * 0.63 : 0
    player.arms[i].rotation.x = shooting ? -2.45 - (i ? 0.15 : 0) : i ? -0.35 : sign * Math.sin(stride) * 0.47
    robot.legs[i].rotation.x = defend === "guard" && recovery <= 0 ? sign * Math.sin(robotStride) * 0.35 : 0
    robot.arms[i].rotation.x = defend === "block" ? (jumping ? -2.42 : -1.1)
      : defend === "steal" ? (defendTime >= 0.32 ? -1.48 : -0.74) : -0.48
    robot.arms[i].rotation.z = sign * (defend === "steal" ? 0.18 : -0.28)
  }
  player.marker.position.set(player.root.position.x, 0, player.root.position.z)
  robot.marker.position.set(robot.root.position.x, 0, robot.root.position.z)
}

function updateHeldBall(elapsed) {
  if (charge) {
    player.hands[0].getWorldPosition(ball.position)
    ball.position.y += 0.065
  } else {
    ball.position.set(-0.49, 0.14 + 0.86 * Math.abs(Math.cos(elapsed * 10.5)), 0.33)
    player.root.localToWorld(ball.position)
  }
}

function updateFlight(dt) {
  previousBall.copy(ball.position)
  shot.time += dt
  ball.position.copy(shot.origin).addScaledVector(shot.velocity, shot.time)
  ball.position.y -= 0.5 * gravity * shot.time ** 2
  if (!shot.blocked && !shot.made && shot.time < 0.38 &&
      defend === "block" && defendTime > 0.14 && defendTime < 0.58) {
    segment.set(previousBall, ball.position)
    const touched = robot.hands.some((hand) => {
      hand.getWorldPosition(robotHand)
      segment.closestPointToPoint(robotHand, true, closest)
      return closest.distanceTo(robotHand) < 0.53
    })
    if (touched) {
      shot.blocked = true
      shot.origin.copy(closest)
      shot.time = 0
      shot.velocity.set(robot.root.position.x > ball.position.x ? -2 : 2, 0.8, 1.8)
      ui.callout.textContent = "被封盖"
    }
  }

  if (!shot.blocked && !shot.made && previousBall.y > rim.y && ball.position.y <= rim.y) {
    const fraction = (previousBall.y - rim.y) / (previousBall.y - ball.position.y)
    closest.copy(previousBall).lerp(ball.position, fraction)
    if (closest.distanceTo(rim) < 0.119) {
      shot.made = true
      makes++
      score += shot.points
      ui.callout.textContent = "进球！ +" + shot.points
      refreshScore()
    }
  }

  if (ball.position.y <= 0.12) {
    ball.position.y = 0.12
    finishRound(shot.made ? "进球！ +" + shot.points : shot.blocked ? "被封盖" : "投篮未进")
  }
}

function updatePlay(dt, elapsed) {
  remaining = Math.max(0, remaining - dt)
  ui.clock.textContent = timestamp()
  ui.clock.classList.toggle("urgent", remaining < 4)
  advancePlayer(dt)
  const position = player.root.position
  face(player, 0, rim.z)
  if (!charge && input.pressed("jump")) charge = Number.EPSILON
  if (charge) charge += dt
  updateHeldBall(elapsed)
  updateRobot(dt)
  pose(dt)
  updateHeldBall(elapsed)
  if (phase !== "play") return
  if (Math.abs(position.x) > court.width / 2 || Math.abs(position.z) > court.length / 2) {
    finishRound("出界")
    return
  }
  if (remaining === 0) {
    finishRound("进攻时间到")
    return
  }
  if (!charge) return
  const width = timingWindow()
  const green = ui.meter.querySelector(".green")
  green.style.left = 100 * (ideal - width) / maxCharge + "%"
  green.style.width = 200 * width / maxCharge + "%"
  ui.needle.style.left = Math.min(100, 100 * charge / maxCharge) + "%"
  ui["shot-type"].textContent = basketDistance() < layupRange ? "上篮" : "跳投"
  ui.meter.hidden = false
  if (input.released("jump") || !input.down("jump") || charge >= maxCharge) shoot()
}

if (input.touch) {
  ui.summary.textContent = "10 个进攻回合，每回合 12 秒。拖动左半屏移动，按住投篮，在绿色区域松手。"
}
ui.start.addEventListener("click", startMatch)
for (const [button, code] of [[ui.dash, "TouchDash"], [ui.shoot, "Space"]]) {
  button.addEventListener("pointerdown", (event) => {
    button.setPointerCapture(event.pointerId)
    input.press(code)
  })
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    button.addEventListener(type, () => input.release(code))
  }
}

prepareRound()
engine.onUpdate((dt, elapsed) => {
  if (input.pressed("restart")) startMatch()
  if (phase === "play") updatePlay(dt, elapsed)
  else if (phase === "flight") {
    updateRobot(dt)
    pose(dt)
    updateFlight(dt)
  } else if (phase === "result") {
    pose(dt)
    resultTime -= dt
    if (resultTime <= 0) nextRound()
  }
  ball.rotation.x += dt * (phase === "flight" ? 8 : 2)
  const position = player.root.position
  const portrait = engine.camera.aspect < 0.85
  cameraGoal.set(1.95 + position.x * 0.41, portrait ? 8.5 : 6.9, position.z * 0.58 + (portrait ? 12.5 : 10.3))
  engine.camera.position.lerp(cameraGoal, 1 - Math.exp(-5 * dt))
  look.set(position.x * 0.42, 0.85, (position.z + rim.z) * 0.5)
  engine.camera.lookAt(look)
})
engine.start()
