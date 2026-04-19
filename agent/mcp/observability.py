"""
observability.py — Structured logging and metrics for agent + MCP operations.

Provides:
  - StructuredLogger: JSON-formatted logging with context
  - MetricsCollector: In-memory counters for tool calls, errors, tokens, latency
  - log_tool_call / log_phase: Convenience decorators/helpers
"""

import time
import json
import logging
from typing import Optional
from dataclasses import dataclass, field
from collections import defaultdict


# ── Structured Logger ─────────────────────────────────────────────────────────

class StructuredLogger:
    """JSON-structured logger with automatic context injection."""

    def __init__(self, name: str = "netagent"):
        self._logger = logging.getLogger(name)
        self._context: dict = {}

    def with_context(self, **kwargs) -> "StructuredLogger":
        """Return a new logger with additional context fields."""
        new = StructuredLogger(self._logger.name)
        new._context = {**self._context, **kwargs}
        return new

    def _emit(self, level: int, event: str, **kwargs):
        data = {
            "event": event,
            "ts": time.time(),
            **self._context,
            **kwargs,
        }
        self._logger.log(level, json.dumps(data, default=str))

    def info(self, event: str, **kwargs):
        self._emit(logging.INFO, event, **kwargs)

    def warning(self, event: str, **kwargs):
        self._emit(logging.WARNING, event, **kwargs)

    def error(self, event: str, **kwargs):
        self._emit(logging.ERROR, event, **kwargs)


# ── Metrics Collector ─────────────────────────────────────────────────────────

@dataclass
class ToolMetrics:
    """Metrics for a single tool call."""
    tool: str
    duration_ms: float
    success: bool
    error: Optional[str] = None
    tenant: Optional[str] = None
    conversation_id: Optional[str] = None


class MetricsCollector:
    """In-memory metrics collector. Thread-safe for async usage."""

    def __init__(self):
        self._tool_calls: list[ToolMetrics] = []
        self._counters: dict[str, int] = defaultdict(int)
        self._phase_timings: list[dict] = []

    def record_tool_call(self, metric: ToolMetrics):
        self._tool_calls.append(metric)
        self._counters["tool_calls_total"] += 1
        if metric.success:
            self._counters["tool_calls_success"] += 1
        else:
            self._counters["tool_calls_error"] += 1

    def record_phase(self, phase: str, duration_ms: float, **extra):
        self._phase_timings.append({
            "phase": phase,
            "duration_ms": duration_ms,
            **extra,
        })

    def record_tokens(self, count: int):
        self._counters["tokens_total"] += count

    def get_summary(self) -> dict:
        """Return a summary snapshot of current metrics."""
        tool_durations = [m.duration_ms for m in self._tool_calls]
        return {
            "counters": dict(self._counters),
            "tool_avg_ms": sum(tool_durations) / len(tool_durations) if tool_durations else 0,
            "tool_max_ms": max(tool_durations) if tool_durations else 0,
            "phases": self._phase_timings[-10:],
            "recent_errors": [
                {"tool": m.tool, "error": m.error}
                for m in self._tool_calls[-20:]
                if not m.success
            ],
        }

    def reset(self):
        self._tool_calls.clear()
        self._counters.clear()
        self._phase_timings.clear()


# ── Singleton ─────────────────────────────────────────────────────────────────

logger = StructuredLogger("netagent")
metrics = MetricsCollector()


# ── Convenience helpers ───────────────────────────────────────────────────────

class PhaseTimer:
    """Context manager for timing graph phases."""

    def __init__(self, phase_name: str, **context):
        self.phase = phase_name
        self.context = context
        self.start = 0.0

    def __enter__(self):
        self.start = time.monotonic()
        logger.info("phase_start", phase=self.phase, **self.context)
        return self

    def __exit__(self, *args):
        elapsed = (time.monotonic() - self.start) * 1000
        metrics.record_phase(self.phase, elapsed, **self.context)
        logger.info("phase_end", phase=self.phase, duration_ms=round(elapsed, 1), **self.context)


async def timed_tool_call(tool, args: dict, tenant: str = "", conversation_id: str = "") -> tuple[str, ToolMetrics]:
    """Execute a tool call with timing and metrics recording."""
    start = time.monotonic()
    try:
        result = await tool.ainvoke(args or {})
        elapsed = (time.monotonic() - start) * 1000
        metric = ToolMetrics(
            tool=tool.name, duration_ms=round(elapsed, 1),
            success=True, tenant=tenant, conversation_id=conversation_id,
        )
        metrics.record_tool_call(metric)
        return str(result), metric
    except Exception as e:
        elapsed = (time.monotonic() - start) * 1000
        metric = ToolMetrics(
            tool=tool.name, duration_ms=round(elapsed, 1),
            success=False, error=str(e), tenant=tenant, conversation_id=conversation_id,
        )
        metrics.record_tool_call(metric)
        raise
