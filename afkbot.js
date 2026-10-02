const bedrock = require('bedrock-protocol')
const startPanel = require('./panel')
const {
  sleep, clean, itemText, waitFor, parseOrder,
  getDir, lineBlocks, faceFor, slotRef
} = require('./tools')

// ===== SETTINGS =====
const SERVER = process.env.MC_SERVER || 'play.frostsmp.net'
const PORT = parseInt(process.env.MC_PORT || '19132')
const EMAIL = process.env.MC_EMAIL || 'ebos2207@gmail.com'
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || 'changeme'
const WEB_PORT = process.env.PORT || 3000
const LOGIN_DIR = process.env.LOGIN_DIR || './login'
const HOME_COMMAND = process.env.HOME_COMMAND || '/home 1'
const ORDER_COMMAND = process.env.ORDER_COMMAND || '/order bone'
const MIN_BONE_PRICE = parseFloat(process.env.MIN_BONE_PRICE || '80')
const RECHECK_MIN = parseFloat(process.env.RECHECK_MIN || '5')
const DRY_RUN = (process.env.DRY_RUN || 'true') !== 'false'
const SNEAK = (process.env.SNEAK || 'true') !== 'false'
const REACH = parseFloat(process.env.REACH || '6')
// ====================

let enabled = true
let status = 'offline'
let client = null
let reconnectTimer = null
let waitTime = 15000
let lastStop = 0
let ridCounter = -1
const logs = []

function log(msg) {
  const text = clean(msg)
  if (!text) return
  const line = new Date().toLocaleTimeString() + '  ' + text
  console.log(line)
  logs.push(line)
  if (logs.length > 200) logs.shift()
}

// Safety net: show stray errors in the log instead of crashing
process.on('uncaughtException', (e) => log('Error caught: ' + (e && e.message ? e.message : e)))
process.on('unhandledRejection', (e) => log('Error caught: ' + (e && e.message ? e.message : e)))

async function sleepAlive(c, ms) {
  const end = Date.now() + ms
  while (!c.__dead && Date.now() < end) await sleep(500)
}

function sendCommand(c, cmd) {
  const uuid = '00000000-0000-0000-0000-000000000000'
  for (const version of ['52', 'latest', '1', 52]) {
    try {
      c.queue('command_request', {
        command: cmd,
        origin: { type: 'player', uuid, request_id: '' },
        internal: false,
        version
      })
      log('Sent ' + cmd)
      return true
    } catch (e) {}
  }
  log('Could not send ' + cmd)
  return false
}

function countBones(c) {
  if (!c.__boneId) return 0
  return (c.__inv || []).reduce((n, it) => n + (it && it.network_id === c.__boneId ? it.count : 0), 0)
}

function sneak(c, on) {
  if (!SNEAK) return
  try {
    const z = { x: 0, y: 0, z: 0 }
    c.queue('player_action', {
      runtime_entity_id: c.__rid,
      action: on ? 'start_sneak' : 'stop_sneak',
      position: z,
      result_position: z,
      face: 0
    })
    log(on ? 'Crouching' : 'Stopped crouching')
  } catch (e) {
    log('Crouch failed: ' + String(e.message).slice(0, 120))
  }
}

// ---------- menus & clicks ----------
function stackRequest(c, actions) {
  const req = { request_id: ridCounter, actions, custom_names: [], cause: -1 }
  ridCounter -= 2
  try {
    c.queue('item_stack_request', { requests: [req] })
    return true
  } catch (e) {
    if (!c.__stackErr) {
      c.__stackErr = true
      log('Click error: ' + String(e.message).slice(0, 140))
    }
    return false
  }
}

function clickMenuSlot(c, slot, item) {
  return stackRequest(c, [{
    type_id: 'take',
    count: Math.max(1, item.count || 1),
    source: slotRef('level_entity', slot, item.stack_id),
    destination: slotRef('cursor', 0, 0)
  }])
}

function takeToInventory(c, slot, item, invSlot) {
  return stackRequest(c, [{
    type_id: 'take',
    count: item.count,
    source: slotRef('level_entity', slot, item.stack_id),
    destination: slotRef('combined_hotbar_and_inventory', invSlot, 0)
  }])
}

