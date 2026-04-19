"""
skill_executor.py — Converts DB-stored skills into real LangChain StructuredTools.

Skills in the `public.skills` table have `steps[].commands` — instead of just
showing them as text in the system prompt, this module creates actual tool
instances the LLM can invoke directly.
"""

import json
import asyncio
from typing import Optional

from langchain_core.tools import StructuredTool
from pydantic import create_model, Field

from tools.base_tools import BaseTools


def build_skill_tools(
    skills: list,
    device_type: str,
    ssh_executor: Optional[BaseTools],
    agent_mode: str = "restricted",
) -> list[StructuredTool]:
    """
    Convert matching DB skills into StructuredTool instances.

    Filters skills by device_type (or 'any'). Creates one tool per skill
    that executes its steps.commands via SSH.

    Args:
        skills:       List of skill dicts from db.get_tenant_skills()
        device_type:  'linux' or 'mikrotik' — filters which skills apply
        ssh_executor: The BaseTools instance to run SSH commands through
        agent_mode:   Current agent mode for permission checks

    Returns:
        List of StructuredTool instances ready for llm.bind_tools()
    """
    if not ssh_executor:
        return []

    tools = []
    for skill in skills:
        # Filter by device type: skill applies if device_type matches or is None/'any'
        skill_device = (skill.get("device_type") or "").lower()
        if skill_device and skill_device != device_type.lower():
            continue

        steps = _parse_steps(skill.get("steps"))
        if not steps:
            continue

        tool = _make_skill_tool(skill, steps, ssh_executor, agent_mode)
        if tool:
            tools.append(tool)

    return tools


def _parse_steps(steps_raw) -> list:
    """Parse steps field — may be a list, JSON string, or None."""
    if not steps_raw:
        return []
    if isinstance(steps_raw, str):
        try:
            steps_raw = json.loads(steps_raw)
        except (json.JSONDecodeError, TypeError):
            return []
    if isinstance(steps_raw, list):
        return [s for s in steps_raw if isinstance(s, dict) and s.get("commands")]
    return []


import re
from pydantic import create_model, Field

def _make_skill_tool(
    skill: dict,
    steps: list,
    executor: BaseTools,
    agent_mode: str,
) -> Optional[StructuredTool]:
    """Create a single StructuredTool from a DB skill."""
    name = f"skill_{skill['name'].replace('-', '_').replace(' ', '_')}"
    display = skill.get("display_name") or skill["name"]
    description = (
        f"[SKILL] {display}: {skill.get('description', '')} "
        f"(categoria: {skill.get('category', 'geral')})"
    )

    # Collect all commands from all steps
    all_commands = []
    variables = set()

    for step in steps:
        cmds = step.get("commands", [])
        if isinstance(cmds, str):
            try:
                cmds = json.loads(cmds)
            except Exception:
                cmds = [cmds]
        for c in cmds:
            if not c:
                continue
            c_str = str(c)
            all_commands.append(c_str)
            
            # Find all <variable> patterns
            found = re.findall(r'<([a-zA-Z0-9_]+)>', c_str)
            variables.update(found)

    if not all_commands:
        return None

    # Capture in closure
    _commands = all_commands
    _executor = executor
    _mode = agent_mode
    _display = display

    args_schema = None
    if variables:
        fields = {}
        for var in variables:
            fields[var] = (str, Field(description=f"Valor dinâmico para a variável <{var}> solicitada na skill."))
        args_schema = create_model(f"{name}_args", **fields)

    async def run_skill(**kwargs) -> str:
        """Execute all skill commands sequentially via SSH."""
        results = []
        for cmd in _commands:
            # Replace dynamically requested variables
            for k, v in kwargs.items():
                cmd = cmd.replace(f"<{k}>", str(v))
            
            result = await _executor._async_run(cmd)
            results.append(f"$ {cmd}\n{result}")
        return f"=== Skill: {_display} ===\n\n" + "\n\n".join(results)

    return StructuredTool.from_function(
        func=run_skill,
        name=name,
        description=description,
        args_schema=args_schema,
        coroutine=run_skill,
    )
