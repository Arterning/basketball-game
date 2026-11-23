import * as THREE from "three"
import { createEngine } from "./engine/engine.js"
import { createShake } from "./engine/animation.js"
import { createParticles, shockwave } from "./engine/particles.js"
import { createInput } from "./engine/input.js"
import { buildCourt, court, makeBall, makePlayer } from "./court.js"

const ui = Object.fromEntries(
  ["arena", "score", "round", "clock", "accuracy", "callout", "meter", "needle",
    "shot-type", "dunk-hint", "menu", "menu-title", "summary", "difficulty", "start", "dash", "dash-key", "shoot", "spin", "post", "fake", "first-person", "third-person"]
    .map((id) => [id, document.getElementById(id)])
)
const engine = createEngine({
  container: ui.arena, background: "#243743", fov: 48,
  cameraPosition: [2, 7.6, 12.8], lookAt: [0, 0.7, -2],
  fog: { near: 23, far: 52 },
})
const input = createInput({
  engine, actions: {
    jump: ["Space", "Pad0"],
    sprint: ["ShiftLeft", "ShiftRight", "TouchDash"],
    spin: ["KeyE", "TouchSpin"],
    post: ["KeyB", "TouchPost"],
    fake: ["KeyF", "TouchFake"],
    camera: ["KeyV"],
  },
})
const { net, dunkZone } = buildCourt(engine.scene)
const player = makePlayer(engine.scene, false)
const robot = makePlayer(engine.scene, true)
const ball = makeBall(engine.scene)

const difficulties = {
  easy: { speed: 0.86, shotWindow: 1.25, height: 1, armLength: 1, blockStep: 0, guardGap: 1.02 },
  normal: { speed: 1.18, shotWindow: 1, height: 1, armLength: 1, blockStep: 0, guardGap: 0.91 },
  hard: { speed: 1.76, shotWindow: 0.72, height: 1.23, armLength: 1.28, blockStep: 2.8, guardGap: 0.82 },
}

const rounds = 10
const clockDuration = 12
const maxCharge = 0.94
const ideal = 0.57
const gravity = 10.5
const layupRange = 1.9
const dunkRelease = 0.38
const dunkDuration = 0.81
const rim = new THREE.Vector3(0, court.rimY, court.rimZ)
const sparks = createParticles(engine, { max: 180, gravity: -9 })
const impactLight = new THREE.PointLight("#ff8a30", 0, 5)
impactLight.position.copy(rim)
engine.add(impactLight)
const shakeOffset = new THREE.Object3D()
const dunkShake = createShake(shakeOffset, { decay: 13, frequency: 44 })
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)")
const move = new THREE.Vector3()
const dashDirection = new THREE.Vector3()
const playerVelocity = new THREE.Vector3()
const robotVelocity = new THREE.Vector3()
const moveForward = new THREE.Vector3()
const moveSide = new THREE.Vector3()
const dribbleHand = new THREE.Vector3()
const crossoverDuration = 0.18
const spinDuration = 0.62
const spinWidth = 2.75
const spinDrive = 0.75
const stealWindup = 0.32
const crossoverStealWindup = 0.065
const stealReachDuration = 0.18
const palmRadius = 0.055
const ballRadius = 0.12
const postStepDuration = 0.22
const postBounceRate = 8.2
const fakeDuration = 0.28
const waypoint = new THREE.Vector3()
const toRim = new THREE.Vector3()
const netPreviousBall = new THREE.Vector3()
const previousBall = new THREE.Vector3()
const robotHand = new THREE.Vector3()
const previousPalm = new THREE.Vector3()
const previousDribbleBall = new THREE.Vector3()
const handAim = new THREE.Vector3()
const dribblePalm = new THREE.Vector3()
const solePoint = new THREE.Vector3()
const downArm = new THREE.Vector3(0, -1, 0)
const reachRotation = new THREE.Quaternion()
const contactOrigin = new THREE.Vector3()
const viewDirection = new THREE.Vector3(0, 0, -1)
const cameraGoal = new THREE.Vector3()
const look = new THREE.Vector3()
const delta = new THREE.Vector3()
const segment = new THREE.Line3()
const closest = new THREE.Vector3()

let firstPerson = false
let cameraChanged = true
let phase = "menu"
let difficulty = difficulties.normal
let score = 0
let round = 1
let makes = 0
let attempts = 0
let remaining = clockDuration
let charge = 0
let airborne = 0
let fake = 0
let fakeCooldown = 0
let stride = 0
let robotStride = 0
let dash = 0
let dashCooldown = 0
let defend = "guard"
let defendTime = 0
let stealEvaded = false
let stealHand = 0
let stealReadyAt = stealWindup
let defendCooldown = 0
let recovery = 0
let resultTime = 0
let shot = null
let dunk = null
let dribble = null
let dribbleCooldown = 0
// Ball sides use the avatar's local coordinates. Facing the hoop, local +X
// is the player's left when moving toward the far end of the court.
let ballSide = 1
let crossover = null
let post = null
let lastLateral = 0
let lastLateralAt = -Infinity
let bounceStarted = 0
let chasing = false

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
  fake = fakeCooldown = 0
  charge = airborne = stride = robotStride = dash = dashCooldown = 0
  defendTime = defendCooldown = recovery = 0
  defend = "guard"
  stealEvaded = false
  dribble = null
  dribbleCooldown = 0
  ballSide = 1
  crossover = post = null
  lastLateral = 0
  lastLateralAt = -Infinity
  bounceStarted = 0
  chasing = false
  playerVelocity.set(0, 0, 0)
  robotVelocity.set(0, 0, 0)
  shot = dunk = null
  ui["dunk-hint"].hidden = true
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
  difficulty = difficulties[ui.difficulty.value]
  robot.rig.scale.y = difficulty.height
  for (const arm of robot.arms) arm.scale.y = difficulty.armLength
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
  dribble = crossover = post = null
  charge = fake = 0
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