function rightClickBlock(c, pos, face) {
  try {
    c.queue('inventory_transaction', {
      transaction: {
        legacy: { legacy_request_id: 0 },
        transaction_type: 'item_use',
        actions: [],
        transaction_data: {
          action_type: 'click_block',
          trigger_type: 'player_input',
          block_position: { x: pos.x, y: pos.y, z: pos.z },
          face,
          hotbar_slot: 0,
          held_item: { network_id: 0 },
          player_pos: c.__pos || { x: pos.x + 0.5, y: pos.y + 1, z: pos.z + 0.5 },
          click_pos: { x: 0.5, y: 0.5, z: 0.5 },
          block_runtime_id: 0,
          client_prediction: 'success'
        }
      }
    })
    return true
  } catch (e) {
    if (!c.__clickErr) {
      c.__clickErr = true
      log('Block click failed: ' + String(e.message).slice(0, 140))
    }
    return false
  }
}

async function openWindow(c, doOpen, label, timeout, quiet) {
  c.__win = null
  doOpen()
  const ok = await waitFor(() => c.__dead || (c.__win && c.__win.items.length > 0), timeout || 12000)
  if (!ok || c.__dead) {
    if (!quiet) log('Menu did not open: ' + label)
    return null
  }
  await sleep(1200)
  return c.__win
}

function closeWindow(c) {
  const w = c.__win
  if (!w) return
  try { c.queue('container_close', { window_id: w.id, window_type: w.type, server: false }) } catch (e) {}
  c.__win = null
}

// ---------- the work ----------
function pickBest(win) {
  const orders = []
  win.items.forEach((item, slot) => {
    if (!item || !item.network_id) return
    const o = parseOrder(item)
    if (o) orders.push({ slot, item, ...o })
  })
  const valid = orders.filter((o) => !isNaN(o.price) && !o.done)
  // only orders at or above the minimum, highest price first
  const good = valid.filter((o) => o.price >= MIN_BONE_PRICE).sort((a, b) => b.price - a.price)
  const low = [...new Set(valid.filter((o) => o.price < MIN_BONE_PRICE).map((o) => o.price))].slice(0, 8)
  const unreadable = orders.filter((o) => isNaN(o.price)).length
  log('Bone orders: ' + orders.length + ' | good (>= $' + MIN_BONE_PRICE + '): ' + good.length +
    (good[0] ? ' | best: $' + good[0].price : '') +
    (low.length ? ' | skipped low: $' + low.join(', $') : '') +
    (unreadable ? ' | unreadable: ' + unreadable : ''))
  return good[0] || null
}

async function openSpawner(c) {
  if (!c.__pos || !c.__rot) {
    log('No position/direction yet, cannot look for the spawner.')
    return null
  }
  const dir = getDir(c.__rot)
  const face = faceFor(dir)
  const list = lineBlocks(c.__pos, dir, REACH)
  if (c.__spawnerBlock) list.unshift(c.__spawnerBlock)
  log('Looking for the spawner along the crosshair (' + list.length + ' blocks)...')

  for (const b of list) {
    if (c.__dead) return null
    const w = await openWindow(c, () => rightClickBlock(c, b, face), 'block', 2500, true)
    if (!w) continue
    const st = w.items.findIndex((it) => it && it.network_id && /SPAWNER STORAGE/i.test(itemText(it)))
    if (st >= 0) {
      c.__spawnerBlock = { x: b.x, y: b.y, z: b.z }
      log('Spawner found at ' + b.x + ', ' + b.y + ', ' + b.z)
      return { win: w, st }
    }
    closeWindow(c)
    await sleep(400)
  }
  log('Spawner not found along the crosshair. Check /sethome 1 faces the spawner.')
  return null
}

async function harvest(c) {
  const sp = await openSpawner(c)
  if (!sp) return 0

  const storage = await openWindow(c, () => clickMenuSlot(c, sp.st, sp.win.items[sp.st]), 'storage')
  if (!storage) return 0

  const stacks = []
  storage.items.forEach((it, slot) => {
    if (it && it.network_id && it.network_id === c.__boneId && it.count > 0) stacks.push({ slot, it })
  })
  const total = stacks.reduce((n, s) => n + s.it.count, 0)
  log('Storage has ' + total + ' bones in ' + stacks.length + ' stacks.')

  if (DRY_RUN) {
    closeWindow(c)
    return 0
  }

  const free = []
  for (let i = 0; i < 36; i++) {
    const it = (c.__inv || [])[i]
    if (!it || !it.network_id) free.push(i)
  }
  const room = Math.max(0, free.length - 2)
  let moved = 0
  for (let i = 0; i < Math.min(room, stacks.length); i++) {
    if (takeToInventory(c, stacks[i].slot, stacks[i].it, free[i])) moved += stacks[i].it.count
    await sleep(300)
  }
  await sleep(2000)
  closeWindow(c)
  log('Took about ' + moved + ' bones. Inventory now has ' + countBones(c) + '.')
  return moved
}

