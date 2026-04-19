import asyncio
import logging
import json
from datetime import datetime, timezone
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

import db
from whatsapp import WhatsAppClient
from tools.mikrotik_tools import MikroTikTools
from tools.linux_tools import LinuxTools

logger = logging.getLogger(__name__)

async def _db_fetch_one(query: str, *args):
    async with await db._acquire() as conn:
        row = await conn.fetchrow(query, *args)
        return dict(row) if row else None

async def _db_fetch_all(query: str, *args):
    async with await db._acquire() as conn:
        rows = await conn.fetch(query, *args)
        return [dict(r) for r in rows]

async def _db_execute(query: str, *args):
    async with await db._acquire() as conn:
        return await conn.execute(query, *args)

scheduler = AsyncIOScheduler()
whatsapp_client = WhatsAppClient()

async def execute_automation(tenant_slug: str, automation: dict):
    """Executes a single automation in a batch with concurrency limit."""
    auto_id = automation["id"]
    auto_name = automation["name"]
    skill_id = automation["skill_id"]
    targets = automation["target_devices"]
    if isinstance(targets, str):
        try:
            targets = json.loads(targets)
            if isinstance(targets, str):
                targets = json.loads(targets)
        except:
            targets = []
            
    cron_expr = automation["cron_expression"]
    notif_target = automation.get("notification_target", "default")
    
    print(f"[automation] Starting '{auto_name}' (Tenant: {tenant_slug}, Devices: {len(targets)})", flush=True)
    
    # Update status to running
    await _update_automation_status(tenant_slug, auto_id, "running")
    
    # Fetch skill
    skill = await _db_fetch_one("SELECT * FROM public.skills WHERE id = $1", skill_id)
    if not skill:
        logger.error(f"[automation] Skill {skill_id} not found.")
        await _update_automation_status(tenant_slug, auto_id, "failed")
        return

    # Parse steps
    steps = skill.get("steps", [])
    if isinstance(steps, str):
        try:
            steps = json.loads(steps)
        except:
            steps = []
            
    # Commands from steps
    commands = []
    for step in steps:
        cmds = step.get("commands", [])
        if isinstance(cmds, str): cmds = [cmds]
        commands.extend([str(c) for c in cmds if c])

    print(f"[automation] Extracted Steps: {steps}", flush=True)
    print(f"[automation] Extracted Commands: {commands}", flush=True)

    if not commands:
        print(f"[automation] Skill {auto_name} has no valid commands.", flush=True)
        await _update_automation_status(tenant_slug, auto_id, "failed")
        return

    # Fetch targeted devices (if targets is ['ALL'] we could load all, but assuming UUIDs for now)
    success_count = 0
    fail_count = 0
    failed_devices = []
    
    # We will process max 5 devices concurrently to avoid blocking network
    sem = asyncio.Semaphore(5)
    
    async def process_device(device_id: str):
        nonlocal success_count, fail_count
        print(f"[automation] Process device starting for ID: {device_id}", flush=True)
        device = await db.get_device_by_id(tenant_slug, device_id)
        if not device:
            print(f"[automation] Device {device_id} not found in DB.", flush=True)
            fail_count += 1
            failed_devices.append(f"UUID {device_id} (Not found)")
            return

        device_name = device["name"]
        device_type = device["type"]
        print(f"[automation] Found device: {device_name} ({device_type})", flush=True)
        
        async with sem:
            try:
                # Setup executor
                kwargs = dict(
                    host=device["host"],
                    port=device["port"],
                    username=device["username"],
                    password_encrypted=device["password_encrypted"],
                    agent_mode="restricted",
                    emit_fn=lambda *args: None, # No UI streaming for background jobs
                    conversation_id="automation_job",
                    tenant_slug=tenant_slug,
                )
                if device_type == "mikrotik":
                    executor = MikroTikTools(**kwargs)
                elif device_type == "linux":
                    executor = LinuxTools(**kwargs)
                else:
                    raise Exception(f"Unsupported device type {device_type}")
                
                # Execute each command
                for raw_cmd in commands:
                    # Apply MAGIC VARIABLES
                    cmd = raw_cmd.replace("<DEVICE_NAME>", device_name)
                    cmd = cmd.replace("<DEVICE_IP>", device["host"])
                    cmd = cmd.replace("<DATE>", datetime.now().strftime("%Y-%m-%d"))
                    
                    # For date requested by LLM, fallback to today if requested
                    cmd = cmd.replace("<datadoarquivo>", datetime.now().strftime("%Y-%m-%d"))
                    
                    print(f"[automation] Executing Command on {device_name}: {repr(cmd)}", flush=True)
                    res = await executor._async_run(cmd)
                    print(f"[automation] Command Result from {device_name}: {repr(res)}", flush=True)
                    
                success_count += 1
            except Exception as e:
                logger.error(f"[automation] Error on {device_name}: {e}")
                print(f"[automation] Error on {device_name}: {e}", flush=True)
                fail_count += 1
                failed_devices.append(device_name)
    
    # Run all devices
    print(f"[automation] Targets list: {targets} (type: {type(targets)})", flush=True)
    if targets and isinstance(targets, list):
        print(f"[automation] Will schedule {len(targets)} tasks...", flush=True)
        tasks = [process_device(t) for t in targets]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for r in results:
            if isinstance(r, Exception):
                logger.error(f"[automation] Unhandled task exception: {r}")
                print(f"[automation] Unhandled task exception: {r}", flush=True)
    else:
        print(f"[automation] Targets empty or not list. Skipping.", flush=True)
        
    status = "success" if fail_count == 0 else ("partial_error" if success_count > 0 else "failed")
    await _update_automation_status(tenant_slug, auto_id, status)
    
    # Send WhatsApp Summary Report
    summary = f"🤖 *Automação Executada:*\n"
    summary += f"🔹 *Nome:* {auto_name}\n"
    summary += f"✅ *Sucessos:* {success_count}\n"
    summary += f"❌ *Falhas:* {fail_count}\n"
    
    if failed_devices:
        summary += f"\n*Dispositivos com Falha:*\n- " + "\n- ".join(failed_devices)

    # Use first available whatsapp if 'default', preferring admins
    target_num = notif_target
    if notif_target == "default":
        users = await _db_fetch_all(f"SELECT number, role FROM {tenant_slug}.whatsapp_users WHERE active=true")
        if users:
            # Try admin first, else first user
            admins = [u for u in users if u["role"] == "admin"]
            target_num = admins[0]["number"] if admins else users[0]["number"]
        else:
            target_num = None
            
    if target_num:
        try:
            tenant_info = await _db_fetch_one(
                "SELECT evolution_instance, evolution_key FROM public.tenants WHERE slug = $1 AND active = true",
                tenant_slug
            )
            if tenant_info and tenant_info["evolution_instance"]:
                await whatsapp_client.send_message(
                    instance=tenant_info["evolution_instance"],
                    api_key=tenant_info["evolution_key"],
                    number=target_num,
                    text=summary
                )
                logger.info(f"[automation] Report sent to {target_num}")
            else:
                logger.error(f"[automation] WhatsApp not configured for tenant {tenant_slug}")
        except Exception as e:
            logger.error(f"[automation] Failed to send report: {e}")