function finishCrossover(elapsed, interrupted = false) {
  if (!crossover) return
  if (!interrupted || elapsed - crossover.started >= crossoverDuration / 2) ballSide = crossover.toHand
  crossover = null
  bounceStarted = elapsed
}

function startSpin(elapsed) {
  finishCrossover(elapsed, true)
  const position = player.root.position
  moveForward.set(-position.x, 0, rim.z - position.z).normalize()
  if (moveForward.lengthSq() === 0) moveForward.z = -1
  moveSide.set(-moveForward.z, 0, moveForward.x)
  const side = ballSide
  const hoopAngle = Math.atan2(moveForward.x, moveForward.z)
  const offset = THREE.MathUtils.euclideanModulo((player.root.rotation.y - hoopAngle) * side, Math.PI * 2)
  const sweep = offset > Math.PI / 2 && offset < Math.PI * 1.5 ? offset : Math.PI * 2
  dribble = { side, time: 0, toHand: -ballSide, sweep, startHeight: ball.position.y }
  dribbleCooldown = spinDuration + 0.44
  lastLateral = 0
  lastLateralAt = -Infinity
  dash = 0
  if (defend === "steal" && defendTime < 0.43) stealEvaded = true
  ui.callout.textContent = "转身护球"
}

function updateCrossover(elapsed) {
  const lateral = playerVelocity.x
  const direction = Math.abs(lateral) >= 0.85 ? Math.sign(lateral) : 0
  const reversed = direction && lastLateral === -direction && elapsed - lastLateralAt < 0.32
  if (direction) {
    lastLateral = direction
    lastLateralAt = elapsed
  }
  let target = -direction
  if (crossover && elapsed - crossover.started >= crossoverDuration) {
    if (lastLateralAt >= crossover.started) target = -lastLateral
    finishCrossover(elapsed)
  }
  if (!crossover && target && ballSide !== target) {
    crossover = { toHand: target, started: elapsed, height: ball.position.y }
  }

  if (reversed && defend === "guard" && recovery <= 0 && robotVelocity.x * direction < -1.15 && space() < 2.65) {
    recover(0.31)
    ui.callout.textContent = "变向晃开防守"
  }
}

function updatePost(dt, elapsed) {
  const playerPos = player.root.position
  const defender = robot.root.position
  const pressed = input.pressed("post")
  if (post && !pressed && (input.pressed("jump") || (!fakeCooldown && input.pressed("fake")) || input.pressed("spin") ||
      input.pressed("sprint") || input.move.lengthSq() > 0.04)) {
    post = null
    ui.callout.textContent = ""
    return false
  }

  if (!post) {
    if (!pressed || dribble || remaining <= 0) return false
    toRim.set(-playerPos.x, 0, rim.z - playerPos.z).normalize()
    delta.set(defender.x - playerPos.x, 0, defender.z - playerPos.z)
    if (delta.length() > 1.55 || delta.dot(toRim) < 0.30) {
      ui.callout.textContent = "贴近正面的防守人再背打"
      return false
    }
    finishCrossover(elapsed, true)
    bounceStarted = elapsed
    dash = 0
    if (defend === "steal") defend = "guard"
    post = { time: 0, distance: 0, queued: false }
    ui.callout.textContent = input.touch ? "背身护球 · 连点背打往里顶" : "背身护球 · 连按 B 往里顶"
    return true
  }

  if (pressed) post.queued = true
  if (post.queued && post.time === 0) {
    post.queued = false
    post.distance = Math.min(0.52 / difficulty.speed, Math.max(0, basketDistance() - 0.94))
    if (post.distance > 0.01) {
      post.time = postStepDuration
      ui.callout.textContent = "背身顶进"
    } else {
      ui.callout.textContent = "已到篮下"
    }
  }

  if (post.time > 0) {
    const previous = 1 - post.time / postStepDuration
    post.time = Math.max(0, post.time - dt)
    const progress = 1 - post.time / postStepDuration
    const step = post.distance * (THREE.MathUtils.smoothstep(progress, 0, 1) - THREE.MathUtils.smoothstep(previous, 0, 1))
    toRim.set(-playerPos.x, 0, rim.z - playerPos.z).normalize()
    playerPos.addScaledVector(toRim, step)
    defender.addScaledVector(toRim, step)
    playerVelocity.copy(toRim).multiplyScalar(step / dt)
    stride += step * 5
    robotStride += step * 7
  }
  return true
}