async function deliver(c) {
  const win = await openWindow(c, () => sendCommand(c, ORDER_COMMAND), 'orders')
  if (!win) return 0
  const best = pickBest(win)
  if (!best) {
    closeWindow(c)
    return 0
  }
  if (DRY_RUN) {
    log('TEST MODE: would deliver to ' + best.owner + ' at $' + best.price + ' each.')
    closeWindow(c)
    return 0
  }
  const before = countBones(c)
  if (before === 0) {
    log('No bones in inventory to deliver.')
    closeWindow(c)
    return 0
  }
  log('Delivering to ' + best.owner + ' at $' + best.price + ' each...')
  clickMenuSlot(c, best.slot, best.item)
  await sleep(4000)

  if (c.__win && c.__win !== win) {
    log('A new menu opened after the click (send me these lines):')
    c.__win.items.forEach((it, i) => {
      if (it && it.network_id && i < 54) log('  slot ' + i + ': ' + itemText(it).slice(0, 140))
    })
  }
  const after = countBones(c)
  log('Delivered ' + (before - after) + ' bones. Left: ' + after)
  closeWindow(c)
  return before - after
}

async function cycle(c) {
  log('--- Check started ---')

  // 1. Go home, wait for the teleport, then crouch
  const before = c.__tpAt || 0
  sendCommand(c, HOME_COMMAND)
  const tp = await waitFor(() => c.__dead || (c.__tpAt || 0) > before, 10000)
  if (!tp) log('No teleport detected. Is /home 1 set on this account?')
  await sleepAlive(c, 2500)
  if (c.__dead) return false
  sneak(c, true)
  await sleepAlive(c, 1500)
  if (c.__pos && c.__rot) {
    log('Standing at ' + Math.round(c.__pos.x) + ', ' + Math.round(c.__pos.y) + ', ' + Math.round(c.__pos.z) +
      ' | yaw ' + Math.round(c.__rot.head_yaw != null ? c.__rot.head_yaw : c.__rot.yaw) + ' pitch ' + Math.round(c.__rot.pitch))
  }

  // 2. Only continue if there is a good order (never sell to cheap orders)
  const w = await openWindow(c, () => sendCommand(c, ORDER_COMMAND), 'orders')
  if (!w) return false
  const best = pickBest(w)
  closeWindow(c)
  if (!best) {
    log('No order at or above $' + MIN_BONE_PRICE + '. Bones stay in storage.')
    return false
  }

  // 3. Get bones (unless the inventory already has some)
  if (countBones(c) === 0) await harvest(c)
  else log('Inventory already has ' + countBones(c) + ' bones.')

  // 4. Deliver to the highest-paying order
  const sent = await deliver(c)
  return sent > 0
}

async function runLoop(c) {
  await sleepAlive(c, 8000)
  while (!c.__dead) {
    let again = false
    try {
      again = await cycle(c)
    } catch (e) {
      log('Cycle error: ' + e.message)
    }
    await sleepAlive(c, again ? 10000 : RECHECK_MIN * 60000)
  }
}

// ---------- connection ----------
function killClient(c) {
  c.__dead = true
  try { if (typeof c.disconnect === 'function') c.disconnect() } catch (e) {}
  try { c.close() } catch (e) {}
}