async def _update_automation_status(tenant: str, auto_id: str, status: str):
    await _db_execute(
        f"UPDATE {tenant}.automations SET last_status = $1, last_run_at = NOW() WHERE id = $2",
        status, auto_id
    )

async def _poll_automations():
    """Timer tick: checks if any automation is scheduled for this minute."""
    now = datetime.now(timezone.utc)
    tenants = await db.get_all_tenant_slugs()
    
    for tenant in tenants:
        try:
            automations = await _db_fetch_all(f"SELECT * FROM {tenant}.automations WHERE is_active = true")
            for auto in automations:
                expr = auto.get("cron_expression")
                if not expr: continue
                # Very simple cron check using APScheduler's CronTrigger
                try:
                    trigger = CronTrigger.from_crontab(expr)
                    # Check if trigger fire time matches current minute.
                    # A robust way is to check the next fire time from 1 minute ago.
                    # For simplicity, we compare current minute directly if next_fire_time <= now
                except Exception as e:
                    logger.error(f"Invalid cron {expr} for automation {auto['id']}: {e}")
                    continue
        except Exception as e:
            logger.error(f"Failed to poll automations for {tenant}: {e}")

# The simplest reliable master polling is scheduling dynamic jobs OR clearing them and reloading.
# Let's dynamically maintain jobs.

_job_store = {} # "tenant_autoid" -> APScheduler job

async def sync_automations_loop():
    """Runs every minute to sync Job scheduler with DB state."""
    while True:
        try:
            logger.info("[scheduler] Syncing automations with DB...")
            tenants = await db.get_all_tenant_slugs()
            active_keys = set()
            
            for tenant in tenants:
                automations = await _db_fetch_all(f"SELECT * FROM {tenant}.automations WHERE is_active = true")
                for auto in automations:
                    key = f"{tenant}_{auto['id']}"
                    active_keys.add(key)
                    expr = auto["cron_expression"]
                    
                    if key in _job_store:
                        # Reschedule if cron changed
                        existing_job = _job_store[key]
                        if str(existing_job.trigger) != str(CronTrigger.from_crontab(expr)):
                            existing_job.reschedule(CronTrigger.from_crontab(expr))
                    else:
                        # Schedule new job
                        job = scheduler.add_job(
                            execute_automation,
                            CronTrigger.from_crontab(expr),
                            args=[tenant, auto],
                            id=key,
                            replace_existing=True,
                            max_instances=1,
                            misfire_grace_time=None
                        )
                        _job_store[key] = job
                        
            # Remove deleted/deactivated jobs
            to_remove = [k for k in _job_store.keys() if k not in active_keys]
            for k in to_remove:
                _job_store[k].remove()
                del _job_store[k]
                
        except Exception as e:
            logger.error(f"[scheduler] Sync error: {e}")
            
        await asyncio.sleep(60)

def start_scheduler():
    scheduler.start()
    asyncio.create_task(sync_automations_loop())
    logger.info("[scheduler] Engine started.")
