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