function advancePlayer(dt, elapsed) {
  dashCooldown = Math.max(0, dashCooldown - dt)
  dash = Math.max(0, dash - dt)
  dribbleCooldown = Math.max(0, dribbleCooldown - dt)
  playerVelocity.set(0, 0, 0)
  if (!dt || charge || fake || updatePost(dt, elapsed)) return

  if (!dribble && dribbleCooldown === 0 && input.pressed("spin")) startSpin(elapsed)

  if (dribble) {
    const previous = THREE.MathUtils.smoothstep(dribble.time, 0, spinDuration)
    const next = THREE.MathUtils.smoothstep(dribble.time + dt, 0, spinDuration)
    const speed = (next - previous) / dt
    move.copy(moveSide).multiplyScalar(spinWidth * dribble.side * speed)
    move.addScaledVector(moveForward, spinDrive * speed)
  } else {
    move.set(input.move.x, 0, input.move.y)
    if (input.pressed("sprint") && dashCooldown === 0) {
      dashDirection.copy(move)
      if (dashDirection.lengthSq() < 0.001) {
        const position = player.root.position
        dashDirection.set(-position.x, 0, rim.z - position.z)
        if (dashDirection.lengthSq() < 0.001) dashDirection.z = -1
      }
      dashDirection.normalize()
      dash = 0.29
      dashCooldown = 0.85
    }
    if (dash > 0) move.copy(dashDirection).multiplyScalar(8.2)
    else move.multiplyScalar(4.35)
  }

  playerVelocity.copy(move)
  if (!dribble) updateCrossover(elapsed)
  if (move.lengthSq() < 0.001) return
  player.root.position.addScaledVector(playerVelocity, dt)
  stride += playerVelocity.length() * dt * 4.8
}

function pressure() {
  return clamp((2.2 - space()) / 1.35, 0, 1)
}

function timingWindow() {
  const range = clamp(basketDistance() / 11, 0, 1)
  return THREE.MathUtils.lerp(0.155, 0.032, range) * (1 - pressure() * 0.34) * difficulty.shotWindow
}

function canDunk() {
  return !charge && !fake && !dribble && basketDistance() <= court.dunkRange &&
    player.root.position.z >= rim.z - court.dunkBackEdge
}

function startDunk() {
  const origin = player.root.position.clone()
  const direction = origin.clone().sub(rim).setY(0)
  if (direction.lengthSq() < 0.01) direction.set(0, 0, 1)
  const landing = rim.clone().setY(0).addScaledVector(direction.normalize(), 0.53)
  dunk = { origin, landing, time: 0, ballOrigin: ball.position.clone(), made: false }
  phase = "dunk"
  attempts++
  dash = 0
  ui["dunk-hint"].hidden = true
  ui.callout.textContent = "双手起跳"
  refreshScore()
}

function registerBasket(points, message) {
  makes++
  score += points
  ui.callout.textContent = message
  refreshScore()
}

function playDunkImpact() {
  sparks.burst(rim, { count: 70, color: "#ff9a28", speed: 7, size: 0.15, lifetime: 0.54 })
  sparks.burst(rim, { count: 36, color: "#fff1be", speed: 5, size: 0.11, lifetime: 0.39 })
  shockwave(engine, rim, { color: "#ffad53", from: 0.30, to: 2.5, duration: 0.40, thickness: 0.09 })
  impactLight.intensity = 24
  if (!reducedMotion.matches) dunkShake.add(firstPerson ? 0.04 : 0.13)
}

function updateDunk(dt, elapsed) {
  dunk.time = Math.min(dunkDuration, dunk.time + dt)
  const progress = dunk.time / dunkDuration
  const approach = THREE.MathUtils.smoothstep(dunk.time, 0, dunkRelease)
  player.root.position.copy(dunk.origin).lerp(dunk.landing, approach)
  face(player, 0, rim.z)
  updateRobot(dt)
  pose(dt, elapsed)

  if (dunk.time < dunkRelease) {
    player.hands[0].getWorldPosition(ball.position)
    player.hands[1].getWorldPosition(dribbleHand)
    ball.position.lerp(dribbleHand, 0.5)
    ball.position.y += 0.09
    ball.position.lerp(dunk.ballOrigin, 1 - THREE.MathUtils.smoothstep(dunk.time, 0, 0.12))
    look.copy(rim)
    look.y += 0.18
    ball.position.lerp(look, THREE.MathUtils.smoothstep(progress, 0.25, dunkRelease / dunkDuration))
  } else {
    const fall = dunk.time - dunkRelease
    ball.position.copy(rim)
    ball.position.y = Math.max(0.12, rim.y + 0.18 - 4.9 * fall - 0.5 * gravity * fall ** 2)
    if (!dunk.made && ball.position.y <= rim.y) {
      dunk.made = true
      registerBasket(2, "双手暴扣！ +2")
      playDunkImpact()
    }
  }

  if (dunk.time >= dunkDuration) {
    dunk = null
    finishRound("双手暴扣！ +2")
  }
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
  if (defend === "guard" && space() < 1.64 * difficulty.armLength && defendCooldown <= 0) beginDefense("block")
  const position = player.root.position
  const defender = robot.root.position
  toRim.set(-position.x, 0, rim.z - position.z).normalize()
  delta.set(defender.x - position.x, 0, defender.z - position.z)
  const smothered = defend === "block" && defendTime < 0.54 &&
    delta.length() < 1.28 && toRim.dot(delta.normalize()) > 0.45
  const velocity = target.sub(ball.position).divideScalar(time)
  velocity.y += gravity * time / 2
  shot = { origin: ball.position.clone(), velocity, time: 0, points, smothered, made: false, blocked: false }
  attempts++
  phase = "flight"
  airborne = 0.48
  ui.meter.hidden = true
  ui.callout.textContent = timingError <= 1 ? "把握时机！" : error < 0 ? "出手偏早" : "出手偏晚"
  charge = 0
  refreshScore()
}

