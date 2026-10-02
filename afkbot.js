const bedrock = require('bedrock-protocol')
const http = require('http')

// ===== SETTINGS =====
const SERVER = process.env.MC_SERVER || 'play.frostsmp.net'
const PORT = parseInt(process.env.MC_PORT || '19132')
const EMAIL = process.env.MC_EMAIL || 'ebos2207@gmail.com'
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || 'changeme'
const WEB_PORT = process.env.PORT || 3000
const CHAT_FALLBACK = (process.env.AFK_CHAT_FALLBACK || 'true') === 'true'
const SHOW_CHAT = (process.env.SHOW_CHAT || 'false') === 'true'
// ====================

let enabled = true
let status = 'offline'
let client = null
let reconnectTimer = null
let waitTime = 15000
let lastStop = 0
const logs = []

function clean(msg) {
  return String(msg).replace(/§./g, '').replace(/\s+/g, ' ').trim()
}

function log(msg) {
  const text = clean(msg)
  if (!text) return
  const line = new Date().toLocaleTimeString() + '  ' + text
  console.log(line)
  logs.push(line)
  if (logs.length > 150) logs.shift()
}

// Server chat is hidden unless SHOW_CHAT=true
function chat(msg) {
  if (!SHOW_CHAT) return
  const text = clean(msg)
  if (!text || !text.includes(' ▶ ')) return
  log(text)
}

function sendAfk(c) {
  const uuid = '00000000-0000-0000-0000-000000000000'
  const versions = ['52', 'latest', '1', 52]
  const origins = [
    { type: 'player', uuid, request_id: '' },
    { type: 'player', uuid, request_id: '', player_entity_id: 0 }
  ]
  const errors = []

  for (const origin of origins) {
    for (const version of versions) {
      try {
        c.queue('command_request', {
          command: '/afk',
          origin,
          internal: false,
          version
        })
        log('Sent /afk command (version ' + version + ')')
        return
      } catch (e) {
        const m = String(e.message).slice(0, 90)
        if (!errors.includes(m)) errors.push(m)
      }
    }
  }

  errors.forEach((m) => log('Command error: ' + m))

  if (!CHAT_FALLBACK) {
    log('Chat fallback is OFF, /afk not sent.')
    return
  }

  try {
    c.queue('text', {
      type: 'chat',
      needs_translation: false,
      source_name: c.username || '',
      xuid: '',
      platform_chat_id: '',
      filtered_message: '',
      message: '/afk'
    })
    log('Sent /afk as chat (fallback)')
  } catch (e) {
    log('Chat fallback failed: ' + e.message)
  }
}

function killClient(c) {
  c.__dead = true
  try { if (typeof c.disconnect === 'function') c.disconnect() } catch (e) {}
  try { c.close() } catch (e) {}
}

function start() {
  if (!enabled || client) return
  status = 'connecting'
  log('Connecting to ' + SERVER + ':' + PORT)

  let c
  try {
    c = bedrock.createClient({
      host: SERVER,
      port: PORT,
      username: EMAIL,
      offline: false,
      profilesFolder: './login',
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

  let ended = false
  function onEnd() {
    if (c.__dead || ended) return
    ended = true
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

  c.on('spawn', () => {
    if (c.__dead) return
    status = 'online'
    waitTime = 15000
    log('Joined the server!')
    setTimeout(() => { if (!c.__dead) sendAfk(c) }, 5000)
  })
  c.on('text', (p) => { if (!c.__dead && p.message) chat(p.message) })
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

const PAGE = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Frost AFK Bot</title>
<style>
body{font-family:sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:16px;text-align:center}
h2{margin:8px 0}
#dot{display:inline-block;width:14px;height:14px;border-radius:50%;background:#ef4444;margin-right:8px}
#btn{font-size:20px;padding:16px 40px;border:0;border-radius:12px;background:#22c55e;color:#fff;margin:16px 0}
#btn.off{background:#ef4444}
input{font-size:16px;padding:10px;border-radius:8px;border:0;width:70%}
#log{background:#020617;color:#86efac;font-family:monospace;font-size:12px;text-align:left;height:50vh;overflow:auto;padding:10px;border-radius:8px;white-space:pre-wrap}
</style></head><body>
<h2>Frost AFK Bot</h2>
<div id="login"><input id="pw" type="password" placeholder="Password"><br><br><button onclick="saveKey()">Enter</button></div>
<div id="panel" style="display:none">
<div><span id="dot"></span><span id="st">...</span></div>
<button id="btn" onclick="toggle()">...</button>
<div id="log"></div>
</div>
<script>
var key = localStorage.getItem('k') || ''
if (key) { document.getElementById('login').style.display = 'none'; document.getElementById('panel').style.display = 'block' }
function saveKey(){ key = document.getElementById('pw').value; localStorage.setItem('k', key); poll() }
function toggle(){ fetch('/api/toggle?key=' + encodeURIComponent(key), {method:'POST'}).then(poll) }
function showLogin(){ document.getElementById('login').style.display='block'; document.getElementById('panel').style.display='none' }
function poll(){
  fetch('/api/state?key=' + encodeURIComponent(key)).then(function(r){
    if(r.status === 401){ showLogin(); return }
    if(r.status !== 200){ document.getElementById('st').textContent = 'SERVER WAKING UP...'; return }
    return r.json().then(function(d){
      document.getElementById('login').style.display='none'
      document.getElementById('panel').style.display='block'
      var colors = {online:'#22c55e', connecting:'#f59e0b', offline:'#ef4444'}
      document.getElementById('dot').style.background = colors[d.status]
      document.getElementById('st').textContent = d.status.toUpperCase()
      var b = document.getElementById('btn')
      b.textContent = d.enabled ? 'Turn OFF' : 'Turn ON'
      b.className = d.enabled ? 'off' : ''
      var l = document.getElementById('log')
      var atEnd = l.scrollTop + l.clientHeight >= l.scrollHeight - 20
      l.textContent = d.logs.join('\\n')
      if(atEnd) l.scrollTop = l.scrollHeight
    })
  }).catch(function(){ document.getElementById('st').textContent = 'RECONNECTING...' })
}
poll(); setInterval(poll, 2000)
</script></body></html>`

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')

    if (url.pathname.startsWith('/api/')) {
      if (url.searchParams.get('key') !== PANEL_PASSWORD) {
        res.writeHead(401)
        return res.end('Wrong password')
      }
      if (url.pathname === '/api/toggle' && req.method === 'POST') {
        if (enabled) stop()
        else turnOn()
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ enabled, status, logs }))
    }

    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(PAGE)
  })
  .listen(WEB_PORT, '0.0.0.0', () => log('Control page open on port ' + WEB_PORT))

// Pings its own URL so Render's free plan sleeps less (Render sets this variable itself)
const SELF_URL = process.env.RENDER_EXTERNAL_URL
if (SELF_URL) {
  setInterval(() => { fetch(SELF_URL).catch(() => {}) }, 10 * 60 * 1000)
}

start()


