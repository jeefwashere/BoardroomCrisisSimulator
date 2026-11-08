"""Host closure is authoritative; short interruptions retain the existing seat."""
import asyncio
import unittest
from uuid import uuid4

from backend.app.rooms import RoomError, Rooms, StartSpec
from backend.app.scenarios import ScenarioCatalog
from backend.app.main import create_app


class Clock:
    now = 1000.0
    def __call__(self):
        return self.now


class HostSessionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.clock = Clock()
        self.rooms = Rooms(ScenarioCatalog(), self.clock)
        self.host = self.rooms.session(None)
        self.guests = [self.rooms.session(None), self.rooms.session(None)]
        self.room = await self.rooms.create(self.host, uuid4(), 'CLOSE1', 'Host')
        for index, guest in enumerate(self.guests):
            await self.rooms.join(guest, uuid4(), 'CLOSE1', f'Guest {index}')

    async def start(self):
        lobby = await self.rooms.snapshot(self.host, self.room.room_id)
        return await self.rooms.start(self.host, self.room.room_id, uuid4(), StartSpec('CLOSE1', 'maplecart_cybersecurity', 3, 'standard_18', tuple((member.member_id, 'ceo' if member.is_host else 'security') for member in lobby.members)))

    async def assert_closed(self, code, message):
        for session in [self.host, *self.guests]:
            for action in [self.rooms.snapshot(session, self.room.room_id), self.rooms.join(session, uuid4(), 'CLOSE1', 'Return')]:
                with self.assertRaises(RoomError) as result:
                    await action
                self.assertEqual((result.exception.status, result.exception.code, result.exception.message), (410, code, message))

    async def test_confirmed_host_departure_ends_started_game_and_revokes_all_members(self):
        await self.start()
        command_id = uuid4()
        closed = await self.rooms.leave(self.host, self.room.room_id, command_id)
        self.assertEqual(closed.status, 'closed')
        self.assertEqual(await self.rooms.leave(self.host, self.room.room_id, command_id), closed)
        await self.assert_closed('room_closed', 'The session has been ended by the host.')
        state = self.rooms.rooms[self.room.room_id].phase.state
        self.assertEqual(state.phase.kind, 'ended')
        self.assertEqual(state.phase.ending_label, 'host_ended')

    async def test_lobby_host_timeout_closes_every_seat_at_the_presence_cutoff(self):
        self.clock.now += 29.999
        await self.rooms.tick()
        self.assertFalse(self.rooms.rooms[self.room.room_id].closed)
        self.clock.now += .001
        await self.rooms.tick()
        await self.assert_closed('host_disconnected', 'The host has been disconnected.')

    async def test_game_host_timeout_ends_the_call_with_a_distinct_reason(self):
        await self.start()
        self.clock.now += 30
        await self.rooms.tick()
        await self.assert_closed('host_disconnected', 'The host has been disconnected.')
        state = self.rooms.rooms[self.room.room_id].phase.state
        self.assertEqual(state.phase.kind, 'ended')
        self.assertEqual(state.phase.ending_label, 'host_disconnected')

    async def test_host_heartbeat_renews_the_lease_but_guest_activity_does_not(self):
        self.clock.now += 29
        refreshed = await self.rooms.snapshot(self.host, self.room.room_id)
        self.assertEqual(refreshed.self_member_id, self.room.self_member_id)
        self.clock.now += 29
        await self.rooms.snapshot(self.guests[0], self.room.room_id)
        await self.rooms.tick()
        self.assertFalse(self.rooms.rooms[self.room.room_id].closed)
        self.clock.now += 1
        await self.rooms.tick()
        await self.assert_closed('host_disconnected', 'The host has been disconnected.')

    async def test_completed_game_records_are_not_expired_by_a_later_host_absence(self):
        started = await self.start()
        ended = await self.rooms.play(self.host, self.room.room_id, uuid4(), started.game.phase_id, None, 'end')
        self.clock.now += 3600
        await self.rooms.tick()
        current = await self.rooms.snapshot(self.guests[0], self.room.room_id)
        self.assertEqual(current.game.ending_label, ended.game.ending_label)
        self.assertFalse(self.rooms.rooms[self.room.room_id].closed)

    async def test_duplicate_host_leave_and_later_ticks_close_once(self):
        command_id = uuid4()
        receipts = await asyncio.gather(*(self.rooms.leave(self.host, self.room.room_id, command_id) for _ in range(8)))
        self.assertTrue(all(receipt == receipts[0] for receipt in receipts))
        version = self.rooms.rooms[self.room.room_id].version
        self.clock.now += 100
        await self.rooms.tick()
        self.assertEqual(self.rooms.rooms[self.room.room_id].version, version)
        self.assertEqual(self.rooms.rooms[self.room.room_id].closed_reason, 'host_ended')

    async def test_host_presence_is_scoped_to_each_room(self):
        other = await self.rooms.create(self.host, uuid4(), 'OTHER1', 'Host')
        self.clock.now += 29
        await self.rooms.snapshot(self.host, other.room_id)
        self.clock.now += 1
        await self.rooms.tick()
        self.assertTrue(self.rooms.rooms[self.room.room_id].closed)
        self.assertEqual((await self.rooms.snapshot(self.host, other.room_id)).room_id, other.room_id)

    async def test_host_loss_does_not_crash_the_shared_clock_or_start_closed_room_feedback(self):
        await self.start()
        app = create_app(rooms=self.rooms)
        self.clock.now += 30
        async with app.router.lifespan_context(app):
            await asyncio.sleep(.15)
            self.assertTrue(self.rooms.rooms[self.room.room_id].closed)
            self.assertFalse(app.state.clock_task.done())
            self.assertNotIn(self.room.room_id, app.state.feedback.entries)