function isProtectingBall() {
  return Boolean(post) || (!crossover && playerVelocity.lengthSq() <= 0.1)
}

function canStealDribble(elapsed) {
  if (charge || fake || dribble || isProtectingBall()) return false
  const angle = player.root.rotation.y
  const x = robot.root.position.x - player.root.position.x
  const z = robot.root.position.z - player.root.position.z
  const defenderSide = x * Math.cos(angle) - z * Math.sin(angle)
  const defenderFront = x * Math.sin(angle) + z * Math.cos(angle)
  if (crossover) {
    const progress = (elapsed - crossover.started) / crossoverDuration
    return defenderFront > 0.28 && progress >= 0.12 && progress <= 0.88
  }

  if (defenderSide * ballSide < 0.18) return false
  const hand = player.hands[ballSide < 0 ? 0 : 1]
  hand.getWorldPosition(dribblePalm)
  return ball.position.y < dribblePalm.y - 0.14
}

function getPalm(index, target) {
  return robot.hands[index].localToWorld(target.set(0, -0.029, 0))
}

function resolveSteal(dt, elapsed) {
  if (defend !== "steal" || defendTime < stealReadyAt) return
  const stealEnd = stealReadyAt + stealReachDuration

  if (dt > 0 && defendTime - dt < stealEnd && canStealDribble(elapsed) && !stealEvaded) {
    // Sweep the palm relative to the moving ball to keep fast contacts between frames.
    getPalm(stealHand, robotHand).sub(ball.position)
    previousPalm.sub(previousDribbleBall)
    robotHand.lerp(previousPalm, clamp((defendTime - stealEnd) / dt, 0, 1))
    previousPalm.lerp(robotHand, clamp((stealReadyAt - defendTime + dt) / dt, 0, 1))
    segment.set(previousPalm, robotHand).closestPointToPoint(contactOrigin, true, closest)
    if (closest.lengthSq() <= (ballRadius + palmRadius) ** 2) {
      recover(0.68)
      finishRound("被抢断")
      return
    }
  }
  if (defendTime >= stealEnd) {
    recover(0.68)
    if (!charge && !fake) ui.callout.textContent = stealEvaded ? "转身躲过抢断" : "抢断落空"
  }
}

function beginDefense(action) {
  defend = action
  defendTime = 0
  if (action === "steal") {
    stealEvaded = false
    stealReadyAt = crossover ? crossoverStealWindup : stealWindup
    stealHand = getPalm(0, robotHand).distanceToSquared(ball.position) <=
      getPalm(1, previousPalm).distanceToSquared(ball.position) ? 0 : 1
    ui.callout.textContent = "机器人准备抢断"
  }
}

function recover(seconds) {
  defend = "guard"
  recovery = seconds
  defendCooldown = seconds + 0.45
}

