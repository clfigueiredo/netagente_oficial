import os
import redis.asyncio as aioredis
import asyncio
import json
import logging
from datetime import datetime, timezone
from apscheduler.schedulers.asyncio import AsyncIOScheduler

import db
from tools.mikrotik_tools import MikroTikTools

_SSH_ERROR_MARKERS = (
    "Erro SSH", "Erro:", "timed out", "Connection refused",
    "No route to host", "Network is unreachable", "autenticação",
    "not found", "authentication",
)


def _is_error(raw: str) -> bool:
    """Return True if the raw output string indicates an SSH/connection error."""
    return any(m.lower() in raw.lower() for m in _SSH_ERROR_MARKERS)
from tools.linux_tools import LinuxTools
from whatsapp import WhatsAppClient

_wa = WhatsAppClient()

# Alert debounce: track last alert sent per device (in-memory)
# Format: {"{tenant}:{device_id}:{alert_type}": datetime}
_alert_sent: dict[str, datetime] = {}
ALERT_COOLDOWN_MINUTES = 30  # Don't repeat same alert for 30 minutes


def _can_alert(key: str) -> bool:
    """Return True if enough time has passed since last alert for this key."""
    last = _alert_sent.get(key)
    if not last:
        return True
    delta = (datetime.now(timezone.utc) - last).total_seconds() / 60
    return delta >= ALERT_COOLDOWN_MINUTES


def _mark_alerted(key: str):
    _alert_sent[key] = datetime.now(timezone.utc)


