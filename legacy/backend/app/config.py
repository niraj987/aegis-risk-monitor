"""Environment-driven configuration for the risk monitor."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/


def _as_bool(raw: str | None, default: bool) -> bool:
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _as_int(raw: str | None, default: int) -> int:
    try:
        return int(str(raw).strip())
    except (TypeError, ValueError):
        return default


def _as_float(raw: str | None, default: float) -> float:
    try:
        return float(str(raw).strip())
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class Settings:
    """All runtime knobs live here so behaviour is easy to audit."""

    database_path: Path
    cache_dir: Path
    data_source: str
    history_days: int
    portfolio_value: float
    monitor_interval_seconds: int
    scheduler_enabled: bool
    random_seed: int
    llm_api_key: str
    llm_base_url: str
    llm_model: str
    llm_timeout_seconds: float
    allowed_origins: tuple[str, ...]

    @property
    def llm_enabled(self) -> bool:
        return bool(self.llm_api_key)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    data_dir = Path(os.getenv("RISK_DATA_DIR", BASE_DIR / "data")).resolve()
    cache_dir = data_dir / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    origins = [
        origin.strip()
        for origin in os.getenv(
            "ALLOWED_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8090,"
            "http://127.0.0.1:8090,http://localhost:8080,http://127.0.0.1:8080",
        ).split(",")
        if origin.strip()
    ]

    return Settings(
        database_path=Path(os.getenv("DATABASE_PATH", data_dir / "risk_monitor.sqlite3")),
        cache_dir=cache_dir,
        data_source=os.getenv("DATA_SOURCE", "auto").strip().lower(),
        history_days=_as_int(os.getenv("HISTORY_DAYS"), 756),
        portfolio_value=_as_float(os.getenv("PORTFOLIO_VALUE"), 1_000_000.0),
        monitor_interval_seconds=_as_int(os.getenv("MONITOR_INTERVAL_SECONDS"), 900),
        scheduler_enabled=_as_bool(os.getenv("SCHEDULER_ENABLED"), True),
        random_seed=_as_int(os.getenv("RANDOM_SEED"), 42),
        llm_api_key=os.getenv("OPENAI_API_KEY", "").strip(),
        llm_base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
        llm_model=os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip(),
        llm_timeout_seconds=_as_float(os.getenv("LLM_TIMEOUT_SECONDS"), 25.0),
        allowed_origins=tuple(origins),
    )