function updateRobot(dt, elapsed = 0) {
  const position = robot.root.position
  const playerPos = player.root.position
  defendTime += dt
  defendCooldown -= dt
  recovery -= dt
  if (post) {
    if (defend === "block" && defendTime >= 0.72) recover(0.48)
    robotVelocity.set(0, 0, 0)
    chasing = false
    face(robot, playerPos.x, playerPos.z)
    return
  }
  if (phase !== "play" && defend === "steal") recover(0.68)
  const oldX = position.x
  const oldZ = position.z
  const windingUp = defend === "steal" && defendTime < stealReadyAt
  if (phase === "play" && ((defend === "guard" && recovery <= 0) || windingUp)) {
    toRim.set(-playerPos.x, 0, rim.z - playerPos.z).normalize()
    delta.set(position.x - playerPos.x, 0, position.z - playerPos.z)
    chasing = !windingUp && !charge && delta.dot(toRim) < -0.16 && basketDistance() > 1.35
    const driveSpeed = playerVelocity.dot(toRim)
    waypoint.copy(playerPos).addScaledVector(toRim, chasing ? 2.3 : difficulty.guardGap)
    if (!charge && !fake && !dribble && !crossover && !isProtectingBall()) {
      const shade = 0.24 * difficulty.speed * ballSide
      waypoint.x += Math.cos(player.root.rotation.y) * shade
      waypoint.z -= Math.sin(player.root.rotation.y) * shade
    }
    // Match lateral movement immediately, while correcting toward the line to the hoop.
    delta.subVectors(waypoint, position).setY(0).multiplyScalar(10)
    delta.add(playerVelocity).addScaledVector(toRim, -driveSpeed)
    const limit = (charge ? 2.25 : chasing ? 7 : 5.6) * difficulty.speed
    delta.clampLength(0, windingUp ? limit * 0.75 : limit)
    robotVelocity.lerp(delta, 1 - Math.exp(-18 * difficulty.speed * dt))
    position.addScaledVector(robotVelocity, dt)
    if (defend === "guard" && defendCooldown <= 0) {
      const bites = fake > 0.07 && space() < 1.65 * difficulty.armLength
      if (bites || (charge > 0.21 && space() < 1.72 * difficulty.armLength)) {
        beginDefense("block")
        if (bites) ui.callout.textContent = "骗起防守！"
      } else if (canStealDribble(elapsed) && space() < 1.24 &&
          Math.hypot(ball.position.x - position.x, ball.position.z - position.z) < 1.45) {
        beginDefense("steal")
      }
    }
  } else {
    chasing = false
    robotVelocity.multiplyScalar(Math.exp(-12 * dt))
  }
  if (defend === "steal") {
    if (defendTime >= stealReadyAt && defendTime <= stealReadyAt + stealReachDuration) {
      delta.set(ball.position.x - position.x, 0, ball.position.z - position.z)
      position.addScaledVector(delta.normalize(), 2.2 * difficulty.speed * dt)
    }
  } else if (defend === "block") {
    if (defendTime >= 0.72) {
      recover(0.48)
    } else if (difficulty.blockStep && defendTime < 0.24) {
      delta.set(playerPos.x - position.x, 0, playerPos.z - position.z)
      const step = Math.min(Math.max(0, delta.length() - 0.92), difficulty.blockStep * dt)
      position.addScaledVector(delta.normalize(), step)
    }
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

function plantStance(actor) {
  const lift = actor.root.position.y
  actor.rig.position.y = 0
  const left = actor.feet[0].localToWorld(solePoint.set(0, -0.070, 0.06)).y
  const right = actor.feet[1].localToWorld(solePoint.set(0, -0.070, 0.06)).y
  const grounded = 1 - THREE.MathUtils.smoothstep(lift, 0, 0.30)
  actor.rig.position.y = (lift - Math.min(left, right)) * grounded
}

function pose(dt, elapsed = 0) {
  const running = phase === "play" && playerVelocity.lengthSq() > 0.1
  const shooting = charge > 0 || airborne > 0
  const protecting = !shooting && !fake && !dunk && !dribble && isProtectingBall()
  const progress = dribble ? clamp(dribble.time / spinDuration, 0, 1) : 0
  const dribblingHand = dribble && progress > 0.45 ? dribble.toHand : ballSide
  const fakeLift = fake ? Math.sin(Math.PI * fake / fakeDuration) : 0
  const crossProgress = crossover ? clamp((elapsed - crossover.started) / crossoverDuration, 0, 1) : 0
  const crouch = charge ? 1 - THREE.MathUtils.smoothstep(charge, 0.10, 0.29)
    : shooting || dunk ? 0.10 : post || dribble || crossover ? 1 : running ? 0.80 : 0.65
  airborne = Math.max(0, airborne - dt)
  player.root.position.y = charge
    ? 0.48 * Math.sin(Math.PI * clamp((charge - 0.12) / 0.99, 0, 1))
    : airborne * 0.8
  const dunkLift = dunk ? Math.sin(Math.PI * dunk.time / dunkDuration) : 0
  if (dunk) player.root.position.y = 1.28 * dunkLift
  const postBounce = post ? Math.abs(Math.cos((elapsed - bounceStarted) * postBounceRate)) : 0
  const postEffort = post ? Math.sin(Math.PI * post.time / postStepDuration) : 0
  const playerAngle = player.root.rotation.y
  const lateralDrive = playerVelocity.x * Math.cos(playerAngle) - playerVelocity.z * Math.sin(playerAngle)
  const playerLean = clamp(lateralDrive * -0.039, -0.24, 0.24)
  player.waist.rotation.x = post ? -0.11 - 0.20 * postEffort : 0.38 * crouch + 0.09 * fakeLift
  player.waist.rotation.z = crossover
    ? crossover.toHand * Math.sin(crossProgress * Math.PI) * -0.26 : playerLean
  const jumping = defend === "block" && defendTime > 0.12
  robot.root.position.y = jumping ? Math.max(0, 0.94 * Math.sin(Math.PI * (defendTime - 0.12) / 0.57)) : 0
  const robotAngle = robot.root.rotation.y
  const lateralShuffle = robotVelocity.x * Math.cos(robotAngle) - robotVelocity.z * Math.sin(robotAngle)
  const defenderCrouch = 1 - THREE.MathUtils.smoothstep(robot.root.position.y, 0, 0.24)
  robot.waist.rotation.x = defenderCrouch * (defend === "steal" ? 0.48 : 0.39)
  robot.waist.rotation.z = defenderCrouch * clamp(-lateralShuffle * 0.043, -0.22, 0.22)
  const shuffling = postEffort > 0 || robotVelocity.lengthSq() > 0.12
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1
    const step = side * Math.sin(stride)
    const handOnBall = side === dribblingHand
    player.legs[i].rotation.x = -0.73 * crouch + (running ? step * 0.45 : 0.06 * side)
    player.legs[i].rotation.z = side * 0.21 * crouch + (running ? clamp(lateralDrive * 0.027, -0.14, 0.14) : 0)
    player.knees[i].rotation.x = 1.28 * crouch + (running ? Math.max(0, -step) * 0.43 : 0)
    player.arms[i].rotation.x = shooting ? -2.24 : handOnBall ? -0.57 - 0.20 * Math.cos(elapsed * 13) : -0.35 - step * 0.22
    player.arms[i].rotation.z = shooting ? side * 0.06 : side * (handOnBall ? 0.23 : 0.35)
    player.elbows[i].rotation.x = shooting ? -0.40 - 0.20 * (airborne > 0) : handOnBall ? -0.38 : -0.51

    if (protecting && handOnBall) {
      player.arms[i].rotation.x = post ? -0.56 : 0.95
      player.arms[i].rotation.z = side * 0.32
      player.elbows[i].rotation.x = -0.55
    }

    if (fake) {
      player.arms[i].rotation.x = -0.45 - fakeLift * 1.85
      player.arms[i].rotation.z = side * 0.08
      player.elbows[i].rotation.x = -0.48 - fakeLift * 0.23
      player.knees[i].rotation.x += fakeLift * 0.32
    }

    if (post) {
      player.legs[i].rotation.x = -0.60 + step * postEffort * 0.33
      player.knees[i].rotation.x = 1.10 + postEffort * 0.24
      player.arms[i].rotation.x = handOnBall ? -0.54 - 0.16 * postBounce : -0.36
      player.arms[i].rotation.z = side * 0.33
    }

    if (crossover) {
      const sending = side === ballSide
      player.arms[i].rotation.x = sending ? -0.71 : -0.84
      player.arms[i].rotation.z = side * (0.23 - Math.sin(crossProgress * Math.PI) * 0.36)
      player.elbows[i].rotation.x = sending ? -0.36 : -0.48
    }

    if (dunk) {
      const raise = THREE.MathUtils.smoothstep(dunk.time, 0, 0.25) *
        (1 - THREE.MathUtils.smoothstep(dunk.time, dunkRelease, 0.69))
      player.legs[i].rotation.x = -dunkLift * (i === 0 ? 0.78 : 0.32)
      player.knees[i].rotation.x = dunkLift * (i === 0 ? 0.72 : 1.05)
      const slam = THREE.MathUtils.smoothstep(dunk.time, dunkRelease - 0.035, dunkRelease + 0.11)
      player.arms[i].rotation.x = -0.48 - raise * (2.06 - 0.94 * slam)
      player.arms[i].rotation.z = side * (0.18 + 0.17 * raise)
      player.elbows[i].rotation.x = -0.29 - 0.24 * slam
    }

    player.feet[i].rotation.x = -(player.legs[i].rotation.x + player.knees[i].rotation.x)
    player.feet[i].rotation.z = -player.legs[i].rotation.z * 0.75

    const shuffle = shuffling ? Math.sin(robotStride) : 0
    robot.legs[i].rotation.x = -0.13 - 0.69 * defenderCrouch + (chasing ? side * shuffle * 0.48 : 0)
    robot.legs[i].rotation.z = defenderCrouch * (side * 0.35 + (chasing ? 0 : shuffle * 0.14))
    robot.knees[i].rotation.x = 0.23 + defenderCrouch * (1.20 + Math.max(0, side * shuffle) * 0.23)
    robot.feet[i].rotation.x = -(robot.legs[i].rotation.x + robot.knees[i].rotation.x)
    robot.feet[i].rotation.z = -robot.legs[i].rotation.z * 0.78
    robot.arms[i].rotation.x = defend === "block" ? (jumping ? -2.42 : -1.1)
      : defend === "steal" ? (defendTime >= stealReadyAt ? -1.37 : -0.58) : -0.35
    if (post) robot.arms[i].rotation.x = -0.72 - 0.30 * postEffort
    robot.arms[i].rotation.z = side * (defend === "block" ? 0.17 : 0.45)
    robot.elbows[i].rotation.x = defend === "block" ? -0.19 : defend === "steal" && defendTime >= stealReadyAt ? -0.15 : -0.52
  }
  plantStance(player)
  plantStance(robot)
  if (defend === "steal" && defendTime >= stealReadyAt) {
    const arm = robot.arms[stealHand]
    robot.torso.worldToLocal(handAim.copy(ball.position)).sub(arm.position).normalize()
    reachRotation.setFromUnitVectors(downArm, handAim)
    arm.quaternion.slerp(reachRotation, THREE.MathUtils.smoothstep(defendTime, stealReadyAt, stealReadyAt + 0.065))
  }
  player.marker.scale.setScalar(dash > 0 && phase === "play" ? 1.22 : 1)
  player.marker.position.set(player.root.position.x, 0, player.root.position.z)
  robot.marker.position.set(robot.root.position.x, 0, robot.root.position.z)
}

function updateHeldBall(elapsed) {
  const hand = player.hands[ballSide < 0 ? 0 : 1]
  hand.getWorldPosition(ball.position)
  if (charge || fake) {
    ball.position.y += 0.065
    return
  }
  if (!post && !dribble && isProtectingBall()) {
    ball.position.y += 0.045
    return
  }
  if (dribble) {
    const progress = clamp(dribble.time / spinDuration, 0, 1)
    player.hands[dribble.toHand < 0 ? 0 : 1].getWorldPosition(dribbleHand)
    ball.position.lerp(dribbleHand, THREE.MathUtils.smoothstep(progress, 0.32, 0.69))
    ball.position.y = progress < 0.5
      ? THREE.MathUtils.lerp(dribble.startHeight, 0.13, progress * 2)
      : THREE.MathUtils.lerp(0.13, dribbleHand.y, progress * 2 - 1)
    return
  }
  if (crossover) {
    const progress = clamp((elapsed - crossover.started) / crossoverDuration, 0, 1)
    player.hands[crossover.toHand < 0 ? 0 : 1].getWorldPosition(dribbleHand)
    ball.position.lerp(dribbleHand, THREE.MathUtils.smoothstep(progress, 0, 1))
    const forward = 0.13 * Math.sin(Math.PI * progress)
    ball.position.x += Math.sin(player.root.rotation.y) * forward
    ball.position.z += Math.cos(player.root.rotation.y) * forward
    ball.position.y = progress < 0.5
      ? THREE.MathUtils.lerp(crossover.height, 0.13, progress * 2)
      : THREE.MathUtils.lerp(0.13, dribbleHand.y, progress * 2 - 1)
  } else {
    const bounce = Math.abs(Math.cos((elapsed - bounceStarted) * (post ? postBounceRate : 6.8)))
    ball.position.y = THREE.MathUtils.lerp(0.13, ball.position.y, bounce)
  }
}

function updateFlight(dt) {
  previousBall.copy(ball.position)
  shot.time += dt
  ball.position.copy(shot.origin).addScaledVector(shot.velocity, shot.time)
  ball.position.y -= 0.5 * gravity * shot.time ** 2
  const inReach = defend === "block" && defendTime > 0.14 && defendTime < 0.58
  if (!shot.blocked && !shot.made && shot.time < 0.38 && (shot.smothered || inReach)) {
    segment.set(previousBall, ball.position)
    closest.copy(previousBall)
    const touched = shot.smothered || robot.hands.some((hand) => {
      hand.getWorldPosition(robotHand)
      segment.closestPointToPoint(robotHand, true, closest)
      return closest.distanceTo(robotHand) < 0.53
    })
    if (touched) {
      shot.blocked = true
      shot.origin.copy(closest)
      ball.position.copy(closest)
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
      registerBasket(shot.points, "进球！ +" + shot.points)
    }
  }

  if (ball.position.y <= 0.12) {
    ball.position.y = 0.12
    finishRound(shot.made ? "进球！ +" + shot.points : shot.blocked ? "被封盖" : "投篮未进")
  }
}

function updatePlay(dt, elapsed) {
  previousDribbleBall.copy(ball.position)
  if (defend === "steal") getPalm(stealHand, previousPalm)
  remaining = Math.max(0, remaining - dt)
  ui.clock.textContent = timestamp()
  ui.clock.classList.toggle("urgent", remaining < 4)
  fakeCooldown = Math.max(0, fakeCooldown - dt)
  if (fake) {
    fake += dt
    if (fake >= fakeDuration) {
      fake = 0
      bounceStarted = elapsed
    }
  }
  advancePlayer(dt, elapsed)
  const position = player.root.position
  if (post) {
    face(player, robot.root.position.x, robot.root.position.z)
    player.root.rotation.y += Math.PI
  } else {
    face(player, 0, rim.z)
  }
  if (dribble) {
    dribble.time += dt
    if (dribble.time >= spinDuration) {
      ballSide = dribble.toHand
      bounceStarted = elapsed
      dribble = null
    } else {
      const progress = THREE.MathUtils.smoothstep(dribble.time / spinDuration, 0, 1)
      player.root.rotation.y += dribble.side * dribble.sweep * (1 - progress)
    }
  }
  if (!fake && !charge && !post && !dribble && !fakeCooldown && input.pressed("fake") && remaining > 0) {
    finishCrossover(elapsed, true)
    fake = Number.EPSILON
    fakeCooldown = 0.90
    dash = 0
    ui.callout.textContent = "投篮假动作"
  }
  if (!fake && !charge && !post && !dribble && input.pressed("jump") && remaining > 0) {
    finishCrossover(elapsed, true)
    if (canDunk()) {
      startDunk()
      return
    }
    charge = Number.EPSILON
    dash = 0
  }
  if (charge) charge += dt
  updateHeldBall(elapsed)
  updateRobot(dt, elapsed)
  pose(dt, elapsed)
  updateHeldBall(elapsed)
  resolveSteal(dt, elapsed)
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
  ui.summary.textContent = "10 个进攻回合，每回合 12 秒。拖动左半屏移动。左右移动会自动换手，快速反向可以变向，按住投篮并在绿色区域松手。"
}
ui.start.addEventListener("click", startMatch)
for (const [button, code] of [[ui.dash, "TouchDash"], [ui.spin, "TouchSpin"], [ui.post, "TouchPost"], [ui.fake, "TouchFake"], [ui.shoot, "Space"]]) {
  button.addEventListener("pointerdown", (event) => {
    button.setPointerCapture(event.pointerId)
    input.press(code)
  })
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    button.addEventListener(type, () => input.release(code))
  }
}