function start() {
  if (!enabled || client) return
  status = 'connecting'
  log('Connecting to ' + SERVER + ':' + PORT + (DRY_RUN ? ' (TEST MODE)' : ''))

  let c
  try {
    c = bedrock.createClient({
      host: SERVER,
      port: PORT,
      username: EMAIL,
      offline: false,
      profilesFolder: LOGIN_DIR,
      onMsaCode: (data) => {
        log('SIGN IN NEEDED: open ' + data.verification_uri + ' and enter code ' + data.user_code)
      }
    })
  } catch (e) {
    log('Start error: ' + e.message)
    status = 'offline'
    if (enabled) {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(() => { reconnectTimer = null; start() }, waitTime)
    }
    return
  }
  client = c
  c.__inv = []
  c.__win = null

  let ended = false
  function onEnd() {
    if (c.__dead || ended) return
    ended = true
    c.__dead = true
    if (client === c) client = null
    status = 'offline'
    try { c.close() } catch (e) {}
    if (enabled) {
      const delay = c.__alreadyIn ? 60000 : waitTime
      log('Disconnected. Reconnecting in ' + delay / 1000 + 's...')
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(() => { reconnectTimer = null; start() }, delay)
      if (!c.__alreadyIn) waitTime = Math.min(waitTime * 2, 300000)
    }
  }

  c.on('start_game', (p) => {
    c.__pos = p.player_position
    c.__rid = p.runtime_entity_id
    c.__myId = String(p.runtime_entity_id)
    if (p.rotation) c.__rot = { pitch: p.rotation.x, yaw: p.rotation.z }
    const bone = (p.itemstates || []).find((i) => i.name === 'minecraft:bone')
    if (bone) c.__boneId = bone.runtime_id
    else log('Could not find the bone item id.')
  })
  c.on('move_player', (p) => {
    if (String(p.runtime_id) !== c.__myId) return
    c.__pos = p.position
    c.__rot = { pitch: p.pitch, yaw: p.yaw, head_yaw: p.head_yaw }
    if (p.mode === 'teleport') c.__tpAt = Date.now()
  })

  c.on('container_open', (p) => {
    c.__win = { id: p.window_id, type: p.window_type, items: [] }
  })
  c.on('container_close', (p) => {
    if (c.__win && String(p.window_id) === String(c.__win.id)) c.__win = null
  })
  c.on('inventory_content', (p) => {
    if (p.window_id === 'inventory') c.__inv = p.input || []
    else if (c.__win && String(p.window_id) === String(c.__win.id)) c.__win.items = p.input || []
  })
  c.on('inventory_slot', (p) => {
    if (p.window_id === 'inventory') c.__inv[p.slot] = p.item
    else if (c.__win && String(p.window_id) === String(c.__win.id)) c.__win.items[p.slot] = p.item
  })
  c.on('item_stack_response', (p) => {
    ;(p.responses || []).forEach((r) => {
      if (r.status && r.status !== 'ok' && (c.__respLogs = (c.__respLogs || 0) + 1) <= 4) {
        log('Server refused a click: ' + r.status)
      }
    })
  })

  c.on('spawn', () => {
    if (c.__dead) return
    status = 'online'
    waitTime = 15000
    log('Joined the server!')
    runLoop(c)
  })

  c.on('kick', (r) => {
    if (c.__dead) return
    const text = JSON.stringify(r)
    if (/already logged in/i.test(text)) {
      c.__alreadyIn = true
      log('Account already logged in somewhere else.')
    } else {
      log('Kicked: ' + text)
    }
  })
  c.on('error', (e) => { if (!c.__dead) log('Error: ' + e.message) })
  c.on('close', onEnd)
  c.on('disconnect', onEnd)
}

function stop() {
  enabled = false
  lastStop = Date.now()
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  if (client) {
    const c = client
    client = null
    killClient(c)
  }
  status = 'offline'
  log('Turned OFF')
}

function turnOn() {
  enabled = true
  waitTime = 15000
  const wait = Math.max(0, lastStop + 20000 - Date.now())
  log(wait > 0 ? 'Turned ON (starting in ' + Math.ceil(wait / 1000) + 's)' : 'Turned ON')
  status = 'connecting'
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(() => { reconnectTimer = null; start() }, wait)
}

// ---------- control page ----------
startPanel({
  port: WEB_PORT,
  password: PANEL_PASSWORD,
  log,
  getState: () => ({ enabled, status, logs }),
  toggle: () => { if (enabled) stop(); else turnOn() }
})

// Pings its own URL so Render's free plan sleeps less (Render sets this variable itself)
const SELF_URL = process.env.RENDER_EXTERNAL_URL
if (SELF_URL) {
  setInterval(() => { fetch(SELF_URL).catch(() => {}) }, 10 * 60 * 1000)
}

start()
