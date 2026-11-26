"""Request models and validation for the public API."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

SYMBOL_PATTERN = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")


class HoldingIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=10)
    name: str | None = Field(default=None, max_length=60)
    sector: str | None = Field(default=None, max_length=40)
    weight: float = Field(ge=0, le=1)

    @field_validator("symbol")
    @classmethod
    def clean_symbol(cls, value: str) -> str:
        symbol = value.strip().upper()
        if not SYMBOL_PATTERN.match(symbol):
            raise ValueError("use a ticker like AAPL (letters, digits, . or -)")
        return symbol


class PortfolioUpdate(BaseModel):
    holdings: list[HoldingIn] = Field(min_length=2, max_length=30)

    @field_validator("holdings")
    @classmethod
    def weights_sum(cls, holdings: list[HoldingIn]) -> list[HoldingIn]:
        if sum(item.weight for item in holdings) <= 0:
            raise ValueError("at least one holding must have a positive weight")
        symbols = [item.symbol for item in holdings]
        if len(symbols) != len(set(symbols)):
            raise ValueError("symbols must be unique")
        return holdings


class LimitUpdate(BaseModel):
    var_95_limit_pct: float | None = Field(default=None, gt=0, le=100)
    ann_vol_limit_pct: float | None = Field(default=None, gt=0, le=200)
    max_drawdown_limit_pct: float | None = Field(default=None, gt=0, le=100)
    daily_move_limit_pct: float | None = Field(default=None, gt=0, le=100)
    concentration_limit_pct: float | None = Field(default=None, gt=0, le=100)


class AlertReview(BaseModel):
    status: Literal["acknowledged", "escalated", "dismissed"] = "acknowledged"
    reviewer: str = Field(default="Portfolio Manager", min_length=2, max_length=80)