function setCameraMode(useFirstPerson) {
  if (firstPerson === useFirstPerson) return
  firstPerson = useFirstPerson
  cameraChanged = true
  player.head.visible = !firstPerson
  player.marker.visible = !firstPerson
  engine.camera.fov = firstPerson ? 72 : 48
  engine.camera.near = firstPerson ? 0.06 : 0.1
  engine.camera.updateProjectionMatrix()
  ui["first-person"].setAttribute("aria-pressed", String(firstPerson))
  ui["third-person"].setAttribute("aria-pressed", String(!firstPerson))
}

function updateCamera(dt) {
  engine.camera.position.sub(shakeOffset.position)
  const position = player.root.position
  const portrait = engine.camera.aspect < 0.85
  if (firstPerson) {
    cameraGoal.set(-position.x, 0, rim.z - position.z)
    const distance = cameraGoal.length()
    // Keep the aim stable through spin moves and when standing under the hoop.
    if (distance > 0.45) viewDirection.copy(cameraGoal).divideScalar(distance)
    cameraGoal.copy(position).addScaledVector(viewDirection, 0.18)
    const eyeHeight = position.y + 1.63 + player.rig.position.y * 0.80
    cameraGoal.y = cameraChanged ? eyeHeight
      : THREE.MathUtils.lerp(engine.camera.position.y, eyeHeight, 1 - Math.exp(-16 * dt))
    engine.camera.position.copy(cameraGoal)
    look.copy(cameraGoal).addScaledVector(viewDirection, 3)
    const rimSlope = (rim.y - cameraGoal.y) / Math.max(0.55, distance - 0.18)
    look.y += 3 * clamp(rimSlope * 0.72 - 0.24, -0.18, 1.9)
  } else {
    cameraGoal.set(1.95 + position.x * 0.41, portrait ? 8.5 : 6.9, position.z * 0.58 + (portrait ? 12.5 : 10.3))
    engine.camera.position.lerp(cameraGoal, cameraChanged ? 1 : 1 - Math.exp(-5 * dt))
    look.set(position.x * 0.42, 0.85, (position.z + rim.z) * 0.5)
  }
  engine.camera.lookAt(look)
  shakeOffset.position.set(0, 0, 0)
  dunkShake.update(dt)
  engine.camera.position.add(shakeOffset.position)
  cameraChanged = false
}

