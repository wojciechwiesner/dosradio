"""Polish radio-style spoken time: 14:20 -> 'czternasta dwadzieścia'."""
from __future__ import annotations

HOURS = [
    "zero", "pierwsza", "druga", "trzecia", "czwarta", "piąta", "szósta", "siódma", "ósma", "dziewiąta",
    "dziesiąta", "jedenasta", "dwunasta", "trzynasta", "czternasta", "piętnasta", "szesnasta", "siedemnasta",
    "osiemnasta", "dziewiętnasta", "dwudziesta", "dwudziesta pierwsza", "dwudziesta druga", "dwudziesta trzecia",
]
UNITS = ["", "jeden", "dwa", "trzy", "cztery", "pięć", "sześć", "siedem", "osiem", "dziewięć"]
TEENS = ["dziesięć", "jedenaście", "dwanaście", "trzynaście", "czternaście", "piętnaście", "szesnaście",
         "siedemnaście", "osiemnaście", "dziewiętnaście"]
TENS = ["", "", "dwadzieścia", "trzydzieści", "czterdzieści", "pięćdziesiąt"]


def spoken_time_pl(hours: int, minutes: int) -> str:
    if not (0 <= hours <= 23 and 0 <= minutes <= 59):
        raise ValueError(f"invalid time {hours}:{minutes}")
    if minutes == 0:
        words = "zero zero"
    elif minutes < 10:
        words = f"zero {UNITS[minutes]}"
    elif minutes < 20:
        words = TEENS[minutes - 10]
    else:
        words = f"{TENS[minutes // 10]} {UNITS[minutes % 10]}".strip()
    return f"{HOURS[hours]} {words}"
