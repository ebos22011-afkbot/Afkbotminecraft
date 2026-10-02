const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function clean(msg) {
  return String(msg).replace(/§./g, '').replace(/\s+/g, ' ').trim()
}

function short(obj, n) {
  try {
    return JSON.stringify(obj, (k, v) => (typeof v === 'bigint' ? v.toString() : v)).slice(0, n)
  } catch (e) {
    return String(obj).slice(0, n)
  }
}

function itemText(item) {
  return clean(short(item, 4000))
}

async function waitFor(fn, ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (fn()) return true
    await sleep(250)
  }
  return false
}

function toNum(s, suf) {
  const n = parseFloat(String(s).replace(/,/g, ''))
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[String(suf || '').toUpperCase()] || 1
  return isNaN(n) ? NaN : n * mult
}

function parseOrder(item) {
  const t = itemText(item)
  if (!/Click to Deliver/i.test(t)) return null
  if (!/Item:\D{0,6}[\d.,]+\s*[KMB]?\s*x?\s*Bone\b(?!\s*(Meal|Block))/i.test(t)) return null
  const p = t.match(/Price Each:\D{0,6}([\d.,]+)\s*([KMB])?/i)
  if (!p) return { price: NaN, done: false, owner: '?' }
  const d = t.match(/Delivered:\D{0,3}([\d.,]+)\s*([KMB])?\s*\/\s*([\d.,]+)\s*([KMB])?/i)
  const done = d ? toNum(d[1], d[2]) >= toNum(d[3], d[4]) : false
  const o = t.match(/(\S+)'s Order/i)
  return { price: toNum(p[1], p[2]), done, owner: o ? o[1] : '?' }
}

function getDir(rot) {
  const yaw = ((rot.head_yaw != null ? rot.head_yaw : rot.yaw) || 0) * Math.PI / 180
  const pitch = (rot.pitch || 0) * Math.PI / 180
  return {
    x: -Math.sin(yaw) * Math.cos(pitch),
    y: -Math.sin(pitch),
    z: Math.cos(yaw) * Math.cos(pitch)
  }
}

function lineBlocks(pos, dir, reach) {
  const out = []
  for (let t = 0.8; t <= reach; t += 0.2) {
    const b = {
      x: Math.floor(pos.x + dir.x * t),
      y: Math.floor(pos.y + dir.y * t),
      z: Math.floor(pos.z + dir.z * t)
    }
    const k = b.x + ',' + b.y + ',' + b.z
    if (!out.some((o) => o.k === k)) out.push({ ...b, k })
  }
  return out
}

// face being clicked: 0 down, 1 up, 2 north, 3 south, 4 west, 5 east
function faceFor(dir) {
  const ax = Math.abs(dir.x), ay = Math.abs(dir.y), az = Math.abs(dir.z)
  if (ax >= ay && ax >= az) return dir.x > 0 ? 4 : 5
  if (ay >= az) return dir.y > 0 ? 0 : 1
  return dir.z > 0 ? 2 : 3
}

function slotRef(containerId, slot, stackId) {
  return { slot_type: { container_id: containerId }, slot, stack_id: stackId || 0 }
}

module.exports = {
  sleep,
  clean,
  itemText,
  waitFor,
  parseOrder,
  getDir,
  lineBlocks,
  faceFor,
  slotRef
}
