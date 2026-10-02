const http = require('http')

const PAGE = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Frost Spawner Bot</title>
<style>
body{font-family:sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:16px;text-align:center}
h2{margin:8px 0}
#dot{display:inline-block;width:14px;height:14px;border-radius:50%;background:#ef4444;margin-right:8px}
#btn{font-size:20px;padding:16px 40px;border:0;border-radius:12px;background:#22c55e;color:#fff;margin:16px 0}
#btn.off{background:#ef4444}
input{font-size:16px;padding:10px;border-radius:8px;border:0;width:70%}
#log{background:#020617;color:#86efac;font-family:monospace;font-size:12px;text-align:left;height:50vh;overflow:auto;padding:10px;border-radius:8px;white-space:pre-wrap}
</style></head><body>
<h2>Frost Spawner Bot</h2>
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

module.exports = function startPanel(opts) {
  http
    .createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost')

      if (url.pathname.startsWith('/api/')) {
        if (url.searchParams.get('key') !== opts.password) {
          res.writeHead(401)
          return res.end('Wrong password')
        }
        if (url.pathname === '/api/toggle' && req.method === 'POST') {
          opts.toggle()
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify(opts.getState()))
      }

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(PAGE)
    })
    .listen(opts.port, '0.0.0.0', () => opts.log('Control page open on port ' + opts.port))
}
