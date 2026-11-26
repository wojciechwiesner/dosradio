"""A listener that falls behind must be dropped cleanly, without crashing the station encoder.

`_offer` used to call `put_nowait(None)` on the very queue that had just raised QueueFull, which raised
QueueFull again inside `_publish`, killed `_run` and cut the stream off for every listener of the station.
"""
from __future__ import annotations

import asyncio

import pytest

from app.stream import StationStream

pytestmark = pytest.mark.anyio


def _bare_stream() -> StationStream:
    stream = StationStream.__new__(StationStream)
    stream._subscribers = set()
    return stream


async def test_slow_listener_is_dropped_without_raising():
    stream = _bare_stream()
    slow: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=2)
    healthy: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=10)
    stream._subscribers.update({slow, healthy})
    for _ in range(4):  # third offer overflows the slow queue
        for queue in list(stream._subscribers):
            stream._offer(queue, b"chunk")
    assert slow not in stream._subscribers
    assert healthy in stream._subscribers
    assert healthy.qsize() == 4


async def test_dropped_listener_gets_end_of_stream_marker():
    stream = _bare_stream()
    slow: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=2)
    stream._subscribers.add(slow)
    for _ in range(3):
        stream._offer(slow, b"chunk")
    drained = [slow.get_nowait() for _ in range(slow.qsize())]
    assert drained[-1] is None, "the reader must see None and close its HTTP response"


async def test_end_marker_to_full_queue_does_not_raise():
    stream = _bare_stream()
    full: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=1)
    full.put_nowait(b"chunk")
    stream._subscribers.add(full)
    stream._offer(full, None)  # station shutdown broadcast
    assert full not in stream._subscribers
