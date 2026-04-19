"""
circuit_breaker.py — Circuit Breaker pattern for MCP driver resilience.

States:
  CLOSED  → Normal, calls pass through. On N failures → OPEN
  OPEN    → All calls rejected immediately. After recovery_timeout → HALF_OPEN
  HALF_OPEN → One test call allowed. Success → CLOSED, Failure → OPEN

Config per driver (defaults):
  failure_threshold: 3
  recovery_timeout: 30s
  call_timeout: 15s
"""

import time
import asyncio
import logging
from typing import Optional, Callable, Awaitable, Any
from dataclasses import dataclass, field

from .models import CircuitState
from .observability import logger as obs_logger, metrics as obs_metrics

_log = logging.getLogger(__name__)


@dataclass
class CircuitBreakerConfig:
    failure_threshold: int = 3
    recovery_timeout_s: float = 30.0
    call_timeout_s: float = 30.0
    retry_delays: list[float] = field(default_factory=lambda: [1.0, 3.0])


class CircuitBreakerError(Exception):
    """Raised when circuit is OPEN and call is rejected."""
    pass


class CircuitBreaker:
    """
    Per-driver circuit breaker.

    Usage:
        cb = CircuitBreaker("mcp-mikrotik")
        result = await cb.call(some_async_fn, arg1, arg2)
    """

    def __init__(self, driver_name: str, config: Optional[CircuitBreakerConfig] = None):
        self.driver = driver_name
        self.config = config or CircuitBreakerConfig()
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._last_failure_time = 0.0
        self._success_count = 0

    @property
    def state(self) -> CircuitState:
        if self._state == CircuitState.OPEN:
            elapsed = time.monotonic() - self._last_failure_time
            if elapsed >= self.config.recovery_timeout_s:
                self._state = CircuitState.HALF_OPEN
                obs_logger.info("circuit_half_open",
                    driver=self.driver,
                    elapsed_s=round(elapsed, 1),
                )
        return self._state

    async def call(
        self,
        fn: Callable[..., Awaitable[Any]],
        *args,
        **kwargs,
    ) -> Any:
        """Execute fn through the circuit breaker with timeout and retry."""
        current_state = self.state

        if current_state == CircuitState.OPEN:
            obs_logger.warning("circuit_rejected",
                driver=self.driver,
                failure_count=self._failure_count,
            )
            raise CircuitBreakerError(
                f"Circuit OPEN for {self.driver} — "
                f"{self._failure_count} failures, "
                f"retry in {self.config.recovery_timeout_s - (time.monotonic() - self._last_failure_time):.0f}s"
            )

        # HALF_OPEN: allow exactly one call
        if current_state == CircuitState.HALF_OPEN:
            return await self._attempt(fn, *args, is_probe=True, **kwargs)

        # CLOSED: normal operation with retry
        return await self._attempt_with_retry(fn, *args, **kwargs)

    async def _attempt_with_retry(
        self,
        fn: Callable[..., Awaitable[Any]],
        *args,
        **kwargs,
    ) -> Any:
        """First attempt + retry attempts with exponential backoff."""
        last_error = None

        for attempt_idx in range(1 + len(self.config.retry_delays)):
            try:
                return await self._attempt(fn, *args, **kwargs)
            except Exception as e:
                last_error = e
                if attempt_idx < len(self.config.retry_delays):
                    delay = self.config.retry_delays[attempt_idx]
                    obs_logger.warning("circuit_retry",
                        driver=self.driver,
                        attempt=attempt_idx + 1,
                        delay_s=delay,
                        error=str(e)[:200],
                    )
                    await asyncio.sleep(delay)

        # All retries exhausted → record failure
        self._record_failure(last_error)
        raise last_error

    async def _attempt(
        self,
        fn: Callable[..., Awaitable[Any]],
        *args,
        is_probe: bool = False,
        **kwargs,
    ) -> Any:
        """Single attempt with timeout."""
        start = time.monotonic()
        try:
            result = await asyncio.wait_for(
                fn(*args, **kwargs),
                timeout=self.config.call_timeout_s,
            )
            elapsed = (time.monotonic() - start) * 1000

            # Success
            self._record_success()

            obs_logger.info("circuit_call_ok",
                driver=self.driver,
                duration_ms=round(elapsed, 1),
                is_probe=is_probe,
            )
            return result

        except asyncio.TimeoutError:
            elapsed = (time.monotonic() - start) * 1000
            obs_logger.error("circuit_timeout",
                driver=self.driver,
                timeout_s=self.config.call_timeout_s,
                duration_ms=round(elapsed, 1),
            )
            if is_probe:
                self._record_failure(TimeoutError(f"Probe timed out after {self.config.call_timeout_s}s"))
            raise TimeoutError(f"MCP call to {self.driver} timed out after {self.config.call_timeout_s}s")

        except Exception as e:
            elapsed = (time.monotonic() - start) * 1000
            obs_logger.error("circuit_call_error",
                driver=self.driver,
                error=str(e)[:200],
                duration_ms=round(elapsed, 1),
            )
            if is_probe:
                self._record_failure(e)
            raise

    def _record_success(self):
        """Reset failure count on success."""
        if self._state != CircuitState.CLOSED:
            obs_logger.info("circuit_closed",
                driver=self.driver,
                previous_failures=self._failure_count,
            )
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._success_count += 1

    def _record_failure(self, error: Optional[Exception] = None):
        """Track failure. Open circuit if threshold reached."""
        self._failure_count += 1
        self._last_failure_time = time.monotonic()

        if self._failure_count >= self.config.failure_threshold:
            self._state = CircuitState.OPEN
            obs_logger.error("circuit_opened",
                driver=self.driver,
                failure_count=self._failure_count,
                threshold=self.config.failure_threshold,
                error=str(error)[:200] if error else None,
            )
        else:
            obs_logger.warning("circuit_failure_counted",
                driver=self.driver,
                failure_count=self._failure_count,
                threshold=self.config.failure_threshold,
            )

    def reset(self):
        """Manually reset the circuit breaker."""
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._success_count = 0
        obs_logger.info("circuit_manual_reset", driver=self.driver)

    def get_status(self) -> dict:
        """Return current circuit breaker status."""
        return {
            "driver": self.driver,
            "state": self.state.value,
            "failure_count": self._failure_count,
            "success_count": self._success_count,
            "config": {
                "failure_threshold": self.config.failure_threshold,
                "recovery_timeout_s": self.config.recovery_timeout_s,
                "call_timeout_s": self.config.call_timeout_s,
            },
        }
