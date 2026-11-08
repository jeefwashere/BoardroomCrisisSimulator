"""Shared room admission limits."""

ROOM_CAPACITY = 30
MINIMUM_TO_START = 3
PRESENCE_WINDOW_SECONDS = 30


def valid_unicode(value: str) -> bool:
    """Accept complete Unicode text without imposing a product length limit."""
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True
