"""
ssh.py — SSH connection handler for Linux server MCP driver.

Identical to the MikroTik driver's SSH module.
Credentials come per-request for multi-tenant support.
"""

import asyncio
import logging
from functools import partial

import paramiko

_log = logging.getLogger(__name__)


class SSHPool:
    """Manages SSH connections to Linux servers."""

    def __init__(self, connect_timeout: int = 15, command_timeout: int = 60):
        self.connect_timeout = connect_timeout
        self.command_timeout = command_timeout

    def run_command(
        self, host: str, port: int, username: str, password: str,
        command: str, timeout: int = None,
    ) -> str:
        """Execute a single SSH command (synchronous)."""
        timeout = timeout or self.command_timeout
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            client.connect(
                host, port=port, username=username, password=password,
                timeout=self.connect_timeout, look_for_keys=False, allow_agent=False,
            )
            _, stdout, stderr = client.exec_command(command, timeout=timeout)
            out = stdout.read().decode(errors="replace").strip()
            err = stderr.read().decode(errors="replace").strip()
            return out or err or "(sem saída)"
        except paramiko.AuthenticationException:
            raise ConnectionError("Erro: falha de autenticação SSH")
        except paramiko.ssh_exception.NoValidConnectionsError:
            raise ConnectionError(f"Erro: não foi possível conectar a {host}:{port}")
        except Exception as e:
            raise ConnectionError(f"Erro SSH: {e}")
        finally:
            client.close()

    async def async_run(
        self, host: str, port: int, username: str, password: str,
        command: str, timeout: int = None,
    ) -> str:
        """Execute SSH command on thread executor (non-blocking)."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, partial(self.run_command, host, port, username, password, command, timeout),
        )

    async def async_run_multi(
        self, host: str, port: int, username: str, password: str,
        commands: list[str], timeout: int = None,
    ) -> list[str]:
        """Execute multiple SSH commands concurrently."""
        tasks = [
            self.async_run(host, port, username, password, cmd, timeout)
            for cmd in commands
        ]
        return await asyncio.gather(*tasks, return_exceptions=True)


ssh_pool = SSHPool()
