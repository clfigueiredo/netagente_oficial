"""
skill_converter.py — Converts bash scripts to structured skill steps using an LLM.

The output format matches public.skills.steps (JSONB):
[
  {
    "id": 1,
    "description": "Human-readable step name",
    "cmd": "actual bash command",
    "timeout": 120,
    "on_error": "stop"
  }
]
"""

import json
import os
import logging

logger = logging.getLogger(__name__)

CONVERSION_PROMPT = """You are a DevOps expert. Convert this bash script into structured execution steps.

Rules:
1. Group logical operations (e.g. apt update + upgrade = one step)
2. Each step must have ONE command or a short pipeline
3. Heredocs (cat << EOF > file) stay as a single step
4. timeout: 60 for simple commands, 300 for apt install, 600 for curl+install
5. on_error: always "stop" for installs, "continue" for optional steps
6. description: concise Portuguese action description

Output ONLY valid JSON array, no markdown, no explanation:
[{"id":1,"description":"...","cmd":"...","timeout":120,"on_error":"stop"}]

Script to convert:
{script}
"""


async def parse_bash_to_steps(
    script: str,
    api_key: str = None,
    provider: str = "openai",
) -> list[dict]:
    """
    Use an LLM to parse a bash script into structured steps.
    Returns list of step dicts ready to store in skills.steps.
    """
    prompt = CONVERSION_PROMPT.format(script=script)

    if provider == "gemini":
        import google.generativeai as genai
        genai.configure(api_key=api_key or os.getenv("GOOGLE_API_KEY"))
        model = genai.GenerativeModel("gemini-2.0-flash")
        response = model.generate_content(prompt)
        raw = response.text.strip()
    else:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=api_key or os.getenv("OPENAI_KEY"))
        resp = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=2000,
        )
        raw = resp.choices[0].message.content.strip()

    # Strip markdown code fences if LLM added them
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    steps = json.loads(raw)
    # Validate and normalize
    for i, step in enumerate(steps):
        step.setdefault("id", i + 1)
        step.setdefault("timeout", 120)
        step.setdefault("on_error", "stop")
        if "description" not in step or "cmd" not in step:
            raise ValueError(f"Step {i} missing required fields: {step}")

    logger.info(f"[skill_converter] Parsed {len(steps)} steps from script")
    return steps
