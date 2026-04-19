"""
skill_executor.py — Executes DB skills step-by-step via SSH with live streaming.

Each skill.steps is a JSON array:
  [{id, description, cmd, timeout, expected_exit_code, on_error}]

Streams progress via a callback so callers can emit socket events in real time.
"""

import asyncio
import json
import logging
from typing import Callable, Optional


logger = logging.getLogger(__name__)


class SkillExecutionError(Exception):
    def __init__(self, step_id: int, step_desc: str, output: str, exit_code: int):
        self.step_id = step_id
        self.step_desc = step_desc
        self.output = output
        self.exit_code = exit_code
        super().__init__(f"Step {step_id} failed (exit {exit_code}): {step_desc}")


async def run_skill_steps(
    steps: list[dict],
    ssh_runner: Callable[[str, int], any],   # async fn(cmd, timeout) -> (output, exit_code)
    emit: Callable[[str, dict], None],        # emit(event_name, payload)
    conversation_id: str,
    skill_name: str,
) -> str:
    """
    Execute skill steps sequentially, emitting progress events.
    Returns a summary string for the LLM.

    emit events:
      agent:skill_step  — {status: 'running'|'ok'|'error', step_id, description, output}
      agent:skill_done  — {skill_name, success, summary}
    """
    results = []
    failed_step = None

    # Defensive: asyncpg may return JSONB as a raw JSON string or list of strings
    if isinstance(steps, str):
        steps = json.loads(steps)
    parsed_steps = []
    for s in steps:
        if isinstance(s, str):
            try:
                s = json.loads(s)
            except (json.JSONDecodeError, TypeError):
                # Old format: bare string = just a description, skip
                logger.warning(f"[skill_executor] Skipping unparseable step: {s!r}")
                continue
        if isinstance(s, dict):
            parsed_steps.append(s)
    steps = parsed_steps

    if not steps:
        emit("agent:skill_done", {
            "conversationId": conversation_id,
            "skillName": skill_name,
            "success": False,
            "summary": "❌ Skill sem steps válidos. Verifique o cadastro da skill no banco.",
        })
        return "❌ Skill sem steps válidos. Use `propose_action` para instalar manualmente."

    for step in steps:
        step_id = step.get("id", 0)
        description = step.get("description", f"Step {step_id}")
        cmd = step.get("cmd", "")
        timeout = int(step.get("timeout", 120))
        on_error = step.get("on_error", "stop")

        # Emit: step is starting
        emit("agent:skill_step", {
            "conversationId": conversation_id,
            "skillName": skill_name,
            "stepId": step_id,
            "description": description,
            "status": "running",
            "output": "",
        })

        try:
            output, exit_code = await ssh_runner(cmd, timeout)
        except Exception as e:
            output = f"Erro de execução: {e}"
            exit_code = -1

        success = exit_code == 0
        status = "ok" if success else "error"

        emit("agent:skill_step", {
            "conversationId": conversation_id,
            "skillName": skill_name,
            "stepId": step_id,
            "description": description,
            "status": status,
            "output": output[:2000],  # cap to avoid huge payloads
            "exitCode": exit_code,
        })

        results.append({
            "step_id": step_id,
            "description": description,
            "status": status,
            "output": output[:500],
        })

        if not success:
            failed_step = {"step_id": step_id, "description": description, "output": output}
            if on_error == "stop":
                break
            # on_error == "continue" → keep going

    overall_success = failed_step is None
    summary_lines = [f"## 📋 Resultado: {skill_name}"]
    for r in results:
        icon = "✅" if r["status"] == "ok" else "❌"
        summary_lines.append(f"{icon} Step {r['step_id']}: {r['description']}")
        if r["status"] == "error":
            summary_lines.append(f"   Erro: {r['output'][:300]}")

    if overall_success:
        summary_lines.append("\n✅ **Skill concluída com sucesso.**")
    else:
        summary_lines.append(
            f"\n❌ **Falha no step {failed_step['step_id']}: {failed_step['description']}**"
            f"\nOutput: {failed_step['output'][:400]}"
            f"\nAnálise e possível correção necessária."
        )

    summary = "\n".join(summary_lines)

    emit("agent:skill_done", {
        "conversationId": conversation_id,
        "skillName": skill_name,
        "success": overall_success,
        "summary": summary,
    })

    return summary
