import * as THREE from "three"

export function createBasketNet(rimY, rimZ) {
  const columns = 12
  const rows = 5
  const nodes = []
  const links = []
  const geometry = new THREE.BufferGeometry()
  const mesh = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: "#fff9ed" }))
  mesh.position.set(0, rimY, rimZ)
  mesh.frustumCulled = false

  function connect(a, b) {
    links.push({ a, b, length: a.rest.distanceTo(b.rest) })
  }

  for (let row = 0; row < rows; row++) {
    const progress = row / (rows - 1)
    const radius = THREE.MathUtils.lerp(0.235, 0.092, progress)
    for (let column = 0; column < columns; column++) {
      const angle = (column + (row % 2) * 0.5) / columns * Math.PI * 2
      const rest = new THREE.Vector3(radius * Math.cos(angle), -0.39 * progress, radius * Math.sin(angle))
      const node = { rest, position: rest.clone(), velocity: new THREE.Vector3(), pinned: row === 0 }
      nodes.push(node)
      if (row > 0) {
        const previousRow = (row - 1) * columns
        connect(node, nodes[previousRow + column])
        connect(node, nodes[previousRow + (column + (row % 2 ? 1 : columns - 1)) % columns])
      }
    }
  }
  for (let column = 0; column < columns; column++) {
    const bottom = (rows - 1) * columns
    connect(nodes[bottom + column], nodes[bottom + (column + 1) % columns])
  }

  const positions = new THREE.Float32BufferAttribute(links.length * 6, 3)
  positions.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute("position", positions)

  const direction = new THREE.Vector3()
  const sphere = new THREE.Vector3()
  const ballVelocity = new THREE.Vector3()
  const contactRadius = 0.132

  function writeGeometry() {
    for (let i = 0; i < links.length; i++) {
      const { a, b } = links[i]
      positions.setXYZ(i * 2, a.position.x, a.position.y, a.position.z)
      positions.setXYZ(i * 2 + 1, b.position.x, b.position.y, b.position.z)
    }
    positions.needsUpdate = true
  }

  function update(dt, previousBall, currentBall) {
    if (dt <= 0) return
    const steps = Math.ceil(dt * 240)
    const step = dt / steps
    const damping = Math.exp(-4.8 * step)
    if (currentBall) ballVelocity.copy(currentBall).sub(previousBall).divideScalar(dt)

    for (let i = 1; i <= steps; i++) {
      if (currentBall) sphere.copy(previousBall).lerp(currentBall, i / steps).sub(mesh.position)
      const nearNet = currentBall && sphere.y > -0.61 && sphere.y < 0.12 && Math.hypot(sphere.x, sphere.z) < 0.40
      for (const { a, b, length } of links) {
        direction.subVectors(b.position, a.position)
        const distance = direction.length()
        if (distance < 0.00001) continue
        // Knotted strands pull taut in tension and have a little slack in compression.
        const stretch = distance - length
        direction.multiplyScalar(stretch / distance * (stretch > 0 ? 240 : 45) * step)
        if (!a.pinned) a.velocity.add(direction)
        if (!b.pinned) b.velocity.sub(direction)
      }

      for (const node of nodes) {
        if (node.pinned) continue
        // The rest shape approximates a hanging net under its own weight.
        node.velocity.addScaledVector(direction.subVectors(node.rest, node.position), 32 * step)
        node.velocity.multiplyScalar(damping)
        node.position.addScaledVector(node.velocity, step)
        if (!nearNet) continue
        direction.subVectors(node.position, sphere)
        const distance = direction.length()
        if (distance >= contactRadius || distance < 0.00001) continue
        direction.divideScalar(distance)
        node.position.addScaledVector(direction, contactRadius - distance)
        const approach = direction.dot(ballVelocity) - direction.dot(node.velocity)
        if (approach > 0) {
          node.velocity.addScaledVector(direction, approach * 0.60)
          node.velocity.lerp(ballVelocity, 0.08)
        }
      }
    }
    writeGeometry()
  }

  writeGeometry()
  return { mesh, update }
}