class MonitorScheduler:
    """Polls all active devices per tenant and publishes status to Redis."""

    def __init__(self):
        self.scheduler = AsyncIOScheduler()
        self.redis_url = os.getenv("REDIS_URL")

    def start(self):
        self.scheduler.add_job(self._poll_all_tenants, "interval", seconds=60, misfire_grace_time=None)
        self.scheduler.start()
        logging.info("[monitor] Scheduler started — polling every 60s")

    def stop(self):
        self.scheduler.shutdown()

    async def _poll_all_tenants(self):
        """Poll all active tenants and their devices."""
        async with await db._acquire() as conn:
            tenants = await conn.fetch(
                "SELECT slug, evolution_instance, evolution_key FROM public.tenants WHERE active = true"
            )

        for tenant in tenants:
            asyncio.create_task(self._poll_tenant(dict(tenant)))

    async def _poll_tenant(self, tenant: dict):
        tenant_slug = tenant["slug"]
        async with await db._acquire() as conn:
            devices = await conn.fetch(
                f'SELECT id, name, type, host, port, username, password_encrypted '
                f'FROM "{tenant_slug}".devices WHERE active = true'
            )
            settings = await db.get_tenant_settings(tenant_slug)
            cpu_threshold = int(settings.get("alert_cpu_threshold", 85))

            # Get whatsapp users who should receive alerts (all authorized users)
            alert_numbers = await conn.fetch(
                f'SELECT number FROM "{tenant_slug}".whatsapp_users WHERE active = true'
            )

        redis = await aioredis.from_url(self.redis_url)
        try:
            for device in devices:
                asyncio.create_task(
                    self._poll_device(
                        dict(device), tenant, cpu_threshold,
                        [r["number"] for r in alert_numbers],
                        redis
                    )
                )
        finally:
            await redis.aclose()

    async def _poll_device(self, device: dict, tenant: dict, cpu_threshold: int,
                           alert_numbers: list[str], redis):
        """Get status for a single device, update DB, cache in Redis, send alerts."""
        tenant_slug = tenant["slug"]
        device_id = str(device["id"])
        device_name = device["name"]

        try:
            if device["type"] == "mikrotik":
                tools = MikroTikTools(
                    host=device["host"], port=device["port"],
                    username=device["username"],
                    password_encrypted=device["password_encrypted"]
                )
                status_raw = await tools.get_status()
                if _is_error(status_raw):
                    raise RuntimeError(status_raw)
                cpu = 0
                if "CPU:" in status_raw:
                    try:
                        cpu = int(status_raw.split("CPU:")[1].split("%")[0].strip())
                    except (ValueError, IndexError):
                        cpu = 0

                metrics = {
                    "online": True,
                    "cpu": cpu,
                    "raw": status_raw,
                    "alert": cpu >= cpu_threshold
                }

                # Alert: high CPU
                if metrics["alert"]:
                    alert_key = f"{tenant_slug}:{device_id}:cpu_high"
                    if _can_alert(alert_key):
                        msg = (
                            f"⚠️ *Alerta NetAgent*\n"
                            f"Dispositivo: *{device_name}*\n"
                            f"🖥️ CPU alta: *{cpu}%* (limite: {cpu_threshold}%)\n"
                            f"🕐 {datetime.now().strftime('%d/%m %H:%M')}"
                        )
                        await _send_alerts(tenant, alert_numbers, msg)
                        _mark_alerted(alert_key)

            elif device["type"] == "linux":
                tools = LinuxTools(
                    host=device["host"], port=device["port"],
                    username=device["username"],
                    password_encrypted=device["password_encrypted"]
                )
                status_raw = await tools.get_status()
                if _is_error(status_raw):
                    raise RuntimeError(status_raw)
                # Parse CPU for Linux
                cpu = 0
                if "CPU:" in status_raw:
                    try:
                        cpu = float(status_raw.split("CPU:")[1].split("%")[0].strip())
                    except (ValueError, IndexError):
                        cpu = 0

                metrics = {
                    "online": True,
                    "cpu": cpu,
                    "raw": status_raw,
                    "alert": cpu >= cpu_threshold
                }

                if metrics["alert"]:
                    alert_key = f"{tenant_slug}:{device_id}:cpu_high"
                    if _can_alert(alert_key):
                        msg = (
                            f"⚠️ *Alerta NetAgent*\n"
                            f"Dispositivo: *{device_name}*\n"
                            f"🖥️ CPU alta: *{cpu:.1f}%* (limite: {cpu_threshold}%)\n"
                            f"🕐 {datetime.now().strftime('%d/%m %H:%M')}"
                        )
                        await _send_alerts(tenant, alert_numbers, msg)
                        _mark_alerted(alert_key)
            else:
                metrics = {"online": None, "raw": "Tipo não suportado", "alert": False}

            # ── Device came BACK online? Clear offline alert debounce
            _alert_sent.pop(f"{tenant_slug}:{device_id}:offline", None)

        except Exception as e:
            metrics = {"online": False, "error": str(e), "alert": True}
            logging.warning(f"[monitor] {tenant_slug}/{device_name} error: {e}")

            # Alert: device offline
            alert_key = f"{tenant_slug}:{device_id}:offline"
            if _can_alert(alert_key):
                msg = (
                    f"🔴 *Alerta NetAgent — Dispositivo Offline*\n"
                    f"Dispositivo: *{device_name}*\n"
                    f"Host: `{device['host']}`\n"
                    f"Erro: {str(e)[:120]}\n"
                    f"🕐 {datetime.now().strftime('%d/%m %H:%M')}"
                )
                await _send_alerts(tenant, alert_numbers, msg)
                _mark_alerted(alert_key)

        # ── Update last_seen_at in DB when online ──────────────────────────
        if metrics.get("online"):
            try:
                async with await db._acquire() as conn:
                    await conn.execute(
                        f'UPDATE "{tenant_slug}".devices SET last_seen_at = NOW() WHERE id = $1',
                        device["id"]
                    )
            except Exception as e:
                logging.warning(f"[monitor] last_seen_at update failed: {e}")

        # ── Cache in Redis (90s TTL) ───────────────────────────────────────
        await redis.setex(
            f"status:{tenant_slug}:{device_id}",
            90,
            json.dumps(metrics)
        )


async def _send_alerts(tenant: dict, numbers: list[str], message: str):
    """Send WhatsApp alert to all authorized numbers."""
    instance = tenant.get("evolution_instance")
    api_key = tenant.get("evolution_key")
    if not instance or not api_key or not numbers:
        return
    for number in numbers:
        try:
            await _wa.send_message(
                instance=instance,
                api_key=api_key,
                number=number,
                text=message,
            )
            logging.info(f"[monitor] alert sent to {number}")
        except Exception as e:
            logging.warning(f"[monitor] failed to send alert to {number}: {e}")
