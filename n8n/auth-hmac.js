// ============================================================================
//  ОБЩИЙ БЛОК АВТОРИЗАЦИИ для обоих воркфлоу
//  Проверяет подпись Telegram initData. Подделать её, не зная токен бота,
//  невозможно — поэтому публичный apiToken в исходнике страницы перестаёт
//  быть проблемой.
//
//  Этот файл — справочная копия. Рабочие версии вшиты в ноды:
//    Normalize (воркфлоу чтения)  и  Auth (воркфлоу записи)
//
//  ВАЖНО: BOT_TOKEN вписывается ТОЛЬКО в n8n. Никогда не коммить его в git.
// ============================================================================

const BOT_TOKEN      = 'ВСТАВЬ_ТОКЕН_БОТА';  // от @BotFather, как в Telegram-креденшеле n8n
const TOKEN          = '';                   // доп. секрет; '' = не проверять
const ALLOWED_TG_IDS = [];                   // напр. [123456789]; пусто = любой юзер бота
const MAX_AGE_SEC    = 24 * 60 * 60;         // сколько живёт подпись

const body = ($('Webhook').first().json.body) || {};

// Возвращает null, если всё в порядке, иначе — причину отказа строкой.
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

  // строка проверки: пары ключ=значение, отсортированные по ключу, через \n
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

// В воркфлоу чтения:  if (denied) return [{ json: { error: denied } }];
// В воркфлоу записи:  if (denied) return [{ json: { ok: false, error: denied } }];
const denied = checkAuth();
