'use strict';

function boundedMessage(error) {
  const message = String(error?.message || error || 'Unknown error').replace(/\s+/g, ' ').trim();
  return message.slice(0, 180);
}

function createIntervalRunner({
  intervalMs,
  run,
  now = () => Date.now(),
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
} = {}) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1000) throw new TypeError('intervalMs must be an integer of at least 1000 milliseconds.');
  if (typeof run !== 'function') throw new TypeError('run must be a function.');

  let timer = null;
  let inFlight = null;
  let started = false;
  let nextRunAt = null;
  let lastStartedAt = null;
  let lastFinishedAt = null;
  let lastSucceededAt = null;
  let lastTrigger = null;
  let lastError = null;

  const isoNow = () => new Date(now()).toISOString();
  const status = () => ({
    started,
    running: Boolean(inFlight),
    interval_ms: intervalMs,
    interval_minutes: intervalMs / 60_000,
    next_run_at: nextRunAt,
    last_started_at: lastStartedAt,
    last_finished_at: lastFinishedAt,
    last_succeeded_at: lastSucceededAt,
    last_trigger: lastTrigger,
    last_error: lastError,
  });

  function trigger({ reason = 'manual', payload = null } = {}) {
    if (inFlight) return Promise.resolve({ accepted: false, reason: 'already_running', schedule: status() });

    lastStartedAt = isoNow();
    lastTrigger = String(reason || 'manual').slice(0, 40);
    lastError = null;

    inFlight = Promise.resolve()
      .then(() => run({ reason: lastTrigger, payload }))
      .then(result => {
        lastSucceededAt = isoNow();
        return { accepted: true, result, schedule: status() };
      })
      .catch(error => {
        lastError = boundedMessage(error);
        throw error;
      })
      .finally(() => {
        lastFinishedAt = isoNow();
        inFlight = null;
      });

    return inFlight;
  }

  function start() {
    if (started) return status();
    started = true;
    nextRunAt = new Date(now() + intervalMs).toISOString();
    timer = setIntervalImpl(() => {
      nextRunAt = new Date(now() + intervalMs).toISOString();
      trigger({ reason: 'scheduled' }).catch(() => {});
    }, intervalMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return status();
  }

  function stop() {
    if (timer) clearIntervalImpl(timer);
    timer = null;
    started = false;
    nextRunAt = null;
    return status();
  }

  return { start, stop, trigger, status };
}

module.exports = { createIntervalRunner };
