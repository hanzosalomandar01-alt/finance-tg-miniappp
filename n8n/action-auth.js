// ============================================================================
//  MiniApp Action — отметка задачи выполненной/невыполненной
//  Режим Code-ноды: "Run Once for All Items"
// ============================================================================

// ---------- 0. НАСТРОЙКИ ----------
// BOT_TOKEN вписывается ТОЛЬКО здесь, в n8n. Никогда не коммить его в git.
const BOT_TOKEN      = 'ВСТАВЬ_ТОКЕН_БОТА';  // от @BotFather
const TOKEN          = '';                   // доп. секрет; '' = не проверять
const ALLOWED_TG_IDS = [];                   // напр. [123456789]; пусто = любой юзер бота
const MAX_AGE_SEC    = 24 * 60 * 60;

// ---------- 1. АВТОРИЗАЦИЯ ПО ПОДПИСИ TELEGRAM ----------
const body = ($('Webhook').first().json.body) || {};

function checkAuth() {
  if (TOKEN && body.token !== TOKEN) return 'unauthorized';

  if (!BOT_TOKEN || BOT_TOKEN.indexOf('ВСТАВЬ') === 0) return 'bot token not set';

  let nodeCrypto;
  try { nodeCrypto = require('crypto'); }
  catch (e) { return 'crypto unavailable'; }

  const initData = String(body.initData || '');
  if (!initData) return 'no initData';

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return 'no hash';
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => k + '=' + v)
    .join('\n');

  const secretKey = nodeCrypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calcHash  = nodeCrypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (calcHash !== hash) return 'bad signature';

  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SEC) return 'expired';

  if (ALLOWED_TG_IDS.length) {
    let tgId = null;
    try { tgId = JSON.parse(params.get('user') || '{}').id; } catch (e) { /* ignore */ }
    if (!ALLOWED_TG_IDS.includes(Number(tgId))) return 'forbidden';
  }

  return null;
}

const denied = checkAuth();

if (denied) return [{ json: { ok: false, error: denied } }];
if (body.action !== 'task.setDone') {
  return [{ json: { ok: false, error: 'unknown action' } }];
}

const taskId = String(body.id || '').trim();
if (!taskId) {
  return [{ json: { ok: false, error: 'no task id' } }];
}

return [{
  json: {
    ok: true,
    taskId,
    status: body.done ? 'completed' : 'needsAction',
  },
}];
