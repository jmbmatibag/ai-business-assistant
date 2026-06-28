"""Schemas for the inventory API."""

from pydantic import BaseModel


class LowStockItem(BaseModel):
    store_id: int
    store_name: str
    sku: str
    item_name: str | None
    category: str | None
    current_stock: int
    daily_velocity: float
    days_until_stockout: float


class LowStockResponse(BaseModel):
    reorder_days: int
    count: int
    items: list[LowStockItem]