ui["first-person"].addEventListener("click", () => setCameraMode(true))
ui["third-person"].addEventListener("click", () => setCameraMode(false))

prepareRound()
engine.onUpdate((dt, elapsed) => {
  if (input.pressed("camera")) setCameraMode(!firstPerson)
  if (input.pressed("restart")) startMatch()
  const ballInFlight = phase === "flight" || phase === "dunk"
  if (ballInFlight) netPreviousBall.copy(ball.position)
  if (phase === "play") updatePlay(dt, elapsed)
  else if (phase === "dunk") updateDunk(dt, elapsed)
  else if (phase === "flight") {
    updateRobot(dt)
    pose(dt)
    updateFlight(dt)
  } else if (phase === "result") {
    pose(dt)
    resultTime -= dt
    if (resultTime <= 0) nextRound()
  }
  net.update(dt, netPreviousBall, ballInFlight ? ball.position : null)
  const dunkReady = phase === "play" && canDunk()
  dunkZone.material.opacity = dunkReady ? 0.52 : 0.27
  impactLight.intensity *= Math.exp(-12 * dt)
  ui["dunk-hint"].hidden = !dunkReady
  ui.shoot.textContent = dunkReady ? "扣篮" : "投篮"
  ui.post.setAttribute("aria-pressed", String(Boolean(post)))
  const sprinting = phase === "play" && dash > 0
  ui["dash-key"].classList.toggle("sprinting", sprinting)
  ui.dash.classList.toggle("sprinting", sprinting)
  ball.rotation.x += dt * (phase === "flight" ? 8 : 2)
  updateCamera(dt)
})
engine.start()
