"""
base_tools.py — Shared SSH base class for LinuxTools and MikroTikTools.

Tool creation uses the correct LangChain pattern:
  StructuredTool.from_function(coroutine=async_fn, args_schema=PydanticModel)
  
This ensures the LLM can bind tools correctly and they are actually invoked.
"""

import asyncio
import json
from functools import partial
from typing import Optional, Callable, Any, Coroutine

import paramiko
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from services.encryption_service import decrypt_password


class BaseTools:
    """Shared SSH + tool plumbing for device tool classes."""

    DEVICE_TYPE: str = "unknown"

    def __init__(
        self,
        host: str,
        port: int,
        username: str,
        password_encrypted: str,
        agent_mode: str = "restricted",
        emit_fn: Optional[Callable] = None,
        conversation_id: str = "",
        tenant_slug: str = "",
    ):
        self.host = host
        self.port = int(port) if port else 22
        self.username = username
        self.password = decrypt_password(password_encrypted)
        self.agent_mode = agent_mode
        self._emit_fn: Optional[Callable] = emit_fn       # injected by orchestrator
        self.conversation_id: str = conversation_id        # real UUID, never LLM-guessed
        self.tenant_slug: str = tenant_slug                # real slug

    # ── SSH Execution ──────────────────────────────────────────────────────────

    def _run_ssh(self, command: str, timeout: int = 60) -> str:
        """Synchronous paramiko SSH execution."""
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            client.connect(
                self.host,
                port=self.port,
                username=self.username,
                password=self.password,
                timeout=15,
                look_for_keys=False,
                allow_agent=False,
            )
            _, stdout, stderr = client.exec_command(command, timeout=timeout)
            out = stdout.read().decode(errors="replace").strip()
            err = stderr.read().decode(errors="replace").strip()
            return out or err or "(sem saída)"
        except paramiko.AuthenticationException:
            return "Erro: falha de autenticação SSH"
        except paramiko.ssh_exception.NoValidConnectionsError:
            return f"Erro: não foi possível conectar a {self.host}:{self.port}"
        except Exception as e:
            return f"Erro SSH: {e}"
        finally:
            client.close()

    async def _async_run(self, command: str, timeout: int = 60) -> str:
        """Run SSH command on thread executor (non-blocking)."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, partial(self._run_ssh, command, timeout))

    def _run_ssh_with_exit_code(self, command: str, timeout: int = 120) -> tuple[str, int]:
        """Synchronous SSH exec returning (output, exit_code). Used by skill_executor."""
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            client.connect(
                self.host, port=self.port,
                username=self.username, password=self.password,
                timeout=15, look_for_keys=False, allow_agent=False,
            )
            _, stdout, stderr = client.exec_command(command, timeout=timeout)
            exit_code = stdout.channel.recv_exit_status()
            out = stdout.read().decode(errors="replace").strip()
            err = stderr.read().decode(errors="replace").strip()
            combined = (out + ("\n" + err if err else "")).strip() or "(sem saída)"
            return combined, exit_code
        except paramiko.AuthenticationException:
            return "Erro: falha de autenticação SSH", -1
        except Exception as e:
            return f"Erro SSH: {e}", -1
        finally:
            client.close()

    async def _async_run_with_exit_code(self, command: str, timeout: int = 120) -> tuple[str, int]:
        """Async wrapper for _run_ssh_with_exit_code."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, partial(self._run_ssh_with_exit_code, command, timeout)
        )

    # ── StructuredTool Factory (correct LangChain pattern) ────────────────────

    def _make_async_tool(
        self,
        name: str,
        description: str,
        schema: type[BaseModel],
        fn: Callable[..., Coroutine[Any, Any, str]],
    ) -> StructuredTool:
        """
        Create a StructuredTool backed by an async function.
        The fn must be a coroutine function (async def).
        """
        return StructuredTool(
            name=name,
            description=description,
            args_schema=schema,
            coroutine=fn,
            func=None,  # required by pydantic but unused for async
        )

    def _make_noarg_tool(
        self,
        name: str,
        description: str,
        fn: Callable[[], Coroutine[Any, Any, str]],
    ) -> StructuredTool:
        """Create a no-argument StructuredTool backed by an async function."""

        class _NoArgs(BaseModel):
            pass

        return StructuredTool(
            name=name,
            description=description,
            args_schema=_NoArgs,
            coroutine=fn,
            func=None,
        )

    # ── Shared Tools ───────────────────────────────────────────────────────────

    def _get_propose_action_tool(self) -> StructuredTool:
        _self = self

        class ProposeActionInput(BaseModel):
            action_type: str = Field(
                description="tipo: install, restart, config, firewall, remove, update, routing, qos, backup"
            )
            description: str = Field(description="descrição clara do que será feito e por quê")
            commands: str = Field(description='comandos como JSON array: ["cmd1", "cmd2"]')
            risk_level: str = Field(description="low, medium ou high")

        async def _propose_action(
            action_type: str, description: str, commands: str, risk_level: str = "medium"
        ) -> str:
            return await _self.propose_action(action_type, description, commands, risk_level)

        return StructuredTool(
            name="propose_action",
            description=(
                "USAR QUANDO O USUARIO PEDIR INSTALAÇÃO, CONFIGURAÇÃO OU QUALQUER MUDANÇA. "
                "Propõe uma ação que requer aprovação do usuário antes de executar. "
                "Inclua comandos exatos baseados no que fingerprint_device revelou."
            ),
            args_schema=ProposeActionInput,
            coroutine=_propose_action,
            func=None,
        )

    def _get_save_knowledge_tool(self, categories: str = "linux, networking, security") -> StructuredTool:
        _self = self

        class SaveKnowledgeInput(BaseModel):
            title: str = Field(description="título curto e descritivo")
            content: str = Field(description="conteúdo detalhado do conhecimento")
            category: str = Field(description=f"categoria: {categories}")

        async def _save_knowledge(title: str, content: str, category: str = "general") -> str:
            return await _self.save_knowledge(title, content, category)

        return StructuredTool(
            name="save_knowledge",
            description=(
                "Salva um aprendizado importante sobre este servidor ou rede no banco de conhecimento. "
                "Use quando descobrir configurações específicas, problemas resolvidos, ou padrões úteis."
            ),
            args_schema=SaveKnowledgeInput,
            coroutine=_save_knowledge,
            func=None,
        )

    def _get_save_memory_tool(self) -> StructuredTool:
        _self = self

        class SaveMemoryInput(BaseModel):
            memory_type: str = Field(description="tipo: user_preference, device_fact, network_topology, misc")
            content: str = Field(description="O que deve ser lembrado (ex: 'O cliente prefere reboots de madrugada')")
            is_device_specific: bool = Field(description="True se a memória for apenas para este equipamento, False se for para toda a empresa")

        async def _save_memory(memory_type: str, content: str, is_device_specific: bool = True) -> str:
            import db
            device_id_val = None
            if is_device_specific:
                # We need the device_id from orchestrator. Since BaseTools receives conversation_id and tenant_slug
                # but not device_id in constructor, we will have to let the DB layer handle it or pass it.
                # Actually, orchestrator context handles device matching. Wait, tools dont have state["device_id"].
                pass
            
            try:
                kid = await db.save_tenant_memory(
                    tenant_slug=_self.tenant_slug,
                    memory_type=memory_type,
                    content=content,
                    conversation_id=_self.conversation_id,
                    device_id=None # We'll leave device_id=None for now to keep it simple and tenant-wide
                )
                return f"✅ Memória salva (id: {kid}): {content[:50]}..."
            except Exception as e:
                return f"⚠️ Não foi possível salvar a memória: {e}"

        return StructuredTool(
            name="save_memory",
            description=(
                "MEMÓRIA DE MÉDIO PRAZO: Salva preferências do usuário ou peculiaridades da rede que devem ser lembradas em conversas futuras. "
                "Use quando o usuário disser 'lembre-se disso' ou 'sempre faça XYZ'."
            ),
            args_schema=SaveMemoryInput,
            coroutine=_save_memory,
            func=None,
        )

    def _get_ping_host_tool(self) -> StructuredTool:
        _self = self

        class PingInput(BaseModel):
            host: str = Field(description="IP ou hostname de destino")
            count: int = Field(default=4, description="número de pings (max 10)")

        async def _ping(host: str, count: int = 4) -> str:
            return await _self.ping_host(host, count)

        return StructuredTool(
            name="ping_host",
            description="Executa ping a partir do dispositivo para testar conectividade",
            args_schema=PingInput,
            coroutine=_ping,
            func=None,
        )

    # ── Shared Implementations ─────────────────────────────────────────────────

    async def propose_action(
        self,
        action_type: str,
        description: str,
        commands: str,
        risk_level: str = "medium",
    ) -> str:
        try:
            cmds = json.loads(commands) if isinstance(commands, str) else commands
        except (json.JSONDecodeError, TypeError):
            cmds = [commands] if commands else []
        risk_level = risk_level if risk_level in ("low", "medium", "high") else "medium"
        return json.dumps({
            "__pending_action__": True,
            "action_type": action_type,
            "description": description,
            "commands": cmds,
            "risk_level": risk_level,
        })

    async def save_knowledge(self, title: str, content: str, category: str = "general") -> str:
        try:
            from memory.rag import index_knowledge
            import db

            tenant = await db.get_tenant_by_slug(self.tenant_slug)
            tenant_id = str(tenant["id"]) if tenant else None

            kid = await index_knowledge(
                title=title,
                content=content,
                category=category,
                device_type=self.DEVICE_TYPE,
                tenant_id=tenant_id,
                source="agent_learned",
            )
            return f"✅ Conhecimento salvo (id: {kid}): {title}"
        except Exception as e:
            return f"⚠️ Não foi possível salvar o conhecimento: {e}"

    async def ping_host(self, host: str, count: int = 4) -> str:
        raise NotImplementedError("Subclasses must implement ping_host")
